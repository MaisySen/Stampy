# Wallet issuance and terminal integration

This module signs Apple and Google loyalty cards on a Node 22 server, not in the app. It does not register issuer accounts, publish an Android or iOS app or enable contactless hardware. The Wallet install screen remains a preview until a live backend is configured.

## Ownership and credentials

- Apple: Pass Type ID `pass.au.fintex.stampies` is registered and verified, 2026-11-21. Mount the matching signing PEM and key, the matching Apple WWDR intermediate, and its official trust root. App Store Connect keys cannot sign Wallet passes. Use a read-only private mount and restart after certificate rotation. Supply server-owned icon artwork for `icon.png` and `icon@2x.png` separately from the app icon. `openssl` is required on the host.
- Google: a Google Wallet issuer must have a configured loyalty class and approve the Wallet service account. Supply its numeric issuer ID, fully qualified class ID, service account email, privately mounted RSA key and exact HTTPS origin. The Google Play upload service account does not belong here.
- Do not add issuer credentials, signed URLs, bearer tokens or generated passes to this repository, GitHub logs or client builds. Run the service with request-rate limits. Do not log request headers, replies or pass IDs.

## Serving a card

Wire `createWalletIssueHandler` into the existing trusted HTTP service. It handles POST `/wallet/apple` and POST `/wallet/google`. The host issues a short-lived random capability scoped to one pass and one platform, and stores its SHA-256 digest. The handler calls a trusted lookup with that digest and the route. The lookup must check expiry, ownership and purpose, and read the current authoritative pass record (opaque pass ID, program, stamp count, redemption state and IANA time zone). A barcode, URL path ID or stamp-count field from a caller is not authority to sign or change a pass. Retry and capability invalidation belong to that store.

The Apple response is a detached CMS signed `.pkpass`; the Google response contains a Save to Google Wallet link signed for the configured class. Without the optional update service below, this only issues the current card. Google Wallet API sync is separate. Keep QR and staff stamping available independently.

## Updating Apple Wallet passes

Use `appleUpdateIdentity({origin, rootKey})` with `createAppleSigner({..., appleUpdates})` and build `openAppleUpdates({dbPath, origin, rootKey, signApple})` around that exact signer. Use a dedicated HTTPS origin. The persistent private SQLite path must survive restarts and have restricted access. Mount the same stable 32-byte secret on every component. Do not share it with the app, Google or another environment; replacing it invalidates authentication for already installed passes.

Mount the Apple `/v1` protocol (`openAppleUpdates().handle`), with the request URL reconstructed from the configured origin and path, not a forwarded user-supplied host. Use network timeouts and request-rate limits. `putPass` is a private application call for the authoritative merchant ledger after a committed stamp or reward change. Do not expose it as an unauthenticated write endpoint. `getPass` reads the same state for issuing current passes. A device cannot change its stamp count through the Wallet endpoints.

Apple calls register/unregister, change listing and pass refresh. The per-pass token stays stable across signed updates; the store persists monotonic update tags and a revision-aware APNs wake queue. Use a single bounded dispatcher with `sendPending`, returning `accepted` only upon provider acceptance. The transport must send the empty pass update notification with the exact Pass Type ID topic and proper Apple certificate. `createAppleWalletPushSender` supplies that dispatcher with the matching pass-signing certificate, private key and Apple trust chain. Pass the returned `sendWake` to `sendPending` from a single bounded dispatcher and call its `close` on shutdown. It uses verified TLS to the production APNs address, the exact pass topic and an empty JSON dictionary. Only a complete HTTP 200 clears the matching wake. An explicit `Unregistered` response removes only the unchanged registration; a concurrent registration or newer revision is not acknowledged by an earlier response. Keep a bounded retry cadence and do not log provider payloads or device tokens. The transport, refusal and concurrency tests use synthetic responses and did not contact Apple APNs. The provider response and payload are not client-facing diagnostics.

Deployment still requires mounting the issued Pass Type certificate and key, stable key custody, authorised origin and persistent storage, a connected merchant ledger, configured APNs sender, and a physical install and update test.

## Hosting the Wallet service

`openWalletService` joins the dedicated HTTPS origin, the two signer routes and Apple’s refresh protocol. Mount its `handle` method on the trusted app server. Call `mint({ownerId, passId, platform})` only after the app authenticates the viewer; the service deliberately exposes no mint, stamp or ledger-write endpoint. `lookupOwnedPass` must check the current authenticated owner and return `{version, record}` from the committed merchant ledger for that exact pass and platform. The service only stores a hash of the single-use grant and checks the current owner again on consumption. A grant expires after 90 seconds, cannot move between platforms, and is not a URL parameter. Re-authorise and mint another after an interrupted issue.

