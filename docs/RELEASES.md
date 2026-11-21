# Releases

Record each build here: number, time, commit, CI run, what changed.

Rules from the runbook:

- iOS: bump CURRENT_PROJECT_VERSION for every upload. App Store Connect rejects a reused number.
- Android: bump versionCode for every build.
- Nothing ships until the full suite is green: type check, unit tests, UI tests, backend tests.
- Read per test counts, not the job colour. Success can hide failed test steps. Write the counts into the release notes.
- Walk the real user journey before shipping UI changes, with screenshots of every screen, light and dark.

## Builds

| Version | Build | Date | Commit | CI run | What changed |
| --- | --- | --- | --- | --- | --- |
| 1.0.0 | 1 | 2026-11-20 | initial commit | none yet | First code in the repo. Docs, config, and the Expo app scaffold. No store build yet. |
| 1.0.0 | 2 | 2026-11-20 | bcb67cb | none yet | Tests and logic modules: stamps, fraud, analytics, loyalty, test runner, scan script. Typecheck exit 0, tests 33 pass 0 fail, scan passed. |
| 1.0.0 | 3 | 2026-11-20 | 3291cfa | none yet | Fraud UI, birthday and win-back UI, legal pages in docs and in app, polish pass. Typecheck exit 0, tests 33 pass 0 fail, scan passed. CI workflow file did not land. GitHub returned 403. |
| 1.0.0 | 4 | 2026-11-20 | f2951ad, ad6b537, 189b517, 47029f9 | none yet | Rename Stampy to Stampies, bundle ID au.fintex.stampies, SKU stampies-ios-1, share link stampies.app. Typecheck exit 0, tests 33 pass 0 fail, scan passed. |
| 1.0.0 | 5 | 2026-11-20 | e3bacd4 | none yet | Wallet pass payload builder and install flow, offline stamp queue, fraud device check, 81 tests pass 0 fail, typecheck exit 0, scan passed. |
| 1.0.0 | 6 | 2026-11-21 | 92c0dd5 | none yet | Merge Stampies CI c4e6c37: manual workflow stampies-ci.yml, Apple ID 6837253268 in eas.json, Expo SDK 53 dependency alignment, fraud import fix for Metro bundling. Typecheck exit 0, tests 81 pass 0 fail, scan passed, config check passed, Android and iOS bundles exported. |
| 1.0.0 | 7 | 2026-11-21 | 89eb1d1 | none yet | Merge Wallet signing a5e8499: server Apple and Google Wallet signing, gated NFC tap boundary, wallet server tests, CI runs the wallet server tests. Typecheck exit 0, tests 81 pass 0 fail, wallet server tests 4 pass 0 fail, scan passed, config check passed, Android and iOS bundles exported at 5.9M each. Wallet passes are not live yet: Pass Type ID pass.au.fintex.stampies is registered and verified, 2026-11-21. Still no signing certificate, no Google issuer class, no live backend, no pass updates, no real terminal test. |
| 1.0.0 | 8 | 2026-11-21 | 5880257 | none yet | Merge Apple Wallet APNs updates 0e503ad: Apple update service with SQLite store and /v1 protocol, APNs push sender, signer wiring for webServiceURL and authenticationToken, wallet server tests now 7. Typecheck exit 0, tests 81 pass 0 fail, wallet server tests 7 pass 0 fail, scan passed, config check passed, Android and iOS bundles exported at 5.9M each. Wallet passes are not live yet: deployment still requires the real Pass Type certificate, stable key custody, authorised origin, persistent storage, a connected merchant ledger, a configured APNs sender, and a physical install and update test. |
| 1.0.0 | 9 | 2026-11-21 | 367cd53 | none yet | D2 decided: buy count and reward are adjustable per business in the pass builder, with a suggested reward that follows the stamp target. Default suggestion stays buy 8, get the 9th free. Typecheck exit 0, tests 82 pass 0 fail, wallet server tests 7 pass 0 fail, scan passed, config check passed, Android bundle exported at 6.0M, iOS bundle at 5.9M. |
| 1.0.0 | 10 | 2026-11-21 | 028e705 | none yet | Add to Wallet screen wired into App.tsx, PLAN.md refreshed to 21 commits, Apple standard Wallet certificate noted as already issued. Typecheck exit 0, tests 83 pass 0 fail, wallet server tests 7 pass 0 fail, scan passed, config check passed, Android bundle exported at 6.0M, iOS bundle at 6.0M. |
| 1.0.0 | 11 | 2026-11-21 | b62770f | none yet | Merge Wallet Postgres and Apple wakes f387329: Postgres Wallet service, registration and refresh, durable Apple Wallet wake queue with leases, backoff and an 8 failure cap, Netlify migrations packaged. Wallet tests 16 pass 0 fail in a scratch copy against disposable Postgres. Wallet passes are not live yet: no hosted backend, no mounted certificate, no live APNs delivery, no physical install and update test. |
| 1.0.0 | 12 | 2026-11-21 | to be filled after push | none yet | Merge Wallet runtime role 00d67aa: verify the restricted Stampies Wallet database role, exact column grants on the five Wallet tables, NOLOGIN, no DDL. Wallet tests 26 pass 0 fail in a scratch copy against disposable Postgres. |
