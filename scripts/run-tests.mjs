/**
 * Run the Stampy unit tests.
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
  "src/data.ts",
  "tests/stamps.test.ts",
  "tests/fraud.test.ts",
  "tests/analytics.test.ts",
  "tests/loyalty.test.ts",
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
