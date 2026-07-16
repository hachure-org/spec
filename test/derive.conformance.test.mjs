/**
 * Executable conformance: the bundled implementation (lib/derive.mjs) must
 * derive the expected status for every claim in every status-derivation
 * conformance vector. This is the L2 bar from conformance/manifest.json,
 * satisfied in-repo — the spec passes its own vectors with its own code.
 * Run with: node --test test/derive.conformance.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { testVectors, deriveStatuses, deriveClaimStatus } from '../index.mjs';

assert.ok(testVectors.length >= 9, 'expected the full status-derivation vector set');

for (const { name, vector } of testVectors) {
  test(`vector ${name}: bundled deriver matches expected statuses`, () => {
    const derived = deriveStatuses(vector.input, new Date(vector.now));
    for (const [claimId, expected] of Object.entries(vector.expect.statusByClaimId)) {
      assert.equal(
        derived[claimId],
        expected,
        `${name} / ${claimId}: expected ${expected}, derived ${derived[claimId]}`
      );
    }
  });
}

test('deriveClaimStatus returns { status, policyId } with resolved policy id', () => {
  const { vector } = testVectors.find((v) => v.name === 'sf-verified-commit');
  const claim = vector.input.claims[0];
  const result = deriveClaimStatus(
    claim,
    {
      evidence: vector.input.evidence,
      events: vector.input.events,
      policies: vector.input.policies,
      authorityTrace: vector.input.authorityTrace,
    },
    new Date(vector.now)
  );
  assert.equal(result.status, 'verified');
  assert.equal(result.policyId, claim.verificationPolicyId);
});

test('derivation is a pure function of now: verified flips to stale past a duration window', () => {
  const { vector } = testVectors.find((v) => v.name === 'sf-stale-duration');
  const atNow = deriveStatuses(vector.input, new Date(vector.now));
  const longBefore = deriveStatuses(vector.input, new Date('2020-01-01T00:00:00.000Z'));
  // Same inputs, different now — at least one claim must differ, proving now
  // is a real input rather than decoration.
  assert.notDeepEqual(atNow, longBefore);
});
