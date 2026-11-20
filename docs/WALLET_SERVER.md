# Wallet issuance and terminal integration

This module signs Apple and Google loyalty cards on a Node 22 server, not in the app. It does not register issuer accounts, publish an Android or iOS app or enable contactless hardware. The Wallet install screen remains a preview until a live backend is configured.

## Ownership and credentials

- Apple: the issuing developer team needs to register `pass.au.fintex.stampies` as a Pass Type ID. Mount the matching signing PEM and key, the matching Apple WWDR intermediate, and its official trust root. App Store Connect keys cannot sign Wallet passes. Use a read-only private mount and restart after certificate rotation. Supply server-owned icon artwork for `icon.png` and `icon@2x.png` separately from the app icon. `openssl` is required on the host.
- Google: a Google Wallet issuer must have a configured loyalty class and approve the Wallet service account. Supply its numeric issuer ID, fully qualified class ID, service account email, privately mounted RSA key and exact HTTPS origin. The Google Play upload service account does not belong here.
- Do not add issuer credentials, signed URLs, bearer tokens or generated passes to this repository, GitHub logs or client builds. Run the service with request-rate limits. Do not log request headers, replies or pass IDs.

## Serving a card

Wire `createWalletIssueHandler` into the existing trusted HTTP service. It handles POST `/wallet/apple` and POST `/wallet/google`. The host issues a short-lived random capability scoped to one pass and one platform, and stores its SHA-256 digest. The handler calls a trusted lookup with that digest and the route. The lookup must check expiry, ownership and purpose, and read the current authoritative pass record (opaque pass ID, program, stamp count, redemption state and IANA time zone). A barcode, URL path ID or stamp-count field from a caller is not authority to sign or change a pass. Retry and capability invalidation belong to that store.

The Apple response is a detached CMS signed `.pkpass`; the Google response contains a Save to Google Wallet link signed for the configured class. This only issues the current card. Production pass update registration, APNs delivery and Wallet API sync are separate work. Keep QR and staff stamping available independently.

## Contactless

Wallet NFC is off by default. Do not deploy a forwarding endpoint which trusts raw NFC data, a QR code or a caller-supplied count. `createWalletTapBoundary` accepts only deployment-approved Apple VAS or Google Smart Tap adapters. The adapter verifies provider signatures and reader, merchant and audience bindings. The redemption store must atomically verify the active merchant and pass, enforce the current cooldown and quota, and persist the event ID with the result. An allowed fixture event is not a hardware test.

Before enabling NFC: verify Apple’s NFC permission and appropriate Pass Type certificate, or the Google Smart Tap issuer configuration; confirm a compatible terminal, then test real taps and replays with authorised test cards. The pre-existing QR/staff route stays available in the absence of a verified reader.

## Verification

`node --test tests/wallet-server.test.mjs` uses temporary fixture keys. It checks the Apple ZIP and detached signature independently, verifies the Google JWT, and proves that unsigned, expired and repeated reader events do not lead to a second redemption in the test store. It does not prove production certificates, approved issuers, live endpoints, terminals or store builds.