Mount private persistent SQLite storage for both the grant ledger and Apple projections. Supply the configured Apple signer through `makeSigner(identity)` so the installed card uses the same update origin and auth token. Send committed mutations through `committedAppleChange(passId)` with a monotonic merchant revision; never put public client input into that adapter. A stale source revision cannot replace newer pass state and a conflict at the same revision fails closed. Run `flushAppleWakes` from one bounded server-side scheduler and call `await close()` on shutdown. The Android signer still requires its own approved Google issuer and class; a Google Play publishing key does not supply those.

These methods and synthetic tests do not create a server, merchant ledger, issuer account or store distribution. Start only against an approved host and actual merchant authority, then validate real device issue, refresh and hardware separately.

## Contactless

Wallet NFC is off by default. Do not deploy a forwarding endpoint which trusts raw NFC data, a QR code or a caller-supplied count. `createWalletTapBoundary` accepts only deployment-approved Apple VAS or Google Smart Tap adapters. The adapter verifies provider signatures and reader, merchant and audience bindings. The redemption store must atomically verify the active merchant and pass, enforce the current cooldown and quota, and persist the event ID with the result. An allowed fixture event is not a hardware test.

Before enabling NFC: verify Apple’s NFC permission and appropriate Pass Type certificate, or the Google Smart Tap issuer configuration; confirm a compatible terminal, then test real taps and replays with authorised test cards. The pre-existing QR/staff route stays available in the absence of a verified reader.

## Verification

`node --test tests/wallet-server.test.mjs` uses temporary fixture keys. It checks the Apple ZIP and detached signature independently, verifies the Google JWT, and proves that unsigned, expired and repeated reader events do not lead to a second redemption in the test store. It does not prove production certificates, approved issuers, live endpoints, terminals or store builds.
## Postgres Wallet preview

The HTTP adapter and Postgres stores are opt-in server modules. The production app, CI workflow and current SQLite path are unchanged. Bring a dedicated TLS connection pool. Apply `server/wallet/postgres/001-issue-grants.sql`, `002-apple-updates.sql` and `003-apple-wake-retries.sql` in order with a separate migration owner; never give the runtime role schema ownership or DDL. Wire `openPostgresIssueGrants({pool})` and `openUpdates: (options) => openPostgresAppleUpdates({pool, ...options})` into `createWalletService`. The caller owns pool lifecycle. Keep the update HMAC/encryption root private and stable. No merchant grant, stamp state or signing key is accepted from a device.

With Node 22.23.2 and the fixture-only `pg@8.16.3` driver, use a fresh disposable Postgres 15 cluster listening only on a Unix socket. The integration tests deliberately refuse non-fixture paths. Run from a disposable checkout with no real credentials. Initialise with local trust only inside a private directory, host authentication rejected, UTF-8 and owner role `fixture_owner`. Use `mktemp -d /dev/shm/stampies-pg-proof.XXXXXX`, its `socket` subdirectory (mode 0700), and `WALLET_FIXTURE_PG_SOCKET` pointing to that subdirectory. Start the fixture without TCP listeners, run the suite below, then shut down and remove the disposable cluster. The test creates its own runtime roles and a separate test database; never target a shared or hosted database.

```sh
# Install the test-only driver in this disposable checkout, not in the app or release lockfile.
npm install --no-save --package-lock=false --ignore-scripts pg@8.16.3
node --experimental-sqlite --test --test-concurrency=1 tests/wallet-server.test.mjs tests/wallet-service.test.mjs tests/wallet-http.test.mjs tests/wallet-postgres-*.test.mjs
```

The fixture proves single-use issuance, Apple registration/rotation, change cursors, protected refresh and unregister against real Postgres, with synthetic records and signer. Invoking a signer locally is not proof of real device refresh. A signed static test card was installed on an iPhone; it is not the updateable pass. The hosted adapter, actual Google issuer/class, production credentials, configured APNs delivery and a physical update test are still separate. Postgres push is opt-in and is inactive if no sender is configured. No DNS or store release is implied by this branch.


### Postgres Apple push queue

Use `flushAppleWakes` only from a private scheduled job and pass the exact Wallet APNs sender to the service. Postgres leases one pending wake at a time without holding a transaction across the call to Apple. A delivery receipt can clear only its own live lease, revision and encrypted registration. Definitive unregistration can remove only that unchanged registration. The scheduled runner processes at most four by default, backs off transient failures, and stops retrying the same revision after eight failures; a new pass revision or rotated device token resets delivery. An expired lease is recoverable, so Apple may receive a repeat wake, never a repeat stamp. Grant the runtime access to the dedicated schema and exact table/column operations, not ownership or DDL. Keep APNs tokens out of logs. The offline dispatcher tests prove concurrency and retry behaviour only; they do not connect to APNs or a production database.
