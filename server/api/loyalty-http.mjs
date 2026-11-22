import {performance} from 'node:perf_hooks';
import {setImmediate as yieldTurn} from 'node:timers/promises';
// Fetch-Request boundary for the canonical transactional ledger. No listener,
// provider setup, cookie session, Wallet route or separate authorizer lives here.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const business=/^[A-Za-z0-9_-]{1,60}$/;
const key=/^[A-Za-z0-9_-]{16,100}$/;
const bearer=/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
const quiet={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
const invalid=new Set(['INVALID_LOCATION','INVALID_PROGRAM','INVALID_TIMEZONE','INVALID_TRANSACTION','INVALID_PASS','INVALID_ENROLLMENT']);
const missing=new Set(['MERCHANT_UNAVAILABLE','PROGRAM_UNAVAILABLE','LOCATION_UNAVAILABLE','PASS_UNAVAILABLE']);
const conflict=new Set(['IDEMPOTENCY_CONFLICT','REWARD_READY','REWARD_NOT_READY','DAILY_LIMIT','COOLDOWN','ENROLLMENT_EXPIRED']);
class HttpError extends Error {constructor(status,code,retryable=false){super(code);this.status=status;this.code=code;this.retryable=retryable;}}
const reject=(status,code,retryable=false)=>{throw new HttpError(status,code,retryable);};
const reply=(status,value,extra={})=>Response.json(value,{status,headers:{...quiet,...extra}});
const errorReply=(status,code,retryable=false,extra={})=>reply(status,{error:{code,retryable}},extra);
const isBalance=x=>Number.isSafeInteger(x)&&x>=0&&x<=100;
function cancelBody(body){try{const p=body?.cancel();p?.catch(()=>{});}catch{/* cancellation is best-effort, not authority */}}

async function readBody(request,{maxBodyBytes,bodyTimeoutMs}){
  if(!/^application\/json(?:\s*;\s*charset=(?:utf-8|"utf-8"))?$/i.test(request.headers.get('content-type')??''))reject(415,'UNSUPPORTED_MEDIA_TYPE');
  if(request.headers.has('content-encoding'))reject(415,'UNSUPPORTED_CONTENT_ENCODING');
  const length=request.headers.get('content-length');
  if(length!==null&&(!/^(?:0|[1-9][0-9]*)$/.test(length)||!Number.isSafeInteger(Number(length))))reject(400,'INVALID_CONTENT_LENGTH');
  if(length!==null&&Number(length)>maxBodyBytes)reject(413,'BODY_TOO_LARGE');
  if(!request.body)reject(400,'INVALID_JSON');
  const reader=request.body.getReader();
  let timer,abort,bytes=0,reads=0;
  const image=new Uint8Array(maxBodyBytes);
  const maxReads=maxBodyBytes+33; // byte-by-byte body,32empty reads,thenEOF
  const deadline=performance.now()+bodyTimeoutMs;
  function guard(){
    if(request.signal.aborted)reject(400,'REQUEST_ABORTED');
    if(performance.now()>=deadline)reject(408,'REQUEST_TIMEOUT',true);
  }
  const failed=new Promise((_,bad)=>{
    timer=setTimeout(()=>bad(new HttpError(408,'REQUEST_TIMEOUT',true)),bodyTimeoutMs);
    abort=()=>bad(new HttpError(400,'REQUEST_ABORTED'));
    request.signal.addEventListener('abort',abort,{once:true});
    if(request.signal.aborted)abort();
  });
  // A synchronous guard may reject before the first race is installed. Keep
  // the shared abort/deadline promise handled without hiding raced failures.
  failed.catch(()=>{});
  try{
    for(;;){
      guard();
      if(++reads>maxReads)reject(413,'BODY_WORK_LIMIT');
      const {value,done}=await Promise.race([reader.read(),failed]);
      guard(); // immediate producers cannot postpone this monotonic check
      if(done)break;
      if(!(value instanceof Uint8Array))reject(400,'INVALID_JSON');
      if(value.byteLength>maxBodyBytes-bytes)reject(413,'BODY_TOO_LARGE');
      image.set(value,bytes);bytes+=value.byteLength;
      if(reads%64===0){
        // Give abort/timer/other request callbacks a turn, even if read() is
        // perpetually fulfilled. Work/read accounting includes empty chunks.
        await Promise.race([yieldTurn(),failed]);guard();
      }
    }
    if(length!==null&&Number(length)!==bytes)reject(400,'INVALID_CONTENT_LENGTH');
    let text,value;
    try{text=new TextDecoder('utf-8',{fatal:true}).decode(image.subarray(0,bytes));value=JSON.parse(text);}catch{reject(400,'INVALID_JSON');}
    const fields=['businessId','membershipId','locationId'];
    if(!value||typeof value!=='object'||Array.isArray(value)||
      Object.keys(value).length!==fields.length||fields.some(f=>typeof value[f]!=='string'))reject(400,'INVALID_FIELDS');
    // JSON.parse owns the grammar. This schema permits only three string keys
    // and three string values. Extra string tokens prove overwritten duplicate
    // keys/values, including escaped key spellings. Never accept ambiguous JSON.
    if((text.match(/"(?:[^"\\]|\\.)*"/g)??[]).length!==6)reject(400,'DUPLICATE_FIELDS');
    if(!business.test(value.businessId)||!uuid.test(value.membershipId)||!uuid.test(value.locationId))reject(400,'INVALID_FIELDS');
    guard();
    return {...value,membershipId:value.membershipId.toLowerCase(),locationId:value.locationId.toLowerCase()};
  }finally{
    clearTimeout(timer);request.signal.removeEventListener('abort',abort);
    // Do not wait on an untrusted producer's asynchronous cancel hook.
    try{reader.cancel().catch(()=>{});}catch{}
    try{reader.releaseLock();}catch{}
  }
}

export function createLoyaltyHttpHandler({origin,ledger,maxBodyBytes=8192,maxHeaderBytes=8192,bodyTimeoutMs=5000}={}){
  let configured;
  try{configured=new URL(origin);}catch{throw new TypeError('A canonical HTTPS API origin is required.');}
  if(configured.protocol!=='https:'||configured.href!==configured.origin+'/'||
    !['issueStamp','redeemReward','getMerchantPass'].every(x=>typeof ledger?.[x]==='function')||
    !Number.isInteger(maxBodyBytes)||maxBodyBytes<128||maxBodyBytes>65536||
    !Number.isInteger(maxHeaderBytes)||maxHeaderBytes<256||maxHeaderBytes>32768||
    !Number.isInteger(bodyTimeoutMs)||bodyTimeoutMs<1||bodyTimeoutMs>10000)throw new TypeError('Invalid loyalty HTTP configuration.');
  return async function handle(request){
    try{
      if(typeof request?.url!=='string')reject(400,'INVALID_REQUEST');
      if(request.url.length>8192)reject(414,'URI_TOO_LONG');
      const url=new URL(request.url);
      if(url.origin!==configured.origin||url.username||url.password||url.hash)return errorReply(404,'NOT_FOUND');
      const kind=url.pathname==='/api/v1/loyalty/stamps'?'stamp':url.pathname==='/api/v1/loyalty/redemptions'?'redeem':null;
      const pass=/^\/api\/v1\/loyalty\/passes\/([0-9a-f-]{36})$/i.exec(url.pathname);
      if(!kind&&!pass)return errorReply(404,'NOT_FOUND');
      const method=kind?'POST':'GET';
      if(request.method!==method)return errorReply(405,'METHOD_NOT_ALLOWED',false,{Allow:method});
      let headerBytes=0;const encoder=new TextEncoder();
      for(const [name,value]of request.headers){
        // UTF-16 length is a cheap lower bound on these UTF-8 bytes. Reject
        // huge values before encoding and stop iteration as soon as over cap.
        if(headerBytes+name.length+value.length+4>maxHeaderBytes)reject(431,'HEADERS_TOO_LARGE');
        headerBytes+=encoder.encode(name).length+encoder.encode(value).length+4;
        if(headerBytes>maxHeaderBytes)reject(431,'HEADERS_TOO_LARGE');
      }
      const requestOrigin=request.headers.get('origin');
      if(requestOrigin!==null&&requestOrigin!==configured.origin)reject(403,'ORIGIN_NOT_ALLOWED');
      const authorization=request.headers.get('authorization')??'';
      const match=authorization.length<=12295?bearer.exec(authorization):null;
      if(!match)reject(401,'UNAUTHORIZED');
      if(kind){
        if(url.search)reject(400,'INVALID_QUERY');
        const idempotencyKey=request.headers.get('idempotency-key')??'';
        if(!key.test(idempotencyKey))reject(400,'INVALID_IDEMPOTENCY_KEY');
        const input=await readBody(request,{maxBodyBytes,bodyTimeoutMs});
        // The ledger validates the signed identity and acquires canonical
        // permissions/lifecycle locks in the SAME transaction as this command.
        const result=await ledger[kind==='stamp'?'issueStamp':'redeemReward']({...input,accessToken:match[1],idempotencyKey});
        if(result?.kind!==kind||typeof result.duplicate!=='boolean'||!isBalance(result.balance)||
          (result.rewardReady!==undefined&&typeof result.rewardReady!=='boolean'))throw new Error('Invalid ledger result');
        const transaction={kind:result.kind,balance:result.balance,duplicate:result.duplicate};
        if(result.rewardReady!==undefined)transaction.rewardReady=result.rewardReady;
        return reply(200,{transaction,idempotencyKey});
      }
      if(!uuid.test(pass[1])||[...url.searchParams.keys()].length!==1||!url.searchParams.has('businessId')||
        !business.test(url.searchParams.get('businessId')))reject(400,'INVALID_QUERY');
      if(request.body||request.headers.has('transfer-encoding')||!['0',null].includes(request.headers.get('content-length')))reject(400,'UNEXPECTED_BODY');
      const row=await ledger.getMerchantPass({accessToken:match[1],businessId:url.searchParams.get('businessId'),membershipId:pass[1].toLowerCase()});
      if(!row||row.id!==pass[1].toLowerCase()||!/^stp_[a-f0-9]{32}$/.test(row.pass_id)||!isBalance(row.balance)||
        !Number.isSafeInteger(row.lifetime_stamps)||row.lifetime_stamps<0||!Number.isSafeInteger(row.rewards_redeemed)||row.rewards_redeemed<0||
        !Number.isSafeInteger(row.target)||row.target<1||row.target>100||row.balance>row.target||typeof row.reward_text!=='string'||
        row.reward_text.length>200||typeof row.time_zone!=='string'||row.time_zone.length>100||row.status!=='active')throw new Error('Invalid ledger result');
      return reply(200,{membership:{id:row.id,passId:row.pass_id,balance:row.balance,lifetimeStamps:row.lifetime_stamps,
        rewardsRedeemed:row.rewards_redeemed,status:row.status,target:row.target,rewardText:row.reward_text,timeZone:row.time_zone}});
    }catch(error){
      if(error instanceof HttpError)return errorReply(error.status,error.code,error.retryable,error.status===401?{'WWW-Authenticate':'Bearer realm="Stampy"'}:{});
      if(error?.name==='LoyaltyError'){
        if(error.code==='UNAUTHORIZED')return errorReply(401,'UNAUTHORIZED',false,{'WWW-Authenticate':'Bearer realm="Stampy"'});
        if(error.code==='FORBIDDEN')return errorReply(403,'FORBIDDEN');
        if(invalid.has(error.code))return errorReply(400,error.code);
        if(missing.has(error.code))return errorReply(404,'RESOURCE_UNAVAILABLE');
        if(conflict.has(error.code))return errorReply(409,error.code);
      }
      return errorReply(503,'SERVICE_UNAVAILABLE',true);
    }finally{cancelBody(request?.body);}
  };
}
