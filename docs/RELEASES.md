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
