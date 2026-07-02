/**
 * Smoke test for the hachure package public API.
 * Run with: node --test test/index.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { statusFunctionVersion, schemas, testVectors } from '../index.mjs';

// ---------------------------------------------------------------------------
// statusFunctionVersion
// ---------------------------------------------------------------------------
test('statusFunctionVersion is a non-empty string', () => {
  assert.equal(typeof statusFunctionVersion, 'string');
  assert.ok(statusFunctionVersion.length > 0);
});

test('statusFunctionVersion is "2"', () => {
  assert.equal(statusFunctionVersion, '2');
});

// ---------------------------------------------------------------------------
// schemas
// ---------------------------------------------------------------------------
test('schemas is a Map', () => {
  assert.ok(schemas instanceof Map);
});

test('schemas contains at least 7 entries', () => {
  assert.ok(schemas.size >= 7, `expected >= 7 schemas, got ${schemas.size}`);
});

const expectedSchemas = [
  'claim',
  'derivation-rule',
  'evidence',
  'inquiry-record',
  'trust-bundle',
  'verification-event',
  'verification-policy',
];

for (const name of expectedSchemas) {
  test(`schema "${name}" is present and is a non-null object`, () => {
    assert.ok(schemas.has(name), `missing schema: ${name}`);
    const schema = schemas.get(name);
    assert.ok(schema !== null && typeof schema === 'object');
  });

  test(`schema "${name}" parses as valid JSON (has $schema or type or properties)`, () => {
    const schema = schemas.get(name);
    const hasSchemaKeyword =
      schema.$schema != null ||
      schema.type != null ||
      schema.properties != null ||
      schema.$id != null;
    assert.ok(hasSchemaKeyword, `schema "${name}" looks empty or malformed`);
  });
}

// ---------------------------------------------------------------------------
// testVectors
// ---------------------------------------------------------------------------
test('testVectors is an Array', () => {
  assert.ok(Array.isArray(testVectors));
});

test('testVectors contains at least 5 entries', () => {
  assert.ok(testVectors.length >= 5, `expected >= 5 vectors, got ${testVectors.length}`);
});

for (const { name, vector } of testVectors) {
  test(`vector "${name}" has required top-level fields`, () => {
    assert.ok(
      Object.hasOwn(vector, 'input'),
      `vector "${name}" missing "input"`,
    );
    assert.ok(
      Object.hasOwn(vector, 'expect'),
      `vector "${name}" missing "expect"`,
    );
    assert.ok(
      Object.hasOwn(vector, 'now'),
      `vector "${name}" missing "now"`,
    );
  });

  test(`vector "${name}" now is a valid ISO 8601 date string`, () => {
    const ts = Date.parse(vector.now);
    assert.ok(!Number.isNaN(ts), `vector "${name}" now is not a valid date: ${vector.now}`);
  });

  test(`vector "${name}" expect.statusByClaimId is a non-empty object`, () => {
    const byId = vector.expect?.statusByClaimId;
    assert.ok(
      byId !== null && typeof byId === 'object' && !Array.isArray(byId),
      `vector "${name}" expect.statusByClaimId is not an object`,
    );
    assert.ok(
      Object.keys(byId).length > 0,
      `vector "${name}" expect.statusByClaimId is empty`,
    );
  });

  test(`vector "${name}" input has claims array`, () => {
    assert.ok(
      Array.isArray(vector.input?.claims),
      `vector "${name}" input.claims is not an array`,
    );
    assert.ok(
      vector.input.claims.length > 0,
      `vector "${name}" input.claims is empty`,
    );
  });
}

// ---------------------------------------------------------------------------
// conformanceManifest
// ---------------------------------------------------------------------------
import { existsSync, readdirSync as _readdirSync } from 'node:fs';
import { dirname as _dirname, join as _join } from 'node:path';
import { fileURLToPath as _fileURLToPath } from 'node:url';
import { conformanceManifest } from '../index.mjs';

const __repoRoot = _dirname(_dirname(_fileURLToPath(import.meta.url)));

test('conformanceManifest is a non-empty object with a levels array', () => {
  assert.ok(conformanceManifest && typeof conformanceManifest === 'object');
  assert.ok(Array.isArray(conformanceManifest.levels));
  assert.ok(conformanceManifest.levels.length >= 3, 'expected at least 3 conformance levels (L1/L2/L3)');
});

test('conformanceManifest.appliesTo declares schemaVersion and statusFunctionVersion', () => {
  assert.ok(Array.isArray(conformanceManifest.appliesTo?.schemaVersion));
  assert.ok(conformanceManifest.appliesTo.schemaVersion.length > 0);
  assert.equal(typeof conformanceManifest.appliesTo?.statusFunctionVersion, 'string');
  assert.equal(conformanceManifest.appliesTo.statusFunctionVersion, statusFunctionVersion);
});

for (const level of conformanceManifest.levels ?? []) {
  test(`conformanceManifest level "${level.level}" satisfiedBy files exist on disk`, () => {
    const satisfiedBy = level.satisfiedBy;
    assert.ok(satisfiedBy && typeof satisfiedBy === 'object', `level "${level.level}" missing satisfiedBy`);

    if (satisfiedBy.kind === 'schema-validation') {
      const dir = _join(__repoRoot, satisfiedBy.schemaDir);
      assert.ok(existsSync(dir), `schemaDir does not exist: ${dir}`);
      for (const file of satisfiedBy.schemaFiles ?? []) {
        const filePath = _join(dir, file);
        assert.ok(existsSync(filePath), `schema file does not exist: ${filePath}`);
      }
    }

    if (satisfiedBy.kind === 'test-vectors') {
      const dir = _join(__repoRoot, satisfiedBy.vectorDir);
      assert.ok(existsSync(dir), `vectorDir does not exist: ${dir}`);
      const prefix = satisfiedBy.vectorFilePattern.replace(/\*.*$/, '');
      const matching = _readdirSync(dir).filter((f) => f.startsWith(prefix) && f.endsWith('.json'));
      assert.equal(
        matching.length,
        satisfiedBy.vectorCount,
        `expected ${satisfiedBy.vectorCount} files matching "${satisfiedBy.vectorFilePattern}" in ${dir}, found ${matching.length}`,
      );
    }
  });
}
