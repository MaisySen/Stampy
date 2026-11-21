import { createWalletService } from '../service.mjs';
import { openPostgresIssueGrants } from './issue-grants.mjs';
import { openPostgresAppleUpdates } from './apple-registrations.mjs';
import { openPostgresStampLedger } from './stamp-ledger.mjs';
import { verifyWalletRuntimeRole } from './runtime-role.mjs';

// Postgres-backed Wallet service. The restricted runtime role is verified
// before the service accepts requests, so a wrongly privileged database
// login fails fast at startup instead of serving a broken backend. The
// caller owns pool lifecycle. The SQLite path has no pool and never calls
// this; openWalletService in service.mjs is untouched.
export async function openPostgresWalletService({ pool, ...options }) {
  await verifyWalletRuntimeRole(pool);
  return createWalletService({
    ...options,
    grantStore: openPostgresIssueGrants({ pool }),
    stampStore: openPostgresStampLedger({ pool }),
    openUpdates: (opts) => openPostgresAppleUpdates({ pool, ...opts }),
  });
}
