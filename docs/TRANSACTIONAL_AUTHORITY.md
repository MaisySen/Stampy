# Loyalty transaction authority and lifecycle boundary

This change is backend foundation code. It exposes no HTTP route, provisions no
merchant and does not connect the existing Wallet stamp intake to this ledger.
The existing separate Wallet authorizer/record path remains unqualified for
this atomic boundary. Do not enable it by pointing it at this module blindly.

## Source composition

The isolated branch composes these unchanged prerequisites, without updating
main, local/demo or Wallet-preview refs:

- Identity PR5: 4d286a120206b087682860e3b36d715ba8bccf3a.
- Ledger PR7: 1a13ff9df4a73abc31cb5958c1d13e085a38fad3.
- Wallet ingress PR3: 44ace91d3d82f68e67eb968a9f5efecc3c9d61ae.

PR7 was not a git stack on PR5. Its pinned identity fixture is byte-identical
to PR5's actual identity migration, SHA256
`e41c3b49e1e3d8d5f290bb848614f9029ba2947c2dfc727b7f13da13d8398a70`.
Integration contains those PRs' existing checks workflows, including their
push-to-main triggers. No workflow deploys or publishes software.

## Exact contract

JWT signature/issuer/audience/expiry verification occurs before acquiring a DB
client. Claims provide only issuer and subject. There is no read-only-pool
membership authorization callback in the ledger anymore. Every staff-controlled
operation, including getMerchantPass, calls a fixed SQL permission helper on
its own transaction/client. The helper returns the canonical merchant UUID.

Permission locks are explicit sequential statements:

1. Merchant by business ID, FOR SHARE; require active.
2. That merchant's issuer/subject membership, FOR SHARE; require active and
   a role allowed by a closed operation mapping.
3. Program, FOR SHARE, require active, when applicable.
4. Location, FOR SHARE, require active, for stamp/redemption.
5. Card, FOR UPDATE for stamp/redemption or FOR SHARE for read; require active
   and revalidate its program ID.

The initial unlocked discovery of a card's program is only routing. The card's
program relation is checked again under its final lock. Query planner join
order is not used to define lock order. Future administrative multi-row
operations must follow the same parent-before-child order, and must not treat
this as a full deadlock-proof administrative API.

All permission and lifecycle locks survive to transaction COMMIT/ROLLBACK.
If a revoke/downgrade/delete/suspension commits before the operation gets its
lock, the operation rejects. If the operation locks first, it may commit and
the lifecycle change waits. This is serial ordering, not instant cancellation
of in-flight operations. It does not revalidate JWT expiration after a wait.

Replay still requires live permission and active program/location/card. A
suspended actor or closed location cannot use an old key to bypass lifecycle
checks. An accepted replay returns its original result without another event.

## Enrollment and time

Anonymous enrollment does not require a staff identity. It discovers the public
program, locks its canonical merchant through a separate narrow helper, then
locks the program and rechecks public-code binding. It deletes the one-time
grant inside the transaction, obtaining its write lock, and only then samples
the server clock. An expired grant causes rollback, which restores that grant;
it does not create a customer. Successful competing enrollments cannot both
consume one grant. Cancellation and consumption serialize on that grant row.

Stamp/redemption timestamps, local-day rules and cooldowns sample the clock
after the final blocking card lock. Grant creation samples after permission
and program locks; its five-minute TTL does not start before a lock wait.

## Privilege model

Apply migration002 only after both original schemas and the original loyalty
runtime grants. Migration002 creates functions and immediately revokes PUBLIC
execution and grants explicit runtime execution in one transaction.

The function owner is stampies_permission_locker, a nonlogin, noninheriting,
nonsuperuser role without database/role creation, replication or bypass-RLS
capabilities. The dedicated role must be absent cluster-wide before this versioned migration.
ANY preexisting role is rejected, including one with harmless-looking flags:
its inherited memberships, ownership and grants are not silently reused. The
fresh role has no table ownership. It receives SELECT of required identity
columns plus UPDATE(updated_at), and SELECT of lifecycle program/location
fields plus UPDATE(id), because PostgreSQL requires some UPDATE privilege for
row locks. The runtime never gets these UPDATE grants. The owner temporarily receives schema CREATE only for ownership
transfer; it is revoked before COMMIT. Its functions use fully qualified
relations and fixed search_path `pg_catalog, pg_temp`, no dynamic SQL.

