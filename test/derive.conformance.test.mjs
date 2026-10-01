/**
 * Executable conformance: the bundled implementation (lib/derive.mjs) must
 * derive the expected status for every claim in every status-derivation
 * conformance vector. This is the L2 bar from conformance/manifest.json,
 * satisfied in-repo — the spec passes its own vectors with its own code.
 * Run with: node --test test/derive.conformance.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  testVectors,
  deriveStatuses,
  deriveClaimStatus,
  supportedStatusFunctionVersions,
} from '../index.mjs';

assert.ok(testVectors.length >= 19, 'expected the full status-derivation vector set');

// A vector without statusFunctionVersions holds for every version.
const versionsOf = (vector) => vector.statusFunctionVersions ?? supportedStatusFunctionVersions;

for (const { name, vector } of testVectors) {
  for (const version of versionsOf(vector)) {
    test(`vector ${name}: bundled deriver matches expected statuses (v${version})`, () => {
      const derived = deriveStatuses(vector.input, new Date(vector.now), {
        statusFunctionVersion: version,
      });
      for (const [claimId, expected] of Object.entries(vector.expect.statusByClaimId)) {
        assert.equal(
          derived[claimId],
          expected,
          `${name} / ${claimId}: expected ${expected}, derived ${derived[claimId]}`
        );
      }
    });
  }
}

// Every version-restricted vector must exercise a behavior that actually
// changed: deriving it under a version it does not list must disagree with its
// expectation for at least one claim. A vector that passes under v2 too would
// not prove the v3 rule it is named for.
for (const { name, vector } of testVectors) {
  if (!vector.statusFunctionVersions) continue;
  for (const version of supportedStatusFunctionVersions) {
    if (vector.statusFunctionVersions.includes(version)) continue;
    test(`vector ${name}: expectations do not hold under v${version}`, () => {
      const derived = deriveStatuses(vector.input, new Date(vector.now), {
        statusFunctionVersion: version,
      });
      const differing = Object.entries(vector.expect.statusByClaimId).filter(
        ([claimId, expected]) => derived[claimId] !== expected
      );
      assert.ok(differing.length > 0, `${name} derives identically under v${version}`);
    });
  }
}

test('every sf-v3-* vector is restricted to version 3', () => {
  const v3 = testVectors.filter(({ name }) => name.startsWith('sf-v3-'));
  assert.equal(v3.length, 8);
  for (const { name, vector } of v3) assert.deepEqual(vector.statusFunctionVersions, ['3'], name);
});

// Basis fields (schemaVersion 9 evidence fields and the basis-annotations
// profile keys) describe how a status was established. They are not inputs:
// deriving a bundle with them, with them stripped, and with every inconclusive
// item removed must agree, under every supported version.
const BASIS_VECTORS = ['sf-inconclusive-evidence', 'sf-basis-fields-inert'];
const BASIS_METADATA_KEYS = ['sourceOfRecord', 'estimate', 'collectorModel'];

function stripBasisFields(record) {
  const { inconclusive, collectedByKind, ...rest } = record;
  if (rest.metadata) {
    rest.metadata = Object.fromEntries(
      Object.entries(rest.metadata).filter(([key]) => !BASIS_METADATA_KEYS.includes(key))
    );
  }
  return rest;
}

for (const name of BASIS_VECTORS) {
  for (const version of supportedStatusFunctionVersions) {
    test(`vector ${name}: basis fields do not change derivation (v${version})`, () => {
      const { vector } = testVectors.find((v) => v.name === name);
      const input = vector.input;
      const now = new Date(vector.now);
      const options = { statusFunctionVersion: version };
      const withFields = deriveStatuses(input, now, options);
      assert.deepEqual(withFields, vector.expect.statusByClaimId);

      const inconclusive = input.evidence.filter((e) => e.inconclusive);
      assert.ok(inconclusive.length > 0, `${name} carries no inconclusive evidence`);

      const stripped = {
        ...input,
        claims: input.claims.map(stripBasisFields),
        evidence: input.evidence.map(stripBasisFields),
      };
      assert.notDeepEqual(stripped, input, `${name} carries no basis fields to strip`);
      assert.deepEqual(deriveStatuses(stripped, now, options), withFields);

      const attemptsRemoved = { ...input, evidence: input.evidence.filter((e) => !e.inconclusive) };
      assert.deepEqual(deriveStatuses(attemptsRemoved, now, options), withFields);
    });
  }
}

test('sf-basis-fields-inert carries all four basis fields', () => {
  const { vector } = testVectors.find((v) => v.name === 'sf-basis-fields-inert');
  const { claims, evidence } = vector.input;
  assert.ok(evidence.some((e) => e.inconclusive));
  assert.deepEqual([...new Set(evidence.map((e) => e.collectedByKind))].sort(), ['deterministic', 'human', 'model']);
  assert.ok(evidence.some((e) => e.metadata?.sourceOfRecord));
  assert.ok(claims.some((c) => c.metadata?.estimate));
});

// The schema, not the fold, keeps an attempt out of derivation. This pins what
// that buys: the same item marked entailing would satisfy the requirement.
test('an inconclusive item would count toward requiredEvidence if it were entailing', () => {
  const { vector } = testVectors.find((v) => v.name === 'sf-inconclusive-evidence');
  const entailing = {
    ...vector.input,
    evidence: vector.input.evidence.map((e) => (e.inconclusive ? { ...e, supportStrength: 'entails' } : e)),
  };
  const derived = deriveStatuses(entailing, new Date(vector.now));
  assert.equal(vector.expect.statusByClaimId['claim.inconclusive.only-attempt'], 'unknown');
  assert.equal(derived['claim.inconclusive.only-attempt'], 'proposed');
  assert.equal(vector.expect.statusByClaimId['claim.inconclusive.requirement-unmet'], 'proposed');
  assert.equal(derived['claim.inconclusive.requirement-unmet'], 'verified');
  assert.equal(vector.expect.statusByClaimId['claim.inconclusive.no-policy'], 'unknown');
  assert.equal(derived['claim.inconclusive.no-policy'], 'proposed');
  assert.equal(vector.expect.statusByClaimId['claim.inconclusive.corroboration'], 'proposed');
  assert.equal(derived['claim.inconclusive.corroboration'], 'verified');
  assert.equal(vector.expect.statusByClaimId['claim.inconclusive.commit-anchor'], 'stale');
  assert.equal(derived['claim.inconclusive.commit-anchor'], 'verified');
});

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
