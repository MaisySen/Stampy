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
