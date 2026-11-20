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

Deployment still requires the real Pass Type certificate, stable key custody, authorised origin and persistent storage, a connected merchant ledger, configured APNs sender, and a physical install and update test.

## Contactless

Wallet NFC is off by default. Do not deploy a forwarding endpoint which trusts raw NFC data, a QR code or a caller-supplied count. `createWalletTapBoundary` accepts only deployment-approved Apple VAS or Google Smart Tap adapters. The adapter verifies provider signatures and reader, merchant and audience bindings. The redemption store must atomically verify the active merchant and pass, enforce the current cooldown and quota, and persist the event ID with the result. An allowed fixture event is not a hardware test.

Before enabling NFC: verify Apple’s NFC permission and appropriate Pass Type certificate, or the Google Smart Tap issuer configuration; confirm a compatible terminal, then test real taps and replays with authorised test cards. The pre-existing QR/staff route stays available in the absence of a verified reader.

## Verification

`node --test tests/wallet-server.test.mjs` uses temporary fixture keys. It checks the Apple ZIP and detached signature independently, verifies the Google JWT, and proves that unsigned, expired and repeated reader events do not lead to a second redemption in the test store. It does not prove production certificates, approved issuers, live endpoints, terminals or store builds.
