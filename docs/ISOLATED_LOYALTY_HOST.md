# Isolated loyalty HTTP host and composition

This is an unbound host factory and tested server composition, not a deployed
application or completed merchant sign-in. No default listen/start command,
provider choice/configuration, database migration, merchant seed, Wallet
signer, public mint, browser cookie session or production credentials exist in
this unit. Tests bind only disposable 127.0.0.1 port 0. Nothing changes main,
local/demo, Wallet-preview or the separately running legacy Wallet service.

The branch descends from atomic HTTP PR10. It applies the exact App.tsx removal
from PR8 d3f7b7e07179d60afa12fccd526be2e1c17a5c0f, so the known unsupported
onAddToWallet prop does not persist in this composition. Existing broader CI
pull_request/push-main triggers are retained. pg8.23.1 moves from dev to runtime
dependencies without changing its pinned version or resolved package bytes.

## Raw transport boundary

server/api/http-host.mjs returns an UNBOUND Node HTTP server. The trusted origin
must be canonical HTTPS; the eventual operator must provide a separate approved
TLS ingress. Host and canonical origin are never inferred from forwarding
headers. Cookie, forwarding and other unneeded incoming headers are not passed
to the application. Supplied Origin and Idempotency-Key are preserved.

The only route namespaces are the exact two POST commands and UUID GET lookup
in /api/v1/loyalty, plus GET /healthz. Health is process liveness, not database
readiness or provider reachability. No Wallet module is imported or delegated
to, and /wallet/stamps, /wallet/apple, /wallet/google and /v1 all reject before
application dispatch. A different listener running the old Wallet server is
not disabled by this factory; deployment routing and old listener retirement
remain an operator release gate.

Requests use one connection each and always close it. The parser caps raw header
bytes at8192; the host rejects more than64 fields and ALL duplicate names,
including authorization, Host and idempotency fields. A raw target is capped
at8192 characters, must be origin-form and unnormalized, and cannot contain
percent escapes, whitespace, fragments or backslashes. The parser may reject
an oversized request as431 before the host's414 target guard.

Transfer-Encoding, trailers, upgrade, CONNECT and Expect are not admitted.
POST requires one canonical Content-Length and JSON; chunked requests are
intentionally unsupported. Unexpected GET payloads, length mismatch, compressed
JSON and byte/schema ambiguity fail closed. Rejected bodies are not drained for
connection reuse. A single preallocated buffer bounds collection; every body
chunk counts against a finite work cap. Monotonic deadline checks complement
real header/body timers. These checks detect expiry when execution resumes,
not hard real-time preemption of JavaScript or the OS network stack.

Default caps:32 accepted connections,8 active commands,8192 body bytes,
5s headers,5s body,15s operation response,4096 response bytes. Constructor
ranges bound configurable limits. No application waiting queue exists:
admission at capacity returns503. maxInFlight equals the owned pool maximum.
Timed-out/disconnected operations KEEP their capacity slot until the actual
handler settles, so response timeouts cannot create unbounded background work.
Responses have bounded streamed byte/read/deadline work and a small header
allowlist. Security/cache/connection headers cannot be overridden by a handler.
Errors do not echo request bodies, tokens, DB or provider details.

## Actual server composition and startup

server/api/application.mjs creates its own pg.Pool, canonical OIDC verifier,
transactional ledger, Fetch handler and raw host. Database host, port, username
and database must be explicit. Remote connections require certificate-verifying
TLS and cannot supply a custom hostname-verification callback. An explicit
password callback avoids ambient PGPASSWORD/pgpass substitution; ssl is also
explicit. Unix sockets are for private deployment/test configuration, not a
public listener. Credentials remain private deployment configuration.

The pool has finite max/admission,2s acquisition,6s client query timeout,
5s server statement timeout,4s lock timeout and6s idle transaction timeout.
Search path is pg_catalog. A failed checked-out connection is destroyed,
not released as a reusable active/timed-out transaction. An idle pool error
fails later application dispatch closed until operator restart.

Before returning even the unbound server, runtime-role.mjs checks the actual
session login, required role membership and effective table/column/schema/
function/sequence privileges. It rejects privileged logins, unrelated role
membership, persistent schema/database CREATE, extra data/sequence access,
extra user-function EXECUTE and helper ACL/owner/search-path deviations. This
is a startup snapshot, not continual catalog monitoring, RLS, cryptographic
verification of stored function bodies or isolation from a compromised trusted
server/database operator. Restricting production principal administration is
still required.

Fresh PostgreSQL14 grants CREATE on public to PUBLIC. The host deliberately
refuses that ambient capability. An operator must separately review/revoke
that grant for the deployment, not have application startup change it. Tests
perform that step only in the disposable cluster and prove denial first.
Migrations and canonical helper-role provisioning remain privileged work.

## Identity/provider boundary

Issuer, HTTPS JWKS URL and API audience are required; no provider is selected.
An explicitly named browser client ID must differ from the API audience.
That checks configuration separation, not whether an unconfigured provider
correctly distinguishes all token purposes. Actual provider access-token
issuance, social login, recovery, account verification, JWKS rotation and
browser/session/logout/device behavior remain unverified integration work.

JWKS fetch refuses redirects, caps actual streamed bytes at65536 and keys at50,
counts even empty reads, yields periodically and uses an overall monotonic
fetch/read/parse deadline plus AbortController. A fetch implementation ignoring
abort still loses the race; a late response body is canceled without waiting
on its cancel hook. RSA keys are restricted to2048..8192 bits with bounded
public-number encodings. These paths use synthetic local signed keys in tests,
not real provider credentials or requests. Existing signature, issuer,
audience, expiry and canonical transactional permission checks remain active.
Unknown-kid refreshes are single-flight, not a per-actor abuse-rate policy.

## Writes, deadlines and shutdown

A body/header rejection occurs before ledger dispatch. Once dispatched, a
response timeout or disconnect does NOT prove that a write was canceled or
rolled back. It may commit after the client leaves, or a COMMIT reply may be
lost. Clients must retain and retry the SAME idempotency key to reconcile the
result, never make a new key because the first response was uncertain.

close() is shared/idempotent. It stops admission, closes the listener and its
tracked sockets, awaits actual in-flight jobs, then closes the owned pool.
Individual fetch/acquisition/query/lock/statement operations are bounded;
shutdown is not advertised as an instantaneous global transaction cancel.

## Evidence and limits

- Raw socket transport tests cover duplicates, framing, unknown/legacy routes,
  wrong Host/encoded/absolute/dot-segment targets, negotiation, slow headers/
  bodies, disconnects, overload, retained timeout slots, response limits,
  timer-starved handlers, forwarding-header stripping and closed cleanup.
- Actual local PostgreSQL14.24 tests use a restricted LOGIN and the original
  migrations plus transactional authority002. They prove startup negatives,
  valid signed-JWT socket transactions/replays/redemption, audience/tenant/
  authority-field denial, an observed permission-lock/revocation barrier, and
  an already-dispatched disconnected write that commits then reconciles by key.
- Typecheck/npm/backend results must be reported at the final exact source tip.
  Local Node22.23.5 differs from pinned CI22.23.2. Actual remote CI is a later
  publication check, never inferred from these local tests.

No new customer custody, ownership capability, canonical source-version/outbox,
Wallet projection or issuance, API rate-limit identity policy, frontend session,
merchant onboarding, browser CSRF/session support, billing, production backup,
release/deployment/device/performance certification is added. Existing loyalty
rules target1..100/reward200 are unchanged. Existing Wallet4..12/160 mismatch is
not clamped or hidden. Live Wallet/provider effects remain held.
