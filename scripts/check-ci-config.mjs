import assert from 'node:assert/strict';
import {readFileSync, statSync} from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(import.meta.url);
const project = new URL('../', import.meta.url);
const json = (p) => JSON.parse(readFileSync(new URL(p, project), 'utf8'));
const {expo: app} = json('app.json');
assert.equal(app.name, 'Stampies');
assert.equal(app.slug, 'stampies');
assert.equal(app.scheme, 'stampies');
assert.equal(app.ios.bundleIdentifier, 'au.fintex.stampies');
assert.equal(app.android.package, 'au.fintex.stampies');
const eas = json('eas.json');
assert(Object.keys(eas).every((key) => ['cli', 'build', 'submit'].includes(key)));
assert.equal(eas.submit.production.ios.ascAppId, '6837253268');
const bundled = require('expo/bundledNativeModules.json');
for (const dep of ['react', 'react-native']) {
  assert.equal(require(`${dep}/package.json`).version, bundled[dep], `${dep} must match the installed Expo SDK`);
}
for (const [dep, declared] of Object.entries({ 'expo-asset': '11.1.7', 'expo-font': '13.3.2' })) {
  assert.equal(bundled[dep], `~${declared}`);
  assert.equal(json(`node_modules/${dep}/package.json`).version, declared);
}
for (const path of new Set([app.icon, app.splash.image, app.android.adaptiveIcon.foregroundImage, app.web.favicon])) {
  assert(statSync(new URL(path, project)).size > 0, `Missing app art: ${path}`);
}
console.log('Stampies app identities, Apple submission ID, Expo SDK pins and assets checked.');
