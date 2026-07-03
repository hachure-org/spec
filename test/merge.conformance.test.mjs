/**
 * Executable L3 conformance: the bundled implementation (lib/merge.mjs) must
 * reproduce every merge vector's expected merged claim set, collision set,
 * and post-merge derived statuses — for every permutation of the input
 * bundles (merge.md §6 order-independence MUST).
 * Run with: node --test test/merge.conformance.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, basename } from 'node:path';

import { mergeBundles, mergeBundlesDetailed, deriveStatuses, canonicalize } from '../index.mjs';

const mergeDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'conformance', 'merge');
const vectors = readdirSync(mergeDir)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ name: basename(f, '.json'), vector: JSON.parse(readFileSync(join(mergeDir, f), 'utf8')) }));

assert.ok(vectors.length >= 4, 'expected the full merge vector set');

function permutations(items) {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) =>
    permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest])
  );
}

for (const { name, vector } of vectors) {
  test(`merge vector ${name}: merged claims, collisions, and statuses match for every permutation`, () => {
    let reference;
    for (const inputs of permutations(vector.inputs)) {
      const { bundle, collisions } = mergeBundlesDetailed(inputs);

      const mergedClaimIds = bundle.claims.map((c) => c.id).sort();
      assert.deepEqual(mergedClaimIds, [...vector.expect.mergedClaimIds].sort(), `${name}: claim ids`);

      const collisionKeys = collisions.map((c) => ({ collection: c.collection, id: c.id }));
      assert.deepEqual(
        collisionKeys,
        vector.expect.collisions,
        `${name}: collision set`
      );

      if (vector.expect.statusByClaimId) {
        const derived = deriveStatuses(bundle, new Date(vector.now));
        assert.deepEqual(derived, vector.expect.statusByClaimId, `${name}: post-merge statuses`);
      }

      // §6: identical output across permutations — byte-identical, not just
      // set-identical, because the implementation sorts deterministically.
      const canonical = canonicalize(bundle) + '|' + canonicalize(collisions);
      if (reference === undefined) reference = canonical;
      assert.equal(canonical, reference, `${name}: output must not depend on input order`);
    }
  });
}

test('order-independence vector keeps the JCS-first content (claimType "coverage")', () => {
  const { vector } = vectors.find((v) => v.name === 'merge-collision-order-independence');
  for (const inputs of permutations(vector.inputs)) {
    const { bundle } = mergeBundlesDetailed(inputs);
    const kept = bundle.claims.find((c) => c.id === 'shared.claim.x');
    assert.equal(kept.claimType, 'coverage', 'tie-break must pick content, not position');
  }
});

test('mergeBundles throws on claim collisions; mergeBundlesDetailed reports them', () => {
  const { vector } = vectors.find((v) => v.name === 'merge-collision-order-independence');
  assert.throws(() => mergeBundles(vector.inputs), /claim id collision/);
  const { collisions } = mergeBundlesDetailed(vector.inputs);
  assert.equal(collisions.length, 1);
});

test('merge rejects differing schemaVersion values', () => {
  const { vector } = vectors.find((v) => v.name === 'merge-agree-values');
  const [a, b] = structuredClone(vector.inputs);
  b.schemaVersion = a.schemaVersion + 1;
  assert.throws(() => mergeBundlesDetailed([a, b]), /differing schemaVersion/);
});

test('merged bundle omits producerId and synthesizes source deterministically', () => {
  const { vector } = vectors.find((v) => v.name === 'merge-collision-order-independence');
  for (const inputs of permutations(vector.inputs)) {
    const { bundle } = mergeBundlesDetailed(inputs);
    assert.equal(bundle.producerId, undefined, 'producerId MUST be omitted on merge');
    assert.equal(bundle.source, 'merged:producer-a+producer-b+producer-c');
  }
});

test('re-merging a merged bundle is accepted (merge is re-appliable)', () => {
  const { vector } = vectors.find((v) => v.name === 'merge-agree-values');
  const first = mergeBundlesDetailed(vector.inputs).bundle;
  const again = mergeBundlesDetailed([first, vector.inputs[0]]);
  assert.deepEqual(
    again.bundle.claims.map((c) => c.id).sort(),
    first.claims.map((c) => c.id).sort()
  );
});

test('merged bundle omits the proof block (merge.md §5 rule 3)', () => {
  const { vector } = vectors.find((v) => v.name === 'merge-agree-values');
  const [a, b] = structuredClone(vector.inputs);
  a.proof = {
    anchors: [
      {
        id: 'anchor.rekor.entry',
        kind: 'transparency_log',
        algorithm: 'rekor',
        value: 'example-log-entry-uuid',
        sourceRef: 'https://rekor.sigstore.dev/example',
      },
    ],
  };
  const { bundle } = mergeBundlesDetailed([a, b]);
  assert.equal('proof' in bundle, false, 'a producer signature does not survive merging');
});