Two additional static SECURITY DEFINER functions perform the program and
location SHARE-lock queries. The runtime receives EXECUTE only, not UPDATE(id):
it cannot rename UUIDs or update status, target or rules. All four helper ACLs
are checked before COMMIT, including grants inherited from unsafe default
function privileges. Any unexpected audience or runtime grant option aborts
the whole migration rather than silently publishing an extra EXECUTE grant. The runtime already writes the loyalty ledger.
It must remain a trusted server principal, never an exposed client connection.
The function owner cannot be assumed by that runtime. Runtime cannot replace
functions, change their owner/search_path or create objects in identity schema.

This is not RLS or isolation from a compromised database principal. No client,
Wallet signing role or anonymous visitor receives runtime credentials. Abuse
limits, secure hosting and secret management are still separate requirements.

## Tests and limits

`npm ci --ignore-scripts --no-audit --no-fund` installs exact pg8.23.1 as a dev
harness dependency. There is no install-time lifecycle script execution.

Run, with PostgreSQL server/client binaries available:

    node --test tests/loyalty-ledger.test.mjs
    node --test tests/loyalty-ledger-postgres.test.mjs
    node --test tests/loyalty-ledger-authority-postgres.test.mjs

Set PG_BIN to a directory containing PostgreSQL server binaries when needed.
The original SQL/grants regression remains unchanged and does not apply002.
The new harness applies actual identity001, loyalty001, runtime grants and002
in a fresh cluster. Actual auth-reader and Wallet schema/role provisioning is
also applied for negative audience tests. The adapter connects as a dedicated nonsuperuser LOGIN
inheriting only the runtime role, not as the migration owner or through SET
ROLE on an administrative session. Administrative fixture/lifecycle operations
use a separate test connection. Real independent connections, query barriers
and pg_blocking_pids assertions establish waits. Polling has finite deadlines;
a delay alone is not proof. Pools have finite sizes and statement/lock timeouts.

Coverage includes all staff-method viewer denial, permission downgrade/revoke/
delete and merchant/program/location/card lifecycle orderings, grant races,
parallel stamps/replays/redemptions, tenant rejection, post-event rollback,
local midnight/cooldown after lock waiting, and grant expiry/TTL after waiting.
The new suite also proves rejection/atomic rollback of a preexisting locker
role and unsafe function-default ACLs. It inspects actual ACLs, owner/configuration
and denied runtime identity/schema/function/UUID operations, attempts all four
helpers from real Wallet/auth-reader/PUBLIC-only login audiences, and exercises
a successful restricted-runtime path through every adapter method. It confirms cluster shutdown and removal.

Local PostgreSQL14.24 is the tested server, not a production deployment or
all-supported-version certification. Complete DST, crash/power-loss recovery,
performance, auth-provider/device/Wallet/API integration and backup restore
are not claimed. No customer owner binding or Wallet source-version/outbox
projection is added here.

## Migration and rollback

Use a privileged migration connection, not an application startup hook. Apply
002 atomically before switching to the new adapter. It is a versioned migration,
not an idempotent reconciliation script: do not rerun it silently. Role names
are cluster-wide; deployment to another database sharing a cluster needs a
reviewed naming/provisioning plan, not ambient-role reuse. Existing
identity/loyalty rows are retained. Test upgrading from the exact prior schema.

On failure the SQL transaction rolls back functions/grants/role changes. On
application rollback, disable affected handlers and retain additive migration
objects pending a reviewed forward fix. Do not fall back to the old pretx
permission check and represent that as equally protected. No destructive down
migration, data deletion, production role credential or automatic rollout is
provided. There is no HTTP/onboarding surface in this slice.
