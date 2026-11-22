# Atomic loyalty HTTP contract

This is a Fetch Request/Response handler, not a running HTTP server, deployment,
merchant frontend or real identity-provider connection. It delegates to the
reviewed canonical ledger from PR9, preserving that transaction boundary.
There is no second authorize callback or stamp-intake counter. It does not
import or call the old Wallet stamp store, mutate the offline sender, open a
listener, configure a provider, issue a Wallet pass or dispatch a push.

The source branch is based on PR9's exact3dac1cecaca900391b78bf4ef958961871ab47ed.
PR9's existing general-app typecheck failure is unchanged; PR8 separately repairs
that unsupported Wallet prop. This unit does not claim a clean app build.

## Trusted host composition

Create the ledger with its restricted PostgreSQL pool and the real configured
OIDC access-token verifier. Pass that ledger to createLoyaltyHttpHandler with
the canonical HTTPS application API origin. The handler has no token-decoder or
membership callback to replace the ledger's own authorization. The host must
not pass a stub ledger in production. Missing configuration fails at creation.

The existing Wallet /v1 namespace belongs to Apple PassKit, not this API. This
handler serves only /api/v1/loyalty routes and returns404 for /wallet/stamps and
/v1. It does not disable a separate old Wallet server: an integrated host must
keep that legacy stamp route disabled, not compose two balance authorities.
The old sender lacks a merchant bearer token, membership ID and location ID;
it is not silently adapted to this contract. Existing demo self-stamping is
not a production permission model.

## Endpoints

POST /api/v1/loyalty/stamps
POST /api/v1/loyalty/redemptions

Required headers:

- Authorization: Bearer followed by the compact signed JWT. The handler checks
  framing only; the ledger's verifier checks signature, issuer, audience and
  token times. Identity claims alone never grant merchant permission.
- Idempotency-Key:16 to100 ASCII letters/digits/underscore/hyphen. Persist this
  command key until the result is resolved. Do not generate a new one on retry.
- Content-Type: application/json, optionally charset=utf-8.

The body is a flat object containing exactly these three string fields:

    {"businessId":"merchant-slug","membershipId":"card-uuid","locationId":"branch-uuid"}

businessId uses the existing ledger's1..60 ASCII letter/digit/underscore/hyphen
contract. Card and branch UUIDs are validated and normalized to lowercase.
Client balances, roles, timestamps, pass IDs and extra fields are rejected.
JSON.parse owns JSON grammar; the flat string-only schema also checks lexical
string-token cardinality to reject overwritten duplicate keys, including
escaped key spellings. There is no separate invented general JSON parser.

A successful command returns200 with transaction.kind, transaction.balance,
transaction.duplicate and the same idempotencyKey. rewardReady is present only
when returned by the ledger. Only these allowlisted fields are returned, not
arbitrary adapter internals. A200 means the canonical transaction or its
idempotent original has completed, not that Wallet updates were delivered.

GET /api/v1/loyalty/passes/{membershipUUID}?businessId={businessId}

Requires the same bearer identity and exactly one businessId parameter. No
body or nonzero length/framing is accepted. The ledger applies live canonical
merchant/staff/program/card permissions on its own transaction. The response
contains an allowlisted membership snapshot: ID, passId, balance, lifetime
stamps, redeemed count, active status, target, reward text and timezone. It is
a merchant read, not customer ownership proof or a Wallet mint capability.

## Failures, retries and permissions

Every response uses private,no-store, no-referrer and nosniff. Errors expose
only a stable code and retryable flag, never token, stack, SQL or driver text.

| Status | Meaning | Automatic retry |
| --- | --- | --- |
|400|Malformed JSON/fields/query/key/length, or aborted body read|No|
|401|Missing/malformed bearer or unverified identity|No, reauthenticate first|
|403|Canonical permission denied or forbidden browser Origin|No|
|404|Unknown route/origin or unavailable authorized resource|No|
|405|Wrong method, with Allow header|No|
|408|Body deadline exceeded before command dispatch|Same key only|
|409|Idempotency mismatch, reward state, daily limit or cooldown conflict|No blind retries or new key|
|413/414/415/431|Body/read-work too large, URL too long, unsupported media/encoding or normalized headers too large|No|
|503|Backend failure or invalid adapter result|Same key only|

