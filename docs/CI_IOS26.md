# iOS 26 rebuild, pipeline, TestFlight and OTA

Build 16 notes. Short plain sentences. No build ran here, so the
iOS 26 SDK is configured, not proven. The first preview build proves it.

## Xcode image

The preview and production iOS profiles in eas.json now pin this image:

```
"ios": { "image": "macos-sequoia-15.6-xcode-26.0" }
```

Source: EAS build infrastructure docs at
docs.expo.dev/build-reference/infrastructure, updated 2026-11-09,
read 2026-11-21. That page lists macos-sequoia-15.6-xcode-26.0 with
aliases sdk-54 and macos-sequoia-15.5-xcode-26.0, Xcode 26.0
(17A324), macOS Sequoia 15.6, Node.js 20.19.4.

Why this image: the SDK 53 default image is
macos-sequoia-15.5-xcode-16.4, Xcode 16.4 with the iOS 18.x SDK.
That is why Build 14 used the iOS 18.5 SDK. Apple requires the iOS 26
SDK or newer for App Store submissions, which means Xcode 26 or later.
The full image name pins a consistent environment. The sdk-54 alias
moves with releases, so the full name is used instead.

What is unchanged: EAS project ID
6b763cc2-7374-441c-bb17-04c5c4b7710c, separate preview and production
channels, ascAppId 6837253268, eas-cli pinned 27.11.0.

Status: configured, not proven. No EAS build ran here. There is no
Expo token on this machine. The first preview build must be checked
for the SDK version in its build log before the production build runs.

## Pipeline verdict

The CI workflow is .github/workflows/stampies-ci.yml. It runs only on
manual dispatch (workflow_dispatch). It runs: npm run typecheck,
npm test, wallet server tests and wallet push worker tests with the
--experimental-sqlite flag, make-assets.py, check-ci-config.mjs, and
expo export for Android and iOS.

It does not run npm run scan. It does not run the wallet service,
wallet HTTP, wallet stamp intake, or wallet Google updater tests.
Those four files cover the pass refresh path that build 16 changed.
A regression there would ship without CI noticing.

The Postgres wallet suite stays out of CI on purpose. It needs a
disposable Postgres cluster with a fixture_owner role that has
CREATEDB, CREATEROLE, and CREATE on database postgres. The tests
create their own databases and never drop them, so a shared runner
cannot reuse a cluster. Run it locally on a fresh cluster per run.

The Xcode image pin does not break the config check.
scripts/check-ci-config.mjs validates the eas.json top level keys
only (cli, build, submit) and ascAppId 6837253268.

## Workflow change for Bidur

The workflow file cannot be edited from this machine. GitHub returns
403 for .github/workflows paths. Apply this diff on github.com.

File: .github/workflows/stampies-ci.yml, in the "Test and bundle for
iOS and Android" step.

Replace:

```
          npm run typecheck
          npm test
          node --experimental-sqlite --test tests/wallet-server.test.mjs
          node --experimental-sqlite --test tests/wallet-push-worker.test.mjs
```

With:

```
          npm run typecheck
          npm test
          npm run scan
          node --experimental-sqlite --test tests/wallet-server.test.mjs
          node --experimental-sqlite --test tests/wallet-service.test.mjs
          node --experimental-sqlite --test tests/wallet-http.test.mjs
          node --experimental-sqlite --test tests/wallet-stamp-intake.test.mjs
          node --experimental-sqlite --test tests/wallet-google-updates.test.mjs
          node --experimental-sqlite --test tests/wallet-push-worker.test.mjs
```

Reason: scan catches forbidden content, and the four added test
files cover the refresh path. All six wallet test files need the
--experimental-sqlite flag. The Postgres suite stays local.

## Tab commands

The Tab runs these. Do not run them from this machine.

### Preview build

```
EXPO_TOKEN=<Expo access token> eas build --platform ios --profile preview
```

Needs: the Expo access token. Bidur created it at
expo.dev/settings/access-tokens and saved it through the Tab add
login link. The Tab holds it. No token lives on this machine.

After the build, check the build log for the SDK version. It must
show the iOS 26 SDK or newer. Record the build id in
docs/RELEASES.md and CHANGELOG.md.

### TestFlight submission

First bump app.json ios.buildNumber. It is "1" now. The runbook
requires a bump for every iOS upload.

Build production:

```
EXPO_TOKEN=<Expo access token> eas build --platform ios --profile production
```

Submit:

```
EXPO_TOKEN=<Expo access token> eas submit --platform ios --profile production
```

Needs: the Expo access token (Tab holds it) and the App Store
Connect Admin API key (the main Tab holds it). The submit profile in
eas.json already has ascAppId 6837253268. The build appears in
TestFlight after processing, usually 10 to 15 minutes.

### First OTA update

```
EXPO_TOKEN=<Expo access token> eas update --branch preview --message "<message>"
```

Needs: the Expo access token (Tab holds it). Channel preview,
project 6b763cc2-7374-441c-bb17-04c5c4b7710c, runtimeVersion
fingerprint policy. An OTA update only applies to builds with the
same runtime fingerprint. A native change needs a new build, not an
update. Record the update group id in docs/RELEASES.md and
CHANGELOG.md.

## Wallet refresh status

Build 16 closes the refresh path in code. Apple: a recorded stamp
queues an APNs wake through the durable wake queue, and the device
pulls the new pass. Google: a recorded stamp PUTs the rebuilt
loyalty object to the Google Wallet API, and every device that saved
the pass refreshes from Google. The server also accepts the real app
pass ids now, stampies-corner-cafe and the same shape.

Still open: the live backend deploy, the certificate and key mounted
on the server, server owned icon artwork, the runtime role LOGIN
granted at deploy, and the physical install and update test on a
real device. Google Wallet also needs a live issuer class and a
service account key before the Google updater can run against
Google. Google work stays held except for this code, which is ready
to use once the issuer exists.
