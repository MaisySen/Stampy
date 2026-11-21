import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { PASS_TYPE_IDENTIFIER } from '../../../src/lib/pass.ts';
import { appleRegistrationProtection } from '../apple-update-protocol.mjs';
import { walletPgTransaction } from './issue-grants.mjs';

const failureCap=8;
const leaseSeconds=20;
const maxBatch=8;
const deadlineMs=8500;
const providerDeadlineMs=5500;
const tables='stampies_wallet';
const exactWake=`w.device=$1 AND w.serial=$2 AND w.revision=$3 AND w.lease_id=$4
  AND w.lease_until>clock_timestamp() AND r.device=w.device AND r.serial=w.serial AND r.encrypted_push=$5`;

// Claim briefly in SQL, send outside the transaction, then reconcile that exact lease,
// revision and encrypted push token. Retries are intentionally at-least-once.
export function openPostgresAppleWakeDispatch({pool,rootKey}) {
  if(typeof pool?.connect!=='function'||typeof pool?.query!=='function')throw new Error('A private Wallet Postgres pool is required.');
  const protection=appleRegistrationProtection(rootKey);
  const w=`${tables}.apple_wake`, r=`${tables}.apple_registration`;
  async function claim() {
    return walletPgTransaction(pool,async(db)=>{
      const result=await db.query(`WITH candidate AS (
        SELECT w.device,w.serial,r.encrypted_push FROM ${w} AS w JOIN ${r} AS r USING(device,serial)
        WHERE w.failures<$3 AND w.ready_at<=clock_timestamp()
          AND (w.lease_until IS NULL OR w.lease_until<=clock_timestamp())
        ORDER BY w.ready_at,w.revision,w.device,w.serial LIMIT 1 FOR UPDATE OF w SKIP LOCKED
      ) UPDATE ${w} AS w SET lease_id=$1, lease_until=clock_timestamp()+make_interval(secs=>$2)
        FROM candidate AS c WHERE w.device=c.device AND w.serial=c.serial
        RETURNING w.device,w.serial,w.revision,w.lease_id,c.encrypted_push`,[randomUUID(),leaseSeconds,failureCap]);
      return result.rows[0];
    });
  }
  async function settle(item,status) {
    const args=[item.device,item.serial,item.revision,item.lease_id,item.encrypted_push];
    return walletPgTransaction(pool,async(db)=>{
      if(status==='accepted'){
        return (await db.query(`DELETE FROM ${w} AS w USING ${r} AS r WHERE ${exactWake}`,args)).rowCount===1;
      }
      if(status==='unregistered'){
        // Match the writer's clock/registration ordering and pin the wake before cascade.
        const lock=await db.query(`SELECT revision FROM ${tables}.apple_clock WHERE singleton FOR UPDATE`);
        if(lock.rowCount!==1)throw new Error('Wallet revision clock unavailable.');
        const same=await db.query(`SELECT w.lease_id FROM ${w} AS w JOIN ${r} AS r USING(device,serial)
          WHERE ${exactWake} FOR UPDATE OF w`,args);
        if(same.rowCount===1)await db.query(`DELETE FROM ${r} WHERE device=$1 AND serial=$2 AND encrypted_push=$3`,[item.device,item.serial,item.encrypted_push]);
        return false;
      }
      await db.query(`UPDATE ${w} AS w
        SET failures=w.failures+1, ready_at=clock_timestamp()+make_interval(secs=>LEAST(900,15*(1 << w.failures))),
          lease_id=NULL,lease_until=NULL FROM ${r} AS r WHERE ${exactWake}`,args);
      return false;
    });
  }
  async function send(item,sendWake,timeMs) {
    let timer;
    const controller=new AbortController();
    try {
      const token=protection.open(item.device,item.serial,item.encrypted_push);
      return await Promise.race([
        new Promise(resolve=>{timer=setTimeout(()=>{resolve('retry');controller.abort();},timeMs);}),
        Promise.resolve().then(()=>sendWake({topic:PASS_TYPE_IDENTIFIER,pushToken:token},controller.signal)),
      ]);
    } catch { return 'retry'; }
    finally { clearTimeout(timer); }
  }
  async function sendPending(sendWake,max=4) {
    if(typeof sendWake!=='function'||!Number.isInteger(max)||max<1||max>maxBatch)throw new Error('Invalid Wallet push dispatcher.');
    const end=performance.now()+deadlineMs;
    let confirmed=0;
    for(let i=0;i<max && end-performance.now()>=500;i++){
      const item=await claim(); if(!item)break;
      const runtime=Math.max(0,Math.floor(end-performance.now()));
      const delivery=runtime>=100 ? await send(item,sendWake,Math.min(providerDeadlineMs,runtime)) : 'retry';
      if(await settle(item,delivery))confirmed++;
    }
    return confirmed;
  }
  return Object.freeze({sendPending});
}