A request can lose its response after COMMIT. Retry the identical command with
the same key and actor, even after token refresh. Reusing the key for a different
command/location/actor is a conflict. Successful replay still requires current
permission and active lifecycle. A post-dispatch abort is not a guarantee that
the transaction was canceled. Read current state or replay the original key.

No cookie supplies identity. No CORS wildcard or cross-origin credential policy
is enabled. Native clients may omit Origin; a supplied Origin must equal the
configured API origin. Browser cross-origin deployment needs a separately
reviewed allowlist/CSRF/session plan, not a permissive default.

## Resource and transport boundary

Defaults are8192 body bytes,8192 normalized header bytes and a5000ms total body
read/parse deadline. The normalized Request URL is capped at8192characters
before URL parsing. Explicit bounded configuration supports128..65536 body bytes,
256..32768 normalized header bytes and1..10000ms. Declared length is validated,
but actual streamed bytes are always counted. One preallocated byte image
bounds retained body memory; chunk objects are not accumulated. A separate
read-work budget of maxBodyBytes+33 counts every read, including empty chunks
and EOF. It permits a fully one-byte-fragmented body plus32empty reads; an
excessive zero-byte producer gets413 BODY_WORK_LIMIT with no ledger dispatch.

A monotonic absolute deadline is checked before/after each read, after each
periodic event-loop yield and after parsing. A timer additionally interrupts
stalled awaits. Every64reads explicitly yields so an immediately fulfilled
producer cannot starve timer/abort callbacks or other requests indefinitely.
The deadline detects expiry when execution resumes; it cannot preempt arbitrary
synchronous producer code or guarantee a response by an exact millisecond.
Compressed bodies are refused, UTF-8 decoding is fatal on invalid sequences,
and abort/deadline/limit paths cancel the reader without waiting on an untrusted
asynchronous cancel hook. Normalized headers reject over-budget values before
encoding allocations where possible, and stop iteration immediately on overflow.

The Request object already exists at this boundary. A production network
adapter must independently cap raw headers/targets/connections and enforce
request framing, TLS, concurrency, rate limits and safe socket cleanup BEFORE
constructing it. These unit/integration tests do not prove raw HTTP smuggling,
proxy behavior or network denial-of-service resistance. No Node listener or
production ingress is added here.

## Tests and remaining work

- tests/loyalty-http.test.mjs explicitly stubs the ledger to isolate transport
  validation, budgets, cancellation, error mapping and response filtering.
  Adversarial regressions include infinite immediate empty chunks, a producer
  delaying timer processing, asynchronous abort fairness, legitimate one-byte
  fragmentation and pre-parse URL rejection. All refusal paths check no ledger
  side effect. The original reviewer20,000empty-chunk probe also rejects with
  zero dispatch on the corrected source; it is not claimed as a load benchmark.
- tests/loyalty-http-postgres.test.mjs uses actual signed RS256 test tokens,
  a pinned local synthetic JWKS and the actual OIDC verifier, actual ledger,
  current migrations and a restricted PostgreSQL LOGIN. This is not a live IdP.
  A private disposable PostgreSQL14.24 cluster uses a Unix socket, no TCP and
  no external database configuration. Cleanup stops it and removes its data.
- Actual integration covers stamp/read/redemption, concurrent command replay,
  invalid signatures/audience/expiry, tenant and revocation denials, a handler
  waiting on a proven PostgreSQL permission lock, and post-event failure with
  rollback503 followed by one successful same-key retry.

Run with server binaries available, setting PG_BIN when needed:

    npm ci --ignore-scripts --no-audit --no-fund
    node --test tests/loyalty-http*.test.mjs

The added workflow only runs checks and tracks actual API/auth/loyalty/package
source dependencies. No deployment or publishing action is added.

Still required: independent review and exact-tip CI for this source, a hardened
network adapter, abuse controls, real provider/session configuration, connected
merchant/customer UI, customer custody, durable version/outbox projection and
Wallet/device/production verification. Ledger targets1..100/reward text200 are
NOT clamped to the current Wallet renderer's narrower4..12/160 limits. That
compatibility problem remains explicit for the projection slice; this API
neither issues a pass nor silently changes those program rules.
