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
| 1.0.0 | 6 | 2026-11-21 | to be filled after push | none yet | Merge Stampies CI c4e6c37: manual workflow stampies-ci.yml, Apple ID 6837253268 in eas.json, Expo SDK 53 dependency alignment, fraud import fix for Metro bundling. Typecheck exit 0, tests 81 pass 0 fail, scan passed, config check passed, Android and iOS bundles exported. |
