/**
 * Prose/schema version agreement.
 * Run with: node --test test/doc-versions.test.mjs
 *
 * The README (and other shipped docs) advertise concrete schemaVersion and
 * statusFunctionVersion values. Those claims must track the actual sources of
 * truth — the trust-bundle schema enum and package.json — or the published
 * package documents versions it does not ship. A failure here means a version
 * bumped without the prose being swept.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readme = readFileSync(join(root, 'README.md'), 'utf-8');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
const bundleSchema = JSON.parse(
  readFileSync(join(root, 'schemas', 'trust-bundle.schema.json'), 'utf-8')
);

// The current schemaVersion is the highest value the schema accepts; older
// enum entries are compatibility floors (e.g. 5 stays valid under 6 because
// 6 only added optional fields).
const schemaVersion = Math.max(...bundleSchema.properties.schemaVersion.enum);
const sfv = pkg.statusFunctionVersion;

test('trust-bundle schema declares numeric schemaVersion enum values', () => {
  assert.ok(bundleSchema.properties.schemaVersion.enum.length >= 1);
  assert.ok(bundleSchema.properties.schemaVersion.enum.every((v) => typeof v === 'number'));
});

test('README advertises the actual schemaVersion', () => {
  assert.ok(
    readme.includes(`currently\n\`${schemaVersion}\`) `) ||
      readme.includes(`currently \`${schemaVersion}\``),
    `README must state the current schemaVersion \`${schemaVersion}\` — sweep the prose after a version bump`
  );
});

test('README advertises the actual statusFunctionVersion', () => {
  assert.ok(
    readme.includes(`currently \`"${sfv}"\``) || readme.includes(`currently\n\`"${sfv}"\``),
    `README must state the current statusFunctionVersion "${sfv}" — sweep the prose after a version bump`
  );
});

test('README does not advertise stale version values', () => {
  const staleSchemaClaims = [...readme.matchAll(/schemaVersion[^.\n]*currently\s+`(\d+)`/g)]
    .map((m) => Number(m[1]))
    .filter((v) => v !== schemaVersion);
  assert.deepEqual(staleSchemaClaims, [], 'README claims a schemaVersion other than the schema enum');

  const staleSfvClaims = [...readme.matchAll(/statusFunctionVersion[^.\n]*currently\s+`"(\d+)"`/g)]
    .map((m) => m[1])
    .filter((v) => v !== sfv);
  assert.deepEqual(staleSfvClaims, [], 'README claims a statusFunctionVersion other than package.json');
});

test('status-function.md conformance-claim version matches package.json', () => {
  const doc = readFileSync(join(root, 'status-function.md'), 'utf-8');
  assert.ok(
    doc.includes(`claiming version \`"${sfv}"\``),
    `status-function.md must tie conformance claims to the current version "${sfv}"`
  );
});
