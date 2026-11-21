# Stampies review pipeline

Pushes to `review/stampies-build16-20261122` trigger **Stampies review checks** through the Expo GitHub integration. `.eas/workflows/stampies-review-checks.yml` runs the TypeScript, app, scan, and Wallet checks, then exports the iOS and Android bundles. Check the Expo Workflows run against the exact commit before relying on it.

This is CI only. It does not create a native build, submit to Apple, distribute to testers, or publish updates. A production release is not part of this review branch.

To enable a TestFlight release path, first verify the app-specific signing setup and the authorized uploader for `au.fintex.stampies`. Verify the signed SDK and build number before upload. The TestFlight OTA route is separate from production and may be used only when its runtime matches an eligible TestFlight binary. No tokens or signing material go in this repository.
