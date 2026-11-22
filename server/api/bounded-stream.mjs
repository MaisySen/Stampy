import {performance} from 'node:perf_hooks';
import {setImmediate as yieldTurn} from 'node:timers/promises';

// Server-internal bounded stream primitive. Cancellation is best effort and
// never awaited: an upstream cancel hook cannot hold the request open.
export async function readBoundedStream(stream,{maxBytes,timeoutMs=5000,signal}={}) {
  if(!stream||typeof stream.getReader!=='function'||!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>1048576||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000)throw new Error('Invalid bounded stream');
  const reader=stream.getReader(),image=new Uint8Array(maxBytes),deadline=performance.now()+timeoutMs;
  let bytes=0,reads=0,timer,abort;
  const guard=()=>{if(signal?.aborted||performance.now()>=deadline)throw new Error('Stream deadline');};
  const failure=new Promise((_,bad)=>{
    timer=setTimeout(()=>bad(new Error('Stream deadline')),timeoutMs);
    abort=()=>bad(new Error('Stream aborted'));
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  });failure.catch(()=>{});
  try {
    for(;;){
      guard();if(++reads>maxBytes+33)throw new Error('Stream work limit');
      const {value,done}=await Promise.race([reader.read(),failure]);guard();if(done)break;
      if(!(value instanceof Uint8Array)||value.byteLength>maxBytes-bytes)throw new Error('Stream byte limit');
      image.set(value,bytes);bytes+=value.byteLength;
      if(reads%64===0){await Promise.race([yieldTurn(),failure]);guard();}
    }
    return image.subarray(0,bytes);
  } finally {
    clearTimeout(timer);signal?.removeEventListener('abort',abort);
    try{reader.cancel().catch(()=>{});}catch{}try{reader.releaseLock();}catch{}
  }
}
