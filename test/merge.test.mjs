/**
 * Shape/schema harness for conformance/merge/*.json (merge.md).
 *
 * IMPORTANT — this repo has no @kontourai/surface dependency, by design (it
 * is the format's canonical home, not a consumer). This test does NOT
 * execute mergeBundles/mergeBundlesDetailed/deriveClaimStatus against these
 * vectors — it only proves each vector is *well-formed*: top-level shape,
 * every `inputs[]` entry independently Ajv-validates against
 * trust-bundle.schema.json, and `expect` has the documented shape. Proving
 * that `expect` is *algorithmically correct* (i.e. that a real
 * mergeBundlesDetailed()/deriveClaimStatus() call actually produces these
 * values) is explicitly out of this repo's scope — see merge.md's "Reference
 * implementation notes" and plan.md's "Stop-short risks". For
 * merge-collision-order-independence.json specifically, the `expect` block
 * was instead hand-derived independently against merge.md §5/§6 and
 * status-function.md's fold (see design.md §11 and this vector's own
 * $comment) and is cross-checked here only for shape, not for outcome
 * correctness. A future kontourai/surface delivery is expected to run these
 * vectors through the real implementation and close that gap (plan.md Wave 3
 * Task H).
 *
 * Run with: node --test test/merge.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, basename } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemasDir = join(__dirname, '..', 'schemas');
const mergeConformanceDir = join(__dirname, '..', 'conformance', 'merge');

const TRUST_STATUS_ENUM = [
  'unknown',
  'proposed',
  'assumed',
  'verified',
  'stale',
  'disputed',
  'superseded',
  'rejected',
  'revoked',
];

// ---------------------------------------------------------------------------
// Loader — mirrors index.mjs's loadTestVectors() pattern, but pointed at the
// new conformance/merge/ subdirectory. index.mjs's own top-level loader only
// globs conformance/*.json (not subdirectories), so it is untouched by this
// new directory (merge.md §11 / plan.md's explicit design constraint).
// ---------------------------------------------------------------------------
function loadMergeVectors() {
  const vectors = [];
  for (const file of readdirSync(mergeConformanceDir).sort()) {
    if (!file.endsWith('.json')) continue;
    const name = basename(file, '.json');
    const vector = JSON.parse(readFileSync(join(mergeConformanceDir, file), 'utf8'));
    vectors.push({ name, file, vector });
  }
  return vectors;
}

const mergeVectors = loadMergeVectors();

// ---------------------------------------------------------------------------
// Ajv setup — reuses the exact registration pattern from
// test/schemas.ajv.test.mjs: sibling schemas registered via addSchema, root
// schema (trust-bundle.schema.json) compiled separately.
// ---------------------------------------------------------------------------
function loadSchemaFiles() {
  const files = {};
  for (const file of readdirSync(schemasDir).sort()) {
    if (!file.endsWith('.schema.json')) continue;
    files[file] = JSON.parse(readFileSync(join(schemasDir, file), 'utf8'));
  }
  return files;
}

function compileTrustBundleValidator() {
  const schemaFiles = loadSchemaFiles();
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  for (const [filename, schema] of Object.entries(schemaFiles)) {
    if (filename === 'trust-bundle.schema.json') continue;
    ajv.addSchema(schema, filename);
  }
  return ajv.compile(schemaFiles['trust-bundle.schema.json']);
}

const validateTrustBundle = compileTrustBundleValidator();

// ---------------------------------------------------------------------------
// AC4 — at least the 4 named vectors are present
// ---------------------------------------------------------------------------
test('conformance/merge/ contains at least the 4 vectors named in merge.md / design.md §11', () => {
  const names = mergeVectors.map((v) => v.name).sort();
  assert.deepEqual(names, [
    'merge-agree-values',
    'merge-collision-order-independence',
    'merge-conflict-status',
    'merge-conflict-value',
  ]);
});

for (const { name, vector } of mergeVectors) {
  // ---------------------------------------------------------------------
  // Top-level shape: { now, inputs[], expect: { mergedClaimIds, collisions, statusByClaimId } }
  // ---------------------------------------------------------------------
  test(`vector "${name}" has required top-level fields (now, inputs, expect)`, () => {
    assert.ok(Object.hasOwn(vector, 'now'), `vector "${name}" missing "now"`);
    assert.ok(Object.hasOwn(vector, 'inputs'), `vector "${name}" missing "inputs"`);
    assert.ok(Object.hasOwn(vector, 'expect'), `vector "${name}" missing "expect"`);
  });

  test(`vector "${name}" now is a valid ISO 8601 date string`, () => {
    const ts = Date.parse(vector.now);
    assert.ok(!Number.isNaN(ts), `vector "${name}" now is not a valid date: ${vector.now}`);
  });

  test(`vector "${name}" inputs is an array of at least 2 TrustBundles`, () => {
    assert.ok(Array.isArray(vector.inputs), `vector "${name}" inputs is not an array`);
    assert.ok(vector.inputs.length >= 2, `vector "${name}" inputs has fewer than 2 bundles`);
  });

  // ---------------------------------------------------------------------
  // Each inputs[] entry independently validates as a TrustBundle (AC4).
  // ---------------------------------------------------------------------
  vector.inputs.forEach((input, i) => {
    test(`vector "${name}" inputs[${i}] validates against trust-bundle.schema.json`, () => {
      const valid = validateTrustBundle(input);
      assert.equal(valid, true, `${name} inputs[${i}]: ${JSON.stringify(validateTrustBundle.errors)}`);
    });
  });

  // ---------------------------------------------------------------------
  // expect.mergedClaimIds — sorted array of strings
  // ---------------------------------------------------------------------
  test(`vector "${name}" expect.mergedClaimIds is a sorted array of strings`, () => {
    const ids = vector.expect?.mergedClaimIds;
    assert.ok(Array.isArray(ids), `vector "${name}" expect.mergedClaimIds is not an array`);
    assert.ok(ids.length > 0, `vector "${name}" expect.mergedClaimIds is empty`);
    for (const id of ids) {
      assert.equal(typeof id, 'string', `vector "${name}" mergedClaimIds contains a non-string: ${id}`);
    }
    const sorted = [...ids].sort();
    assert.deepEqual(ids, sorted, `vector "${name}" expect.mergedClaimIds is not sorted`);
  });

  // ---------------------------------------------------------------------
  // expect.mergedClaimIds is the union of every claim id across inputs[]
  // ---------------------------------------------------------------------
  test(`vector "${name}" expect.mergedClaimIds is the sorted union of every input claim id`, () => {
    const allClaimIds = new Set();
    for (const bundle of vector.inputs) {
      for (const claim of bundle.claims ?? []) {
        allClaimIds.add(claim.id);
      }
    }
    const expected = [...allClaimIds].sort();
    assert.deepEqual(vector.expect.mergedClaimIds, expected);
  });

  // ---------------------------------------------------------------------
  // expect.collisions — array of { collection, id }
  // ---------------------------------------------------------------------
  test(`vector "${name}" expect.collisions is an array of {collection, id} objects`, () => {
    const collisions = vector.expect?.collisions;
    assert.ok(Array.isArray(collisions), `vector "${name}" expect.collisions is not an array`);
    for (const c of collisions) {
      assert.equal(typeof c.collection, 'string', `vector "${name}" collision missing string collection`);
      assert.equal(typeof c.id, 'string', `vector "${name}" collision missing string id`);
      assert.ok(
        ['claims', 'evidence', 'policies', 'events', 'claimGroups', 'authorityTrace'].includes(c.collection),
        `vector "${name}" collision has unexpected collection: ${c.collection}`,
      );
    }
  });

  // ---------------------------------------------------------------------
  // expect.statusByClaimId — every value is a member of the 9-value TrustStatus enum
  // ---------------------------------------------------------------------
  test(`vector "${name}" expect.statusByClaimId values are all valid TrustStatus enum members`, () => {
    const byId = vector.expect?.statusByClaimId;
    assert.ok(
      byId !== null && typeof byId === 'object' && !Array.isArray(byId),
      `vector "${name}" expect.statusByClaimId is not an object`,
    );
    assert.ok(Object.keys(byId).length > 0, `vector "${name}" expect.statusByClaimId is empty`);
    for (const [claimId, status] of Object.entries(byId)) {
      assert.ok(
        TRUST_STATUS_ENUM.includes(status),
        `vector "${name}" statusByClaimId["${claimId}"] = "${status}" is not a valid TrustStatus`,
      );
    }
  });

  // ---------------------------------------------------------------------
  // Every claim id present in expect.mergedClaimIds has a statusByClaimId entry
  // ---------------------------------------------------------------------
  test(`vector "${name}" every mergedClaimIds entry has a statusByClaimId entry`, () => {
    for (const id of vector.expect.mergedClaimIds) {
      assert.ok(
        Object.hasOwn(vector.expect.statusByClaimId, id),
        `vector "${name}" mergedClaimIds contains "${id}" with no matching statusByClaimId entry`,
      );
    }
  });
}

// ---------------------------------------------------------------------------
// AC5 — merge-collision-order-independence.json matches design.md §11's
// worked example exactly (hand-derivation cross-check). This is a literal
// value assertion, not a shape check, precisely because AC5 requires this
// one vector's expect block to be independently verifiable without running
// any code.
// ---------------------------------------------------------------------------
test('merge-collision-order-independence.json expect block matches design.md §11\'s hand-derivation', () => {
  const v = mergeVectors.find((x) => x.name === 'merge-collision-order-independence');
  assert.ok(v, 'merge-collision-order-independence.json not found');
  assert.deepEqual(v.vector.expect.mergedClaimIds, ['shared.claim.x', 'unrelated.claim.y']);
  assert.deepEqual(v.vector.expect.collisions, [{ collection: 'claims', id: 'shared.claim.x' }]);
  assert.deepEqual(v.vector.expect.statusByClaimId, {
    'shared.claim.x': 'unknown',
    'unrelated.claim.y': 'unknown',
  });
});

// ---------------------------------------------------------------------------
// Producer-id positive fixture (AC3 test-plan item 2) — a bundle with
// producerId set validates against the now-updated trust-bundle.schema.json.
// ---------------------------------------------------------------------------
test('a TrustBundle with producerId set validates against trust-bundle.schema.json', () => {
  const bundle = {
    schemaVersion: 5,
    source: 'producer-a:run-1',
    producerId: 'producer-a',
    claims: [],
    evidence: [],
    policies: [],
    events: [],
  };
  const valid = validateTrustBundle(bundle);
  assert.equal(valid, true, JSON.stringify(validateTrustBundle.errors));
});

test('a TrustBundle with an empty-string producerId is rejected (minLength 1)', () => {
  const bundle = {
    schemaVersion: 5,
    source: 'producer-a:run-1',
    producerId: '',
    claims: [],
    evidence: [],
    policies: [],
    events: [],
  };
  const valid = validateTrustBundle(bundle);
  assert.equal(valid, false);
});
