/**
 * Worked-example fixtures for profile documents: each profile's example
 * bundle must be schema-valid and must
 * derive the statuses its prose promises. Run: node --test test/profiles.fixtures.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

import {
  schemas,
  deriveStatuses,
  validateBasisAnnotations,
  resolveSourceOfRecord,
  mergeBundlesDetailed,
} from '../index.mjs';

const ajv = new Ajv2020({ strict: false, allErrors: true, logger: false });
for (const schema of schemas.values()) ajv.addSchema(schema);
const validateBundle = ajv.getSchema(schemas.get('trust-bundle').$id);

const NOW = new Date('2026-07-04T00:00:00.000Z');

// --- Contract-claims profile worked example (contract-claims.md) -----------

const contractBundle = JSON.parse(
  readFileSync(new URL('../examples/contract-claim-env-passthrough.json', import.meta.url), 'utf8'),
);

test('Contract-claims worked example is schema-valid and uses the profile vocabulary', () => {
  assert.equal(validateBundle(contractBundle), true, JSON.stringify(validateBundle.errors));
  assert.deepEqual(contractBundle.claims[0].qualifiers, {
    provider: 'compose.env',
    consumer: 'app.oauth',
    contract: 'GOOGLE_CLIENT_ID reaches process env',
  });
  const receipt = contractBundle.evidence.find((item) => item.evidenceType === 'runtime_observation');
  assert.equal(receipt.method, 'observation');
  assert.equal(receipt.execution.environment, 'production');
  assert.equal(receipt.execution.exitCode, 0);
});

test('Contract-claims live env-passthrough receipt derives verified', () => {
  const derived = deriveStatuses(contractBundle, NOW);
  assert.equal(derived['claim.contract.compose-env-to-app-oauth'], 'verified');
});

// --- AI-evaluation profile worked example (ai-evaluation.md) ---------------

const aiEvaluationBundle = JSON.parse(
  readFileSync(new URL('../examples/ai-evaluation-bundle.json', import.meta.url), 'utf8'),
);

test('AI-evaluation worked example is schema-valid', () => {
  assert.equal(validateBundle(aiEvaluationBundle), true, JSON.stringify(validateBundle.errors));
});

test('AI-evaluation worked example derives its documented verified and disputed statuses', () => {
  const derived = deriveStatuses(aiEvaluationBundle, NOW);
  assert.equal(derived['claim.eval.refusal-safety'], 'verified');
  assert.equal(derived['claim.eval.jailbreak-resistance'], 'disputed');
});

// --- SCITT profile worked example (scitt.md §3) -----------------------------
// A registered bundle carrying its transparency-service receipt as a proof
// anchor. The receipt anchors registration; it must not affect derivation.

const scittBundle = {
  schemaVersion: 6,
  source: 'producer-a:run-91',
  producerId: 'producer-a',
  claims: [
    {
      id: 'producer-a.release.tests-pass',
      subjectType: 'npm-package',
      subjectId: 'example-lib@3.1.0',
      claimType: 'release-quality',
      fieldOrBehavior: 'test-suite-passes',
      value: true,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
      verificationPolicyId: 'producer-a.policy.release',
    },
  ],
  evidence: [
    {
      id: 'producer-a.evidence.test-output',
      claimId: 'producer-a.release.tests-pass',
      evidenceType: 'test_output',
      method: 'validation',
      sourceRef: 'ci:9912',
      excerptOrSummary: '212 tests passed, 0 failed.',
      observedAt: '2026-07-01T00:00:00.000Z',
      collectedBy: 'ci',
      passing: true,
      blocking: true,
    },
  ],
  policies: [
    {
      id: 'producer-a.policy.release',
      claimType: 'release-quality',
      requiredEvidence: ['test_output'],
      requiredMethods: ['validation'],
      requiresCorroboration: false,
      acceptanceCriteria: ['test suite passes'],
      reviewAuthority: 'repo policy',
      validityRule: { kind: 'manual' },
      stalenessTriggers: [],
      conflictRules: [],
      impactLevel: 'high',
    },
  ],
  events: [
    {
      id: 'producer-a.event.verified',
      claimId: 'producer-a.release.tests-pass',
      status: 'verified',
      actor: 'ci',
      method: 'automated-validation',
      evidenceIds: ['producer-a.evidence.test-output'],
      createdAt: '2026-07-01T00:00:01.000Z',
      verifiedAt: '2026-07-01T00:00:01.000Z',
    },
  ],
  proof: {
    anchors: [
      {
        id: 'anchor.scitt.receipt.2026-07-04',
        kind: 'transparency_log',
        algorithm: 'scitt-receipt',
        value: 'oV0hZXhhbXBsZS1yZWNlaXB0LWJ5dGVz',
        sourceRef: 'https://ts.example.com/entries/8842',
        observedAt: '2026-07-04T00:00:00.000Z',
        verificationStatus: 'unverified',
      },
    ],
  },
};

test('SCITT worked example: receipt-bearing bundle is schema-valid (scitt.md AC1)', () => {
  assert.equal(validateBundle(scittBundle), true, JSON.stringify(validateBundle.errors));
});

test('SCITT worked example: the receipt does not affect derivation', () => {
  const withProof = deriveStatuses(scittBundle, NOW);
  const { proof, ...rest } = scittBundle;
  const withoutProof = deriveStatuses({ ...rest, schemaVersion: 6 }, NOW);
  assert.deepEqual(withProof, withoutProof, 'proof MUST NOT alter derived status');
  assert.equal(withProof['producer-a.release.tests-pass'], 'verified');
});

// --- OSCAL profile worked example (oscal.md §2) ------------------------------
// An assessment-results observation/finding pair converted per the mapping:
// finding target ac-2_obj.1 satisfied, one EXAMINE observation expiring
// 2026-06-01 — so the ingested claim derives `stale` at NOW (the freshness
// bridge working as specified), while a fresh twin derives `verified`.

function oscalConverted(expiresAt) {
  return {
    schemaVersion: 6,
    source: 'assessor-x:ar-2026-01',
    producerId: 'assessor-x',
    claims: [
      {
        id: 'assessor-x.finding.7f1c',
        subjectType: 'control-objective',
        subjectId: 'ac-2_obj.1',
        claimType: 'control-assessment',
        fieldOrBehavior: 'objective-satisfied',
        value: true,
        createdAt: '2026-01-15T00:00:00.000Z',
        updatedAt: '2026-01-15T00:00:00.000Z',
        verificationPolicyId: 'assessor-x.policy.control-assessment',
        ...(expiresAt ? { expiresAt } : {}),
      },
    ],
    evidence: [
      {
        id: 'assessor-x.obs.a41b',
        claimId: 'assessor-x.finding.7f1c',
        evidenceType: 'source_excerpt',
        method: 'observation',
        sourceRef: 'https://assessor.example/evidence/a41b',
        excerptOrSummary:
          'Account management review: automated disable of inactive accounts confirmed in IdP config (EXAMINE).',
        observedAt: '2026-01-15T00:00:00.000Z',
        collectedBy: 'assessor-x',
        supportStrength: 'entails',
      },
    ],
    policies: [
      {
        id: 'assessor-x.policy.control-assessment',
        claimType: 'control-assessment',
        requiredEvidence: ['source_excerpt'],
        requiredMethods: ['observation'],
        requiresCorroboration: false,
        acceptanceCriteria: ['reviewed-controls: ac-2 objective 1'],
        reviewAuthority: 'assessor-x',
        validityRule: { kind: 'manual' },
        stalenessTriggers: ['observation expiry'],
        conflictRules: [],
        impactLevel: 'high',
      },
    ],
    events: [
      {
        id: 'assessor-x.event.7f1c',
        claimId: 'assessor-x.finding.7f1c',
        status: 'verified',
        actor: 'assessor-x',
        method: 'assessment',
        evidenceIds: ['assessor-x.obs.a41b'],
        createdAt: '2026-01-15T00:00:01.000Z',
        verifiedAt: '2026-01-15T00:00:01.000Z',
      },
    ],
  };
}

test('OSCAL worked example: converted observation/finding pair is schema-valid (oscal.md AC1)', () => {
  const bundle = oscalConverted('2026-06-01T00:00:00.000Z');
  assert.equal(validateBundle(bundle), true, JSON.stringify(validateBundle.errors));
});

test('OSCAL freshness bridge: expired observation drives stale; fresh twin derives verified', () => {
  const expired = deriveStatuses(oscalConverted('2026-06-01T00:00:00.000Z'), NOW);
  assert.equal(expired['assessor-x.finding.7f1c'], 'stale', 'past expires → stale at NOW');
  const fresh = deriveStatuses(oscalConverted('2027-06-01T00:00:00.000Z'), NOW);
  assert.equal(fresh['assessor-x.finding.7f1c'], 'verified', 'future expires → verified at NOW');
});

test('OSCAL risk mapping: open risk (blocking non-passing evidence) drives disputed', () => {
  const bundle = oscalConverted('2027-06-01T00:00:00.000Z');
  bundle.evidence.push({
    id: 'assessor-x.risk.9c02',
    claimId: 'assessor-x.finding.7f1c',
    evidenceType: 'document_citation',
    method: 'observation',
    sourceRef: 'https://assessor.example/risks/9c02',
    excerptOrSummary: 'Open risk: shared service account exempt from inactivity disable.',
    observedAt: '2026-02-01T00:00:00.000Z',
    collectedBy: 'assessor-x',
    passing: false,
    blocking: true,
    supportStrength: 'entails',
  });
  const derived = deriveStatuses(bundle, NOW);
  assert.equal(derived['assessor-x.finding.7f1c'], 'disputed', 'open OSCAL risk → disputed via Step 4c');
});

// --- Basis-annotations profile worked example (basis-annotations.md) --------
// `metadata` is an open object, so the bundle schema accepts any shape under
// it. validateBasisAnnotations / resolveSourceOfRecord are the profile's
// rejection path; each rejection below starts from the valid example.

const basisBundle = JSON.parse(
  readFileSync(new URL('../examples/basis-annotations-bundle.json', import.meta.url), 'utf8'),
);
const clone = (value) => JSON.parse(JSON.stringify(value));
const ESTIMATE_PATH = '/claims/1/metadata/estimate';

function withEstimate(estimate, claimOverrides = {}) {
  const bundle = clone(basisBundle);
  Object.assign(bundle.claims[1], claimOverrides);
  bundle.claims[1].metadata.estimate = estimate;
  return bundle;
}

test('Basis-annotations worked example is schema-valid and passes the profile checks', () => {
  assert.equal(validateBundle(basisBundle), true, JSON.stringify(validateBundle.errors));
  assert.equal(basisBundle.schemaVersion, 9);
  assert.deepEqual(validateBasisAnnotations(basisBundle), []);
  assert.deepEqual(basisBundle.claims[1].metadata.estimate, {
    basis: 'fuel spend × regional emission factor',
    low: 1100,
    high: 1400,
  });
});

test('Basis-annotations worked example derives its documented statuses, with or without the profile keys', () => {
  const derived = deriveStatuses(basisBundle, NOW);
  assert.deepEqual(derived, { 'claim.w2.wages': 'verified', 'claim.fleet.co2-2025': 'unknown' });
  const bare = clone(basisBundle);
  for (const record of [...bare.claims, ...bare.evidence]) delete record.metadata;
  assert.deepEqual(deriveStatuses(bare, NOW), derived);
});

test('Basis-annotations estimate: a basis-only estimate and an in-range bounded one are accepted', () => {
  assert.deepEqual(validateBasisAnnotations(withEstimate({ basis: 'vendor quote' })), []);
  assert.deepEqual(validateBasisAnnotations(withEstimate({ basis: 'point estimate', low: 1240, high: 1240 })), []);
});

test('Basis-annotations estimate: malformed shapes are rejected, and the bundle schema does not catch them', () => {
  const rejections = [
    ['only low', { basis: 'b', low: 1100 }, /appear together/],
    ['only high', { basis: 'b', high: 1400 }, /appear together/],
    ['low > high', { basis: 'b', low: 1400, high: 1100 }, /must be <= high/],
    ['value below low', { basis: 'b', low: 1300, high: 1400 }, /must lie within/],
    ['value above high', { basis: 'b', low: 1000, high: 1200 }, /must lie within/],
    ['missing basis', { low: 1100, high: 1400 }, /non-empty string/],
    ['empty basis', { basis: '', low: 1100, high: 1400 }, /non-empty string/],
    ['non-numeric bound', { basis: 'b', low: '1100', high: 1400 }, /finite numbers/],
    ['unknown key', { basis: 'b', midpoint: 1250 }, /unknown estimate key/],
    ['not an object', true, /must be an object/],
  ];
  for (const [label, estimate, pattern] of rejections) {
    const bundle = withEstimate(estimate);
    assert.equal(validateBundle(bundle), true, `${label}: schema is open under metadata`);
    const errors = validateBasisAnnotations(bundle);
    assert.ok(errors.length > 0, `${label}: expected a rejection`);
    assert.ok(errors.every((e) => e.instancePath.startsWith(ESTIMATE_PATH)), JSON.stringify(errors));
    assert.ok(errors.some((e) => pattern.test(e.message)), `${label}: ${JSON.stringify(errors)}`);
  }
});

test('Basis-annotations estimate: bounds on a non-numeric claim value are rejected', () => {
  const errors = validateBasisAnnotations(withEstimate({ basis: 'b', low: 1, high: 2 }, { value: 'about 1,240' }));
  assert.deepEqual(errors.map((e) => e.message), ['bounds require a numeric claim value']);
  // A basis-only estimate on a non-numeric value is fine.
  assert.deepEqual(validateBasisAnnotations(withEstimate({ basis: 'b' }, { value: 'about 1,240' })), []);
});

test('Basis-annotations sourceOfRecord: the worked example resolves to its AuthorityTrace', () => {
  const result = resolveSourceOfRecord(basisBundle, basisBundle.evidence[0]);
  assert.equal(result.backed, true);
  assert.equal(result.trace.actorRef, 'employer.example/payroll');
  assert.ok(result.trace.authorityRef.startsWith('system-of-record:'));
  // Evidence that does not declare a source of record is never backed.
  assert.deepEqual(resolveSourceOfRecord(basisBundle, basisBundle.evidence[1]), {
    backed: false,
    reason: 'not-declared',
  });
});

test('Basis-annotations sourceOfRecord: every unresolved reference is reported as not backed', () => {
  const cases = [
    ['malformed', (b) => { b.evidence[0].metadata.sourceOfRecord = true; }],
    ['malformed', (b) => { b.evidence[0].metadata.sourceOfRecord = { authorityTraceId: '' }; }],
    ['malformed', (b) => { b.evidence[0].metadata.sourceOfRecord.authoritative = true; }],
    ['claim-not-found', (b) => { b.evidence[0].claimId = 'claim.missing'; }],
    ['trace-not-found', (b) => { b.evidence[0].metadata.sourceOfRecord.authorityTraceId = 'trace.missing'; }],
    ['trace-not-found', (b) => { delete b.authorityTrace; }],
    ['trace-not-found', (b) => { b.authorityTrace = [null]; }],
    ['trace-ambiguous', (b) => { b.authorityTrace.push({ ...b.authorityTrace[0], actorRef: 'someone-else' }); }],
    ['trace-ambiguous', (b) => { b.authorityTrace.unshift({ ...b.authorityTrace[0], authorityType: 'role' }); }],
    ['inconclusive', (b) => { b.evidence[0].inconclusive = { reason: 'unreachable' }; b.evidence[0].supportStrength = 'cited'; }],
    ['subject-mismatch', (b) => { b.authorityTrace[0].subject = null; }],
    ['authority-type', (b) => { b.authorityTrace[0].authorityType = 'role'; }],
    ['subject-mismatch', (b) => { b.authorityTrace[0].subject.subjectId = 'w2:2025:employee-999'; }],
    ['not-active', (b) => { b.authorityTrace[0].validFrom = '2026-03-01T00:00:00.000Z'; }],
    ['not-active', (b) => { b.authorityTrace[0].validUntil = '2026-01-15T00:00:00.000Z'; }],
    ['not-active', (b) => { b.authorityTrace[0].revokedAt = '2026-01-15T00:00:00.000Z'; }],
    ['not-active', (b) => { b.authorityTrace[0].validUntil = 'not a date'; }],
  ];
  for (const [reason, mutate] of cases) {
    const bundle = clone(basisBundle);
    mutate(bundle);
    assert.deepEqual(resolveSourceOfRecord(bundle, bundle.evidence[0]), { backed: false, reason }, mutate.toString());
  }
  const malformed = clone(basisBundle);
  malformed.evidence[0].metadata.sourceOfRecord = { authorityTraceId: '' };
  assert.deepEqual(validateBasisAnnotations(malformed).map((e) => e.instancePath), [
    '/evidence/0/metadata/sourceOfRecord/authorityTraceId',
  ]);
});

test('Basis-annotations sourceOfRecord: a revocation after the observation stays backed and reports revokedAt', () => {
  const bundle = clone(basisBundle);
  bundle.authorityTrace[0].revokedAt = '2026-06-01T00:00:00.000Z';
  const result = resolveSourceOfRecord(bundle, bundle.evidence[0]);
  assert.equal(result.backed, true);
  assert.equal(result.revokedAt, '2026-06-01T00:00:00.000Z');
  // A trace that was never revoked reports no revocation.
  assert.equal(Object.hasOwn(resolveSourceOfRecord(basisBundle, basisBundle.evidence[0]), 'revokedAt'), false);
});

test('Basis-annotations sourceOfRecord: malformed input yields a reason and never throws', () => {
  const evidence = basisBundle.evidence[0];
  assert.deepEqual(resolveSourceOfRecord(null, evidence), { backed: false, reason: 'claim-not-found' });
  assert.deepEqual(resolveSourceOfRecord({}, evidence), { backed: false, reason: 'claim-not-found' });
  assert.deepEqual(resolveSourceOfRecord(basisBundle, null), { backed: false, reason: 'not-declared' });

  const nullEntries = clone(basisBundle);
  nullEntries.claims[0].subjectAliases = [null];
  nullEntries.identityLinks = [null, { subjects: [null, null] }, { subjects: null }];
  nullEntries.claims.unshift(null);
  assert.equal(resolveSourceOfRecord(nullEntries, nullEntries.evidence[0]).backed, true);

  // With the trace on another subject, the null entries must not match it either.
  nullEntries.authorityTrace[0].subject = { subjectType: 'payroll-record', subjectId: 'employee-123:2025' };
  assert.deepEqual(resolveSourceOfRecord(nullEntries, nullEntries.evidence[0]), {
    backed: false,
    reason: 'subject-mismatch',
  });
});

test('Basis-annotations sourceOfRecord: the subject matches through subjectAliases or an equivalent identity link only', () => {
  const other = { subjectType: 'payroll-record', subjectId: 'employee-123:2025' };

  const unlinked = clone(basisBundle);
  unlinked.authorityTrace[0].subject = other;
  assert.equal(resolveSourceOfRecord(unlinked, unlinked.evidence[0]).reason, 'subject-mismatch');

  const aliased = clone(unlinked);
  aliased.claims[0].subjectAliases = [other];
  assert.equal(resolveSourceOfRecord(aliased, aliased.evidence[0]).backed, true);

  const claimSubject = { subjectType: 'tax-form', subjectId: 'w2:2025:employee-123' };
  const linked = clone(unlinked);
  linked.identityLinks = [{ subjects: [claimSubject, other] }];
  assert.equal(validateBundle(linked), true, JSON.stringify(validateBundle.errors));
  assert.equal(resolveSourceOfRecord(linked, linked.evidence[0]).backed, true);

  const subsumes = clone(unlinked);
  subsumes.identityLinks = [{ subjects: [claimSubject, other], relation: 'subsumes' }];
  assert.equal(resolveSourceOfRecord(subsumes, subsumes.evidence[0]).reason, 'subject-mismatch');
});

// Merge unions authorityTrace by id and keeps one of two differing traces, so
// one producer's reference can end up reading another producer's trace.
test('Basis-annotations sourceOfRecord: a collided trace id is not backed over a merged bundle', () => {
  const a = clone(basisBundle);
  const b = clone(basisBundle);
  b.source = 'other-producer:2026-06';
  b.producerId = 'other-producer';
  b.claims = [{ ...b.claims[0], id: 'claim.w2.wages.other' }];
  b.evidence = [{ ...b.evidence[0], id: 'evidence.w2.box1.other', claimId: 'claim.w2.wages.other' }];
  b.events = [];
  // Same trace id, not yet valid when B's evidence was observed.
  b.authorityTrace[0].validFrom = '2026-03-01T00:00:00.000Z';
  assert.equal(validateBundle(b), true, JSON.stringify(validateBundle.errors));
  assert.deepEqual(resolveSourceOfRecord(b, b.evidence[0]), { backed: false, reason: 'not-active' });

  const { bundle: merged, collisions } = mergeBundlesDetailed([a, b]);
  assert.deepEqual(
    collisions.map((c) => [c.collection, c.id]),
    [['authorityTrace', 'trace.payroll.system-of-record']],
  );
  assert.equal(merged.authorityTrace.length, 1, 'merge keeps a single trace per id');
  const fromB = merged.evidence.find((e) => e.id === 'evidence.w2.box1.other');
  const fromA = merged.evidence.find((e) => e.id === 'evidence.w2.box1');

  // Without the collisions, B's reference reads A's trace: the hazard.
  assert.equal(resolveSourceOfRecord(merged, fromB).backed, true);
  // With them, every reference to the collided id fails closed.
  for (const evidence of [fromB, fromA]) {
    assert.deepEqual(resolveSourceOfRecord(merged, evidence, { collisions }), {
      backed: false,
      reason: 'trace-collision',
    });
  }
  // Collisions in other collections, or on other ids, do not affect it.
  const unrelated = [
    { collection: 'claims', id: 'trace.payroll.system-of-record' },
    { collection: 'authorityTrace', id: 'trace.other' },
  ];
  assert.equal(resolveSourceOfRecord(merged, fromB, { collisions: unrelated }).backed, true);
  assert.equal(resolveSourceOfRecord(merged, fromB, { collisions: [] }).backed, true);
  assert.equal(resolveSourceOfRecord(merged, fromB, { collisions: undefined }).backed, true);
  assert.equal(resolveSourceOfRecord(merged, fromB, {}).backed, true);

  // A collisions value that is present but is not the list the merge returned
  // cannot be read as "no collision": every such shape fails closed.
  const id = 'trace.payroll.system-of-record';
  const malformed = [
    null,
    'authorityTrace',
    collisions[0],
    { authorityTrace: [id] },
    [id],
    new Set(collisions),
    [{ collection: 'authorityTraces', id }],
    [{ collection: 'authorityTrace' }],
    [{ collection: 'authorityTrace', id: 7 }],
    [...collisions, null],
    0,
    false,
  ];
  for (const value of malformed) {
    assert.deepEqual(
      resolveSourceOfRecord(merged, fromB, { collisions: value }),
      { backed: false, reason: 'collisions-malformed' },
      String(JSON.stringify(value)),
    );
  }
});
