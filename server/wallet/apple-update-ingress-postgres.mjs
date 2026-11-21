import {APPLE_WALLET_ORIGIN,createAppleFetchIngress} from './apple-fetch-ingress.mjs';
import {openPostgresAppleUpdates} from './postgres/apple-registrations.mjs';
import {verifyWalletRuntimeRole} from './postgres/runtime-role.mjs';

// The caller owns the isolated TLS connection pool and private pass signer.
// Never initialise with an owner connection, at import time, or from a request.
// This update plane cannot issue passes, stamp cards, or dispatch notifications.
export async function openAppleUpdateIngress({pool,rootKey,signApple}={}) {
  if(!Buffer.isBuffer(rootKey) || rootKey.length!==32 || typeof signApple!=='function')
    throw new Error('Wallet update credentials not configured.');
  await verifyWalletRuntimeRole(pool);
  const update=openPostgresAppleUpdates({pool,origin:APPLE_WALLET_ORIGIN,rootKey,signApple});
  const updateService={handle:(request)=>new URL(request.url).pathname.startsWith('/v1/')
    ? update.handle(request)
    : new Response(null,{status:404})};
  return createAppleFetchIngress(updateService);
}
