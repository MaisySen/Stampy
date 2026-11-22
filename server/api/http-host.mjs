import {createServer} from 'node:http';
import {performance} from 'node:perf_hooks';
import {readBoundedStream} from './bounded-stream.mjs';

const quiet={'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Connection':'close'};
const forwarded=['authorization','content-type','content-length','content-encoding','idempotency-key','origin'];
const allowedResponse=new Set(['content-type','allow','cache-control','referrer-policy','x-content-type-options']);
const apiPath=/^\/api\/v1\/loyalty\/(?:stamps|redemptions|passes\/[0-9a-fA-F-]{36})$/;
const integer=(x,min,max)=>Number.isInteger(x)&&x>=min&&x<=max;
class HostError extends Error {constructor(status){super('Request rejected');this.status=status;}}
const deny=status=>{throw new HostError(status);};

// Returns an UNBOUND server. This host has no Wallet service, fallback router,
// automatic listen/start command, migration runner or production configuration.
export function createLoyaltyHttpHost({origin,handler,maxInFlight=8,maxConnections=32,
  maxBodyBytes=8192,headerTimeoutMs=5000,bodyTimeoutMs=5000,operationTimeoutMs=15000,
  maxResponseBytes=4096}={}) {
  let canonical;try{canonical=new URL(origin);}catch{throw new TypeError('Invalid API host');}
  if(canonical.protocol!=='https:'||canonical.href!==canonical.origin+'/'||typeof handler!=='function'||
    !integer(maxInFlight,1,32)||!integer(maxConnections,maxInFlight,128)||!integer(maxBodyBytes,128,65536)||
    !integer(headerTimeoutMs,10,10000)||!integer(bodyTimeoutMs,10,10000)||!integer(operationTimeoutMs,10,15000)||
    !integer(maxResponseBytes,256,65536))throw new TypeError('Invalid API host');
  const sockets=new Set(),socketState=new WeakMap(),jobs=new Set();let active=0,closing=false,closePromise;
  function end(res,status,body,headers={}) {
    if(res.destroyed||res.headersSent)return;
    // One request per connection prevents unread-body/pipelining reuse. Never
    // drain an arbitrary rejected body just to keep a connection alive.
    res.once('finish',()=>res.socket?.destroy());
    res.writeHead(status,{...headers,...quiet});res.end(body);
  }
  function rawBody(req,declared) {
    return new Promise((resolve,reject)=>{
      const image=Buffer.alloc(maxBodyBytes),deadline=performance.now()+bodyTimeoutMs;let n=0,reads=0,settled=false;
      const cleanup=()=>{clearTimeout(timer);for(const [event,fn]of [['data',data],['end',done],['error',bad],['aborted',bad]])req.removeListener(event,fn);};
      const finish=(error)=>{if(settled)return;settled=true;cleanup();if(error){req.pause();reject(error);}else resolve(image.subarray(0,n));};
      const data=chunk=>{
        if(performance.now()>=deadline)return finish(new HostError(408));
        if(++reads>maxBodyBytes+33||!Buffer.isBuffer(chunk)||chunk.length>maxBodyBytes-n)return finish(new HostError(413));
        chunk.copy(image,n);n+=chunk.length;
      };
      const done=()=>finish(performance.now()>=deadline?new HostError(408):n!==declared?new HostError(400):null);
      const bad=()=>finish(new HostError(400));
      const timer=setTimeout(()=>finish(new HostError(408)),bodyTimeoutMs);
      req.on('data',data);req.once('end',done);req.once('error',bad);req.once('aborted',bad);
    });
  }
  function claim(req){
    const state=socketState.get(req.socket);
    // Never queue a second response behind an in-flight write. Merely setting
    // Connection:close on that queued response permits unbounded pipelining.
    if(!state||++state.requests!==1){req.socket.destroy();return false;}
    clearTimeout(state.headerTimer);return true;
  }
  function rawReject(socket,status){socket.pause();socket.once('finish',()=>socket.destroy());socket.end(`HTTP/1.1 ${status}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);}
  async function serve(req,res) {
    let admitted=false,operationTimer;
    try {
      if(!claim(req))return;
      if(closing)return end(res,503);
      const method=req.method??'',target=req.url??'';
      if(target.length>8192)deny(414);
      if(!target.startsWith('/')||target.startsWith('//')||/[#\\%\x00-\x20\x7f]/.test(target))deny(404);
      const parsed=new URL(target,canonical);
      if(parsed.origin!==canonical.origin||parsed.pathname!==target.split('?')[0])deny(404);
      const fields=new Map();
      if(req.rawHeaders.length>128)deny(431);
      for(let i=0;i<req.rawHeaders.length;i+=2){const key=req.rawHeaders[i].toLowerCase();if(fields.has(key))deny(400);fields.set(key,req.rawHeaders[i+1]);}
      if(fields.get('host')?.toLowerCase()!==canonical.host)deny(404);
      if(fields.has('transfer-encoding')||fields.has('expect')||fields.has('upgrade')||fields.has('trailer'))deny(400);
      const length=fields.get('content-length');
      if(length!==undefined&&(!/^(?:0|[1-9][0-9]*)$/.test(length)||!Number.isSafeInteger(Number(length))))deny(400);
      const declared=Number(length??0);if(declared>maxBodyBytes)deny(413);
      if(target==='/healthz'&&method==='GET'&&declared===0)return end(res,204);
      if(!apiPath.test(parsed.pathname))deny(404);
      const post=parsed.pathname.endsWith('/stamps')||parsed.pathname.endsWith('/redemptions');
      if(method!==(post?'POST':'GET'))return end(res,405,undefined,{Allow:post?'POST':'GET'});
      if(post&&length===undefined)deny(411);
      if(!post&&declared!==0)deny(400);
      if(active>=maxInFlight)deny(503);
      active++;admitted=true;
      const headers=new Headers();for(const key of forwarded)if(fields.has(key))headers.set(key,fields.get(key));
      const body=post?await rawBody(req,declared):undefined;
      if(req.aborted||res.destroyed)return;
      const controller=new AbortController();
      const disconnected=()=>controller.abort();res.once('close',disconnected);
      // The operation keeps its capacity slot until the actual handler settles,
      // even if a response timeout/disconnect occurs. No unbounded shadow queue.
      // A timed-out write may still commit: retry only with the same key.
      const operationDeadline=performance.now()+operationTimeoutMs;
      operationTimer=setTimeout(()=>{controller.abort();end(res,503);},operationTimeoutMs);
      try {
        const response=await handler(new Request(parsed,{method,headers,body,signal:controller.signal}));
        if(controller.signal.aborted||performance.now()>=operationDeadline)deny(503);
        if(!(response instanceof Response))throw new Error('Invalid handler response');
        const output=response.body?await readBoundedStream(response.body,{maxBytes:maxResponseBytes,timeoutMs:Math.max(1,Math.min(Math.floor(operationDeadline-performance.now()),5000)),signal:controller.signal}):undefined;
        const out={};let headerBytes=0;
        for(const [key,value]of response.headers){headerBytes+=key.length+value.length+4;if(headerBytes>8192)throw new Error('Response headers too large');if(allowedResponse.has(key))out[key]=value;}
        if(controller.signal.aborted||performance.now()>=operationDeadline)deny(503);
        end(res,response.status,output,out);
      }finally{res.removeListener('close',disconnected);}
    }catch(error){end(res,error instanceof HostError?error.status:503);}
    finally{clearTimeout(operationTimer);if(admitted)active--;}
  }
  const server=createServer({maxHeaderSize:8192,headersTimeout:headerTimeoutMs,requestTimeout:headerTimeoutMs+bodyTimeoutMs,
    keepAliveTimeout:1,connectionsCheckingInterval:1000},(req,res)=>{
    const job=serve(req,res);jobs.add(job);job.then(()=>jobs.delete(job),()=>jobs.delete(job));
  });
  // Parser bytes cap precedes rawHeaders counting; do not silently drop headers
  // using maxHeadersCount, which could hide duplicates from validation.
  server.maxHeadersCount=0;server.maxConnections=maxConnections;
  server.on('connection',socket=>{
    if(closing){socket.destroy();return;}
    sockets.add(socket);const state={requests:0,headerTimer:setTimeout(()=>socket.destroy(),headerTimeoutMs)};socketState.set(socket,state);
    socket.once('close',()=>{clearTimeout(state.headerTimer);sockets.delete(socket);});
  });
  server.on('checkContinue',(req,res)=>{if(claim(req))end(res,417);});
  server.on('checkExpectation',(req,res)=>{if(claim(req))end(res,417);});
  server.on('upgrade',(req,socket)=>{if(claim(req))rawReject(socket,'400 Bad Request');});
  server.on('connect',(req,socket)=>{if(claim(req))rawReject(socket,'405 Method Not Allowed');});
  server.on('clientError',(error,socket)=>{if(socket.writable)rawReject(socket,error.code==='HPE_HEADER_OVERFLOW'?'431 Request Header Fields Too Large':'400 Bad Request');else socket.destroy();});
  function close(){if(closePromise)return closePromise;closing=true;closePromise=(async()=>{const stopped=new Promise((resolve,reject)=>{if(!server.listening)return resolve();server.close(error=>error?reject(error):resolve());});for(const socket of sockets)socket.destroy();await stopped;await Promise.allSettled([...jobs]);})();return closePromise;}
  return Object.freeze({server,close,inspect:()=>Object.freeze({active,connections:sockets.size,closing})});
}
