/**
 * Worked-example fixtures for profile documents: each profile's example
 * bundle must be schema-valid and must
 * derive the statuses its prose promises. Run: node --test test/profiles.fixtures.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

import { schemas, deriveStatuses } from '../index.mjs';

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
