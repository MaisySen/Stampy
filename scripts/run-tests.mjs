/**
 * Run the Stampies unit tests.
 * Compiles the pure logic modules and the tests with tsc, then runs
 * node --test on the compiled output. No network, no device.
 * Exits non-zero if the compile or any test fails.
 */
import { execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

const outDir = ".test-out";
const files = [
  "src/lib/stamps.ts",
  "src/lib/fraud.ts",
  "src/lib/analytics.ts",
  "src/lib/loyalty.ts",
  "src/lib/offlineQueue.ts",
  "src/lib/offlineQueueStore.ts",
  "src/lib/offlineQueueStartup.ts",
  "src/lib/offlineSync.ts",
  "src/lib/stampSender.ts",
  "src/lib/device.ts",
  "src/lib/pass.ts",
  "src/lib/passInstall.ts",
  "src/data.ts",
  "tests/stamps.test.ts",
  "tests/fraud.test.ts",
  "tests/analytics.test.ts",
  "tests/loyalty.test.ts",
  "tests/offlineQueue.test.ts",
  "tests/offlineQueueStore.test.ts",
  "tests/offlineQueueStartup.test.ts",
  "tests/offlineSync.test.ts",
  "tests/stampSender.test.ts",
  "tests/device.test.ts",
  "tests/pass.test.ts",
  "tests/passInstall.test.ts",
  "src/lib/storage.ts",
  "src/lib/program.ts",
  "src/lib/ledger.ts",
  "tests/program.test.ts",
  "tests/ledger.test.ts",
  "tests/queueReadiness.test.ts",
  "tests/node.d.ts",
];

function run(command) {
  execSync(command, { stdio: "inherit" });
}

if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true, force: true });
}

run(
  [
    "npx tsc",
    ...files,
    "--outDir",
    outDir,
    "--module",
    "nodenext",
    "--moduleResolution",
    "nodenext",
    "--target",
    "es2020",
    "--strict",
    "--skipLibCheck",
  ].join(" "),
);

run(`node --test ${outDir}/tests/*.test.js`);

// UI journey: renders the real App with synthetic storage and stubbed
// react-native. Compiled apart because it needs JSX and CommonJS.
const uiOutDir = ".test-out/ui";
if (existsSync(uiOutDir)) {
  rmSync(uiOutDir, { recursive: true, force: true });
}
run(
  [
    "npx tsc App.tsx tests/journey.ui.test.tsx tests/node.d.ts",
    "--outDir",
    uiOutDir,
    "--noCheck",
    "--jsx react-jsx",
    "--module commonjs",
    "--moduleResolution node10",
    "--target es2020",
    "--esModuleInterop",
    "--resolveJsonModule",
    "--skipLibCheck",
  ].join(" "),
);
run(`node --test ${uiOutDir}/tests/journey.ui.test.js`);
