/**
 * Scan the repo for dashes and secrets before a push.
 * Fails if any checked file has an em dash or en dash, a private key
 * marker, or a known token prefix. Skips node_modules, .git, assets,
 * and the test output dir.
 *
 * Run: npm run scan
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SKIP_DIRS = new Set([
  ".git",
  ".expo",
  ".test-out",
  "assets",
  "node_modules",
]);

const PATTERNS = [
  { name: "em dash", test: (text) => text.includes("\u2014") },
  { name: "en dash", test: (text) => text.includes("\u2013") },
  { name: "private key marker", test: (text) => text.includes("BEGIN " + "PRIVATE KEY") },
  { name: "private key block", test: (text) => text.includes("-----" + "BEGIN") },
  { name: "GitHub token prefix", test: (text) => /gh[pousr]_/.test(text) },
  { name: "secret key prefix", test: (text) => /sk-(live|test)-/.test(text) },
  { name: "AWS key id", test: (text) => /AKIA[0-9A-Z]{16}/.test(text) },
];

const problems = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (!SKIP_DIRS.has(name)) {
        walk(path);
      }
      continue;
    }
    if (name.endsWith(".p8") || name.endsWith(".pem") || name.endsWith(".key")) {
      problems.push(`${path}: key file must not be committed`);
      continue;
    }
    if (/\.(ts|tsx|js|mjs|json|md|yml|yaml|txt|example)$/.test(name)) {
      const text = readFileSync(path, "utf8");
      for (const pattern of PATTERNS) {
        if (pattern.test(text)) {
          problems.push(`${path}: found ${pattern.name}`);
        }
      }
    }
  }
}

walk(".");

if (problems.length > 0) {
  console.error("Scan failed:");
  for (const problem of problems) {
    console.error(`  ${problem}`);
  }
  process.exit(1);
}

console.log("Scan passed: no dashes and no secrets found.");
