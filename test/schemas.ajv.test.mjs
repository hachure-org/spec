/**
 * Ajv 2020-12 structural validation for every schema in schemas/, plus
 * positive/negative fixtures proving the schema-correctness fixes have teeth.
 * Run with: node --test test/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdtempSync, writeFileSync, cpSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';

import { validateConclusionConfidence, checkBasisInvariants } from '../index.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'bin', 'hachure.mjs');
const schemasDir = join(__dirname, '..', 'schemas');
const conformanceDir = join(__dirname, '..', 'conformance');

function loadSchemaFiles() {
  const files = {};
  for (const file of readdirSync(schemasDir).sort()) {
    if (!file.endsWith('.schema.json')) continue;
    files[file] = JSON.parse(readFileSync(join(schemasDir, file), 'utf8'));
  }
  return files;
}

// Mirrors flow's trust-bundle-validator.ts loader pattern: register every
// sibling schema via addSchema (keyed by filename, matching the relative
// $ref strings used throughout schemas/*.json), then compile one file as
// the "root" under test.
function buildAjv() {
  return new Ajv2020({ strict: false, allErrors: true });
}

const schemaFiles = loadSchemaFiles();

// ---------------------------------------------------------------------------
// Load-all-schemas smoke test
// ---------------------------------------------------------------------------
test('all schema files are present', () => {
  const names = Object.keys(schemaFiles).sort();
  assert.deepEqual(names, [
    'claim.schema.json',
    'derivation-rule.schema.json',
    'evidence.schema.json',
    'inquiry-record.schema.json',
    'trust-bundle.schema.json',
    'trust-report-waivers.schema.json',
    'trust-report.schema.json',
    'verification-event.schema.json',
    'verification-policy.schema.json',
  ]);
});

for (const rootFilename of Object.keys(schemaFiles)) {
  test(`schema "${rootFilename}" is valid JSON Schema 2020-12 and Ajv-compiles with siblings registered`, () => {
    const ajv = buildAjv();
    for (const [filename, schema] of Object.entries(schemaFiles)) {
      if (filename === rootFilename) continue;
      ajv.addSchema(schema, filename);
    }
    assert.doesNotThrow(() => {
      ajv.compile(schemaFiles[rootFilename]);
    });
  });
}

function compileRoot(rootFilename) {
  const ajv = buildAjv();
  for (const [filename, schema] of Object.entries(schemaFiles)) {
    if (filename === rootFilename) continue;
    ajv.addSchema(schema, filename);
  }
  return ajv.compile(schemaFiles[rootFilename]);
}

// ---------------------------------------------------------------------------
// AC1 — identityLinks schema matches prose (Defect 1)
// ---------------------------------------------------------------------------
test('AC1: identityLink with all 7 fields validates against trust-bundle.schema.json', () => {
  const validateBundle = compileRoot('trust-bundle.schema.json');
  const bundle = {
    schemaVersion: 5,
    source: 'test',
    claims: [],
    evidence: [],
    policies: [],
    events: [],
    identityLinks: [
      {
        id: 'link.1',
        subjects: [
          { subjectType: 'credential', subjectId: 'a' },
          { subjectType: 'credential', subjectId: 'b' },
        ],
        reason: 'same underlying credential',
        attestedBy: 'access-service',
        relation: 'converts',
        conversion: { factor: 1.5, offset: 0, note: 'unit conversion' },
        mappingClaimId: 'claim.mapping.1',
      },
    ],
  };
  const valid = validateBundle(bundle);
  assert.equal(valid, true, JSON.stringify(validateBundle.errors));
});

test('AC1: identityLink with an unknown extra key is rejected', () => {
  const validateBundle = compileRoot('trust-bundle.schema.json');
  const bundle = {
    schemaVersion: 5,
    source: 'test',
    claims: [],
    evidence: [],
    policies: [],
    events: [],
    identityLinks: [
      {
        subjects: [
          { subjectType: 'credential', subjectId: 'a' },
          { subjectType: 'credential', subjectId: 'b' },
        ],
        unknownKey: 'not allowed',
      },
    ],
  };
  const valid = validateBundle(bundle);
  assert.equal(valid, false);
});

// ---------------------------------------------------------------------------
// AC3 — policies/events $ref sub-schemas (Defect 3)
// ---------------------------------------------------------------------------
const revokedVector = JSON.parse(
  readFileSync(join(conformanceDir, 'sf-revoked-event.json'), 'utf8'),
);

test('AC3: a real conformance-vector policy/event validates against trust-bundle.schema.json', () => {
  const validateBundle = compileRoot('trust-bundle.schema.json');
  const bundle = {
    ...revokedVector.input,
  };
  const valid = validateBundle(bundle);
  assert.equal(valid, true, JSON.stringify(validateBundle.errors));
});

test('AC3: a policy object missing a required field is rejected by the bundle schema', () => {
  const validateBundle = compileRoot('trust-bundle.schema.json');
  const badPolicy = { ...revokedVector.input.policies[0] };
  delete badPolicy.reviewAuthority;
  const bundle = {
    ...revokedVector.input,
    policies: [badPolicy],
  };
  const valid = validateBundle(bundle);
  assert.equal(valid, false);
});

test('AC3: an event object missing a required field is rejected by the bundle schema', () => {
  const validateBundle = compileRoot('trust-bundle.schema.json');
  const badEvent = { ...revokedVector.input.events[0] };
  delete badEvent.actor;
  const bundle = {
    ...revokedVector.input,
    events: [badEvent],
  };
  const valid = validateBundle(bundle);
  assert.equal(valid, false);
});

// ---------------------------------------------------------------------------
// AC2 — trust-report.schema.json shipped (Defect 2)
// ---------------------------------------------------------------------------
function buildTrustReportFixture() {
  return {
    schemaVersion: 5,
    id: 'report.1',
    generatedAt: '2026-06-10T00:00:00.000Z',
    source: 'test',
    claims: [
      {
        id: 'claim.access.grant',
        subjectType: 'credential',
        subjectId: 'access:deploy-key-7',
        facet: 'access-control.grants',
        claimType: 'software-evidence',
        fieldOrBehavior: 'deployKeyValid',
        value: true,
        status: 'stale',
        producerStatus: 'revoked',
        freshness: { asOf: '2026-06-10T00:00:00.000Z', stale: true },
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-06-05T00:00:00.000Z',
      },
    ],
    evidence: [],
    policies: [],
    events: [],
    evidenceRequirementsByClaimId: {
      'claim.access.grant': { requiredEvidence: ['test_output'] },
    },
    transparencyGaps: [{ claimId: 'claim.access.grant', kind: 'missing-evidence' }],
    changeRecords: [{ claimId: 'claim.access.grant', from: 'verified', to: 'stale' }],
    subjectGroups: [{ subjectType: 'credential', subjectId: 'access:deploy-key-7', claimIds: ['claim.access.grant'] }],
    claimGroupRollups: [{ claimGroupId: 'group.1', status: 'stale' }],
    summary: { totalClaims: 1, byStatus: { stale: 1 } },
    statusFunctionVersion: '2',
  };
}

test('AC2: a TrustReport fixture matching buildTrustReport()\'s documented shape validates against trust-report.schema.json', () => {
  const validateReport = compileRoot('trust-report.schema.json');
  const report = buildTrustReportFixture();
  const valid = validateReport(report);
  assert.equal(valid, true, JSON.stringify(validateReport.errors));
});

test('AC2: a bare TrustBundle (no report-only fields) is rejected by trust-report.schema.json', () => {
  const validateReport = compileRoot('trust-report.schema.json');
  const bundle = {
    schemaVersion: 5,
    source: 'test',
    claims: [],
    evidence: [],
    policies: [],
    events: [],
  };
  const valid = validateReport(bundle);
  assert.equal(valid, false);
});

test('AC2: a TrustReport-shaped object is rejected by trust-bundle.schema.json\'s not/anyOf discriminator', () => {
  const validateBundle = compileRoot('trust-bundle.schema.json');
  const report = buildTrustReportFixture();
  const valid = validateBundle(report);
  assert.equal(valid, false);
});

// ---------------------------------------------------------------------------
// Waivers extension (trust-report-waivers.schema.json) — #128 / Option B
//
// The core trust-report schema was restructured into an OPEN $defs/core building
// block closed at the top level by unevaluatedProperties:false. These tests lock
// in three properties: (1) the restructure is behaviour-preserving for core-only
// validation; (2) core still REJECTS the additive waiver-validity fields; and
// (3) the extension schema accepts exactly core + the two waiver fields.
// ---------------------------------------------------------------------------
function buildWaiverReportFixture() {
  const report = buildTrustReportFixture();
  report.waiverValidityFunctionVersion = '1';
  // Built via JSON so "__proto__" is a real OWN key (as in a deserialized
  // report), not the JS object-literal prototype setter.
  report.waiverValidityByClaimId = JSON.parse(
    '{"claim.access.grant":{"verdict":"bare-assumed","approverAuthenticated":false},' +
      '"__proto__":{"verdict":"complete-waiver","approverAuthenticated":false,' +
      '"waiver":{"reason":"deferred","approved_by":"lead","approved_at":"2026-06-01T00:00:00.000Z"}}}',
  );
  return report;
}

test('waivers-ext: the restructured core still validates the documented TrustReport fixture (behaviour-preserving)', () => {
  const validateReport = compileRoot('trust-report.schema.json');
  const valid = validateReport(buildTrustReportFixture());
  assert.equal(valid, true, JSON.stringify(validateReport.errors));
});

test('waivers-ext: core trust-report REJECTS a report carrying waiver-validity fields (stays strict/neutral)', () => {
  const validateReport = compileRoot('trust-report.schema.json');
  const valid = validateReport(buildWaiverReportFixture());
  assert.equal(valid, false);
  assert.ok(
    validateReport.errors.some((e) => e.keyword === 'unevaluatedProperties'),
    JSON.stringify(validateReport.errors),
  );
});

test('waivers-ext: a waiver-bearing report validates against trust-report-waivers.schema.json (incl. a "__proto__" claim-id key)', () => {
  const validateExt = compileRoot('trust-report-waivers.schema.json');
  const report = buildWaiverReportFixture();
  assert.ok(Object.hasOwn(report.waiverValidityByClaimId, '__proto__'));
  const valid = validateExt(report);
  assert.equal(valid, true, JSON.stringify(validateExt.errors));
});

test('waivers-ext: a core-only report (no waiver fields) still validates against the extension schema', () => {
  const validateExt = compileRoot('trust-report-waivers.schema.json');
  const valid = validateExt(buildTrustReportFixture());
  assert.equal(valid, true, JSON.stringify(validateExt.errors));
});

test('waivers-ext: the extension schema still rejects an unknown top-level field', () => {
  const validateExt = compileRoot('trust-report-waivers.schema.json');
  const report = { ...buildWaiverReportFixture(), someUnknownField: 123 };
  const valid = validateExt(report);
  assert.equal(valid, false);
  assert.ok(
    validateExt.errors.some((e) => e.keyword === 'unevaluatedProperties'),
    JSON.stringify(validateExt.errors),
  );
});

test('waivers-ext: the extension schema rejects an out-of-vocabulary verdict', () => {
  const validateExt = compileRoot('trust-report-waivers.schema.json');
  const report = buildTrustReportFixture();
  report.waiverValidityFunctionVersion = '1';
  report.waiverValidityByClaimId = {
    'claim.access.grant': { verdict: 'totally-authorized', approverAuthenticated: false },
  };
  const valid = validateExt(report);
  assert.equal(valid, false);
});

// ---------------------------------------------------------------------------
// AC4 — evidenceType/requiredEvidence enum alignment
// ---------------------------------------------------------------------------
test('AC4: requiredEvidence/evidenceType enums are identical 9-value lists across files', () => {
  const policyEnum = schemaFiles['verification-policy.schema.json'].properties.requiredEvidence.items.enum;
  const evidenceEnum = schemaFiles['evidence.schema.json'].properties.evidenceType.enum;
  const bundleEnum =
    schemaFiles['trust-bundle.schema.json'].$defs.validationStrategy.properties.requiredEvidence.items.enum;

  assert.deepEqual([...policyEnum].sort(), [...evidenceEnum].sort());
  assert.deepEqual([...policyEnum].sort(), [...bundleEnum].sort());
  assert.equal(policyEnum.length, 9);
  assert.ok(policyEnum.includes('attestation'));
  assert.ok(policyEnum.includes('runtime_observation'));
});

// ---------------------------------------------------------------------------
// AC5 — revoked status enum alignment
// ---------------------------------------------------------------------------
// There are 7 canonical trust-status-enum sites across schemas/*.json:
//   1. claim.schema.json            properties.status            ($ref -> $defs.trustStatus)
//   2. claim.schema.json            properties.producerStatus    ($ref -> $defs.trustStatus)
//   3. verification-event.schema.json properties.status
//   4. verification-policy.schema.json properties.incompatibleStatuses[].statuses items
//   5. derivation-rule.schema.json  $defs.derivationRequirement.properties.acceptedStatuses items
//   6. inquiry-record.schema.json   properties.answer.properties.status
//   7. inquiry-record.schema.json   properties.inputSnapshot[].properties.status
test('AC5: revoked is present in all 7 canonical status-enum sites, and claim.schema.json dedupes status/producerStatus via $defs', () => {
  const claimTrustStatusEnum = schemaFiles['claim.schema.json'].$defs.trustStatus.enum;

  // claim.schema.json's two sites are $refs into the same $defs/trustStatus
  // definition rather than duplicated enum literals; assert both properties
  // resolve to it, and that the shared definition itself is canonical.
  assert.deepEqual(schemaFiles['claim.schema.json'].properties.status, { $ref: '#/$defs/trustStatus' });
  assert.deepEqual(schemaFiles['claim.schema.json'].properties.producerStatus, { $ref: '#/$defs/trustStatus' });

  const sites = [
    claimTrustStatusEnum,
    schemaFiles['verification-event.schema.json'].properties.status.enum,
    schemaFiles['verification-policy.schema.json'].properties.incompatibleStatuses.items.properties.statuses.items
      .enum,
    schemaFiles['derivation-rule.schema.json'].$defs.derivationRequirement.properties.acceptedStatuses.items.enum,
    schemaFiles['inquiry-record.schema.json'].properties.answer.properties.status.enum,
    schemaFiles['inquiry-record.schema.json'].properties.inputSnapshot.items.properties.status.enum,
  ];
  for (const enumValues of sites) {
    assert.ok(enumValues.includes('revoked'), JSON.stringify(enumValues));
    assert.deepEqual([...enumValues].sort(), [...claimTrustStatusEnum].sort());
  }
});

// ---------------------------------------------------------------------------
// AC7 — all conformance vectors still pass under the tightened schema
// ---------------------------------------------------------------------------
test('all conformance/*.json input bundles validate against the tightened trust-bundle.schema.json', () => {
  const validateBundle = compileRoot('trust-bundle.schema.json');
  for (const file of readdirSync(conformanceDir).sort()) {
    // manifest.json is the structured conformance manifest (levels/requirements),
    // not a { input, expect, now } vector — not a TrustBundle to validate here.
    if (!file.endsWith('.json') || file === 'manifest.json') continue;
    const vector = JSON.parse(readFileSync(join(conformanceDir, file), 'utf8'));
    const valid = validateBundle(vector.input);
    assert.equal(valid, true, `${file}: ${JSON.stringify(validateBundle.errors)}`);
  }
});

// ---------------------------------------------------------------------------
// AC1/AC2 (facet-rename, 0.9.0) — Claim.surface -> Claim.facet hard break
// ---------------------------------------------------------------------------
function buildBaseClaim() {
  return {
    id: 'claim.facet-rename-test.1',
    subjectType: 'repo',
    subjectId: 'test-repo',
    claimType: 'coverage',
    fieldOrBehavior: 'lineCoverage',
    value: 80,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };
}

function buildBaseBundle(schemaVersion, claim) {
  return {
    schemaVersion,
    source: 'test',
    claims: [claim],
    evidence: [],
    policies: [],
    events: [],
  };
}

test('AC1: a claim omitting `facet` entirely still validates against claim.schema.json (locks in optionality)', () => {
  const validateClaim = compileRoot('claim.schema.json');
  const claim = buildBaseClaim();
  assert.ok(!('facet' in claim));
  const valid = validateClaim(claim);
  assert.equal(valid, true, JSON.stringify(validateClaim.errors));
});

test('AC1: a claim carrying the legacy `surface` key is rejected by claim.schema.json\'s additionalProperties', () => {
  const validateClaim = compileRoot('claim.schema.json');
  const claim = { ...buildBaseClaim(), facet: 'coverage.unit', surface: 'legacy-value' };
  const valid = validateClaim(claim);
  assert.equal(valid, false);
  assert.ok(
    validateClaim.errors.some(
      (e) => e.keyword === 'additionalProperties' && e.params.additionalProperty === 'surface',
    ),
    JSON.stringify(validateClaim.errors),
  );
});

// ---------------------------------------------------------------------------
// derivationEdges.sensitivity — a quantitative edge carries a range, never a
// bare number (kontourai/surface#24).
// ---------------------------------------------------------------------------
test('sensitivity: a derivationEdge carrying a {low,high,basis} sensitivity range validates', () => {
  const validateClaim = compileRoot('claim.schema.json');
  const claim = {
    ...buildBaseClaim(),
    derivationEdges: [
      {
        inputClaimId: 'claim.pretax-income',
        method: 'rule-application',
        sensitivity: { low: 210000, high: 290000, basis: '5% of pretax income, ±$40K' },
      },
    ],
  };
  const valid = validateClaim(claim);
  assert.equal(valid, true, JSON.stringify(validateClaim.errors));
});

test('sensitivity: a derivationEdge omitting sensitivity still validates (optional, backward-compatible)', () => {
  const validateClaim = compileRoot('claim.schema.json');
  const claim = { ...buildBaseClaim(), derivationEdges: [{ inputClaimId: 'claim.x', method: 'sum' }] };
  const valid = validateClaim(claim);
  assert.equal(valid, true, JSON.stringify(validateClaim.errors));
});

test('sensitivity: a partial sensitivity (missing basis) is rejected', () => {
  const validateClaim = compileRoot('claim.schema.json');
  const claim = {
    ...buildBaseClaim(),
    derivationEdges: [{ inputClaimId: 'claim.x', sensitivity: { low: 1, high: 2 } }],
  };
  assert.equal(validateClaim(claim), false);
});

test('sensitivity: a non-numeric bound or unknown key inside sensitivity is rejected', () => {
  const validateClaim = compileRoot('claim.schema.json');
  const badType = {
    ...buildBaseClaim(),
    derivationEdges: [{ inputClaimId: 'claim.x', sensitivity: { low: '1', high: 2, basis: 'b' } }],
  };
  assert.equal(validateClaim(badType), false);
  const extraKey = {
    ...buildBaseClaim(),
    derivationEdges: [{ inputClaimId: 'claim.x', sensitivity: { low: 1, high: 2, basis: 'b', midpoint: 1.5 } }],
  };
  assert.equal(validateClaim(extraKey), false);
});

test('AC2: a schemaVersion:4 bundle whose claim carries `surface` is rejected on both the schemaVersion enum and the claim\'s additionalProperties', () => {
  const validateBundle = compileRoot('trust-bundle.schema.json');
  const claim = { ...buildBaseClaim(), surface: 'legacy-value' };
  const bundle = buildBaseBundle(4, claim);
  const valid = validateBundle(bundle);
  assert.equal(valid, false);
  const errors = validateBundle.errors;
  assert.ok(
    errors.some((e) => e.instancePath === '/schemaVersion' && e.keyword === 'enum'),
    JSON.stringify(errors),
  );
  assert.ok(
    errors.some((e) => e.keyword === 'additionalProperties' && e.params.additionalProperty === 'surface'),
    JSON.stringify(errors),
  );
});

test('AC1/AC2: a schemaVersion:5 bundle whose claim carries `facet` validates cleanly (happy path)', () => {
  const validateBundle = compileRoot('trust-bundle.schema.json');
  const claim = { ...buildBaseClaim(), facet: 'coverage.unit' };
  const bundle = buildBaseBundle(5, claim);
  const valid = validateBundle(bundle);
  assert.equal(valid, true, JSON.stringify(validateBundle.errors));
});

// ---------------------------------------------------------------------------
// schemaVersion 6: optional `proof` block (assurance.md / interop-in-toto.md /
// verification-endpoint.md all reference it; before schemaVersion 6 it was
// rejected by additionalProperties — the contradiction this addition resolves).
// ---------------------------------------------------------------------------

test('proof: a schemaVersion:6 bundle with a transparency_log proof anchor validates', () => {
  const validateBundle = compileRoot('trust-bundle.schema.json');
  const bundle = buildBaseBundle(6, buildBaseClaim());
  bundle.proof = {
    anchors: [
      {
        id: 'anchor.rekor.entry',
        kind: 'transparency_log',
        algorithm: 'rekor',
        value: '24296fb24b8ad77a-example-log-entry-uuid',
        sourceRef: 'https://rekor.sigstore.dev/api/v1/log/entries/...',
      },
    ],
  };
  const valid = validateBundle(bundle);
  assert.equal(valid, true, JSON.stringify(validateBundle.errors));
});

test('proof: a schemaVersion:5 bundle without proof remains valid (5 stays a valid floor under 6)', () => {
  const validateBundle = compileRoot('trust-bundle.schema.json');
  const bundle = buildBaseBundle(5, buildBaseClaim());
  const valid = validateBundle(bundle);
  assert.equal(valid, true, JSON.stringify(validateBundle.errors));
});

test('proof: unknown keys inside the proof block are rejected', () => {
  const validateBundle = compileRoot('trust-bundle.schema.json');
  const bundle = buildBaseBundle(6, buildBaseClaim());
  bundle.proof = { signature: 'raw-signatures-do-not-live-here' };
  const valid = validateBundle(bundle);
  assert.equal(valid, false);
  assert.ok(
    validateBundle.errors.some(
      (e) => e.keyword === 'additionalProperties' && e.params.additionalProperty === 'signature',
    ),
    JSON.stringify(validateBundle.errors),
  );
});

// ---------------------------------------------------------------------------
// conclusionConfidence — calibrated conclusion confidence + comfort zone
// (Surface #25). Carried, not produced; method/reason are free-form.
// ---------------------------------------------------------------------------
test('conclusionConfidence: a claim carrying calibrated confidence + comfort zone validates', () => {
  const validateClaim = compileRoot('claim.schema.json');
  const claim = {
    ...buildBaseClaim(),
    conclusionConfidence: {
      value: 0.82,
      method: 'ensemble-disagreement',
      interval: { low: 0.71, high: 0.9 },
      comfortZone: { within: false, reason: 'out-of-distribution' },
    },
  };
  assert.equal(validateClaim(claim), true, JSON.stringify(validateClaim.errors));
});

test('conclusionConfidence: value outside [0,1] is rejected', () => {
  const validateClaim = compileRoot('claim.schema.json');
  const claim = { ...buildBaseClaim(), conclusionConfidence: { value: 1.5 } };
  assert.equal(validateClaim(claim), false);
});

test('conclusionConfidence: comfortZone requires `within`', () => {
  const validateClaim = compileRoot('claim.schema.json');
  const claim = { ...buildBaseClaim(), conclusionConfidence: { comfortZone: { reason: 'x' } } };
  assert.equal(validateClaim(claim), false);
});

test('conclusionConfidence: unknown extra keys are rejected', () => {
  const validateClaim = compileRoot('claim.schema.json');
  const claim = { ...buildBaseClaim(), conclusionConfidence: { value: 0.5, confidence: 0.9 } };
  const valid = validateClaim(claim);
  assert.equal(valid, false);
  assert.ok(
    validateClaim.errors.some((e) => e.keyword === 'additionalProperties'),
    JSON.stringify(validateClaim.errors),
  );
});

// ---------------------------------------------------------------------------
// conclusionConfidence.calibration (schemaVersion 8): `value` names the
// versioned calibration table that produced it.
// ---------------------------------------------------------------------------
const CALIBRATION = { tableRef: 'calibration://example/table', tableVersion: '2026-05-15' };

test('calibration: schemaVersion 8 rejects a conclusionConfidence.value without calibration', () => {
  const validateBundle = compileRoot('trust-bundle.schema.json');
  const claim = { ...buildBaseClaim(), conclusionConfidence: { value: 0.8 } };
  assert.equal(validateBundle(buildBaseBundle(8, claim)), false);
  assert.ok(
    validateBundle.errors.some((e) => e.keyword === 'dependentRequired' && e.params.missingProperty === 'calibration'),
    JSON.stringify(validateBundle.errors),
  );
});

test('calibration: schemaVersion 8 accepts value with calibration, and comfortZone alone', () => {
  const validateBundle = compileRoot('trust-bundle.schema.json');
  const withTable = { ...buildBaseClaim(), conclusionConfidence: { value: 0.8, calibration: CALIBRATION } };
  assert.equal(validateBundle(buildBaseBundle(8, withTable)), true, JSON.stringify(validateBundle.errors));
  const comfortOnly = { ...buildBaseClaim(), conclusionConfidence: { comfortZone: { within: true } } };
  assert.equal(validateBundle(buildBaseBundle(8, comfortOnly)), true, JSON.stringify(validateBundle.errors));
});

test('calibration: schemaVersion 7 still accepts value without calibration (SHOULD, not MUST)', () => {
  const validateBundle = compileRoot('trust-bundle.schema.json');
  const claim = { ...buildBaseClaim(), conclusionConfidence: { value: 0.8 } };
  assert.equal(validateBundle(buildBaseBundle(7, claim)), true, JSON.stringify(validateBundle.errors));
});

test('calibration: a calibration reference must name both table and version', () => {
  const validateClaim = compileRoot('claim.schema.json');
  for (const calibration of [{ tableRef: 'x' }, { tableVersion: '1' }, { tableRef: '', tableVersion: '1' }]) {
    const claim = { ...buildBaseClaim(), conclusionConfidence: { value: 0.8, calibration } };
    assert.equal(validateClaim(claim), false, JSON.stringify(calibration));
  }
});

test('calibration: schemaVersion 8 rejects interval bounds outside [0,1]', () => {
  const validateBundle = compileRoot('trust-bundle.schema.json');
  const claim = {
    ...buildBaseClaim(),
    conclusionConfidence: { value: 0.8, calibration: CALIBRATION, interval: { low: 7, high: -3 } },
  };
  assert.equal(validateBundle(buildBaseBundle(8, claim)), false);
  const paths = validateBundle.errors.map((e) => e.instancePath);
  assert.ok(paths.includes('/claims/0/conclusionConfidence/interval/low'), JSON.stringify(validateBundle.errors));
  assert.ok(paths.includes('/claims/0/conclusionConfidence/interval/high'), JSON.stringify(validateBundle.errors));
});

test('calibration: schemaVersion 7 validates an out-of-range interval as before (additive change)', () => {
  const validateBundle = compileRoot('trust-bundle.schema.json');
  const claim = { ...buildBaseClaim(), conclusionConfidence: { value: 0.8, interval: { low: 7, high: -3 } } };
  assert.equal(validateBundle(buildBaseBundle(7, claim)), true, JSON.stringify(validateBundle.errors));
});

// Cross-field rules JSON Schema cannot express: checked in code for schema 8.
test('validateConclusionConfidence: low > high and value outside interval are reported at schemaVersion 8 only', () => {
  const cc = (conclusionConfidence) => ({ ...buildBaseClaim(), conclusionConfidence });
  const inverted = cc({ calibration: CALIBRATION, interval: { low: 0.9, high: 0.2 } });
  const outside = cc({ value: 0.95, calibration: CALIBRATION, interval: { low: 0.1, high: 0.5 } });
  const below = cc({ value: 0.05, calibration: CALIBRATION, interval: { low: 0.1, high: 0.5 } });
  const ok = cc({ value: 0.3, calibration: CALIBRATION, interval: { low: 0.1, high: 0.5 } });

  assert.deepEqual(validateConclusionConfidence(buildBaseBundle(8, inverted)).map((e) => e.instancePath), [
    '/claims/0/conclusionConfidence/interval',
  ]);
  assert.match(validateConclusionConfidence(buildBaseBundle(8, outside))[0].message, /must be <= interval.high/);
  assert.match(validateConclusionConfidence(buildBaseBundle(8, below))[0].message, /must be >= interval.low/);
  assert.deepEqual(validateConclusionConfidence(buildBaseBundle(8, ok)), []);
  for (const claim of [inverted, outside, below]) {
    assert.deepEqual(validateConclusionConfidence(buildBaseBundle(7, claim)), []);
  }
});

test('hachure validate exits 1 on a schema-valid v8 bundle whose value lies outside its interval', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hachure-cc-'));
  const claim = {
    ...buildBaseClaim(),
    conclusionConfidence: { value: 0.95, calibration: CALIBRATION, interval: { low: 0.1, high: 0.5 } },
  };
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, JSON.stringify(buildBaseBundle(8, claim)));
  const r = spawnSync(process.execPath, [CLI, 'validate', bad], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /\/claims\/0\/conclusionConfidence\/value value \(0.95\) must be <= interval.high/);

  const good = join(dir, 'good.json');
  writeFileSync(good, JSON.stringify(buildBaseBundle(8, { ...claim, conclusionConfidence: { ...claim.conclusionConfidence, value: 0.3 } })));
  const ok = spawnSync(process.execPath, [CLI, 'validate', good], { encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
});

// ---------------------------------------------------------------------------
// schemaVersion 9: evidence.inconclusive and evidence.collectedByKind.
// An inconclusive item is an attempt that could not run. It must be `cited`
// and carry no `passing`, which is what keeps it out of status derivation.
// ---------------------------------------------------------------------------
function buildInconclusiveEvidence(overrides = {}) {
  return {
    id: 'ev-9',
    claimId: 'claim.facet-rename-test.1',
    evidenceType: 'runtime_observation',
    method: 'monitoring',
    supportStrength: 'cited',
    sourceRef: 'https://metrics.example/p95',
    excerptOrSummary: 'Metrics endpoint returned 503',
    observedAt: '2026-09-26T10:00:00Z',
    collectedBy: 'ci-probe',
    inconclusive: { reason: 'unreachable', detail: 'HTTP 503 after 3 retries' },
    ...overrides,
  };
}

function withoutKey(object, key) {
  const { [key]: _removed, ...rest } = object;
  return rest;
}

test('inconclusive: a cited evidence item with each reason validates', () => {
  const validateEvidence = compileRoot('evidence.schema.json');
  for (const reason of ['unreachable', 'tool_error', 'permission_denied', 'timeout']) {
    const evidence = buildInconclusiveEvidence({ inconclusive: { reason } });
    assert.equal(validateEvidence(evidence), true, `${reason}: ${JSON.stringify(validateEvidence.errors)}`);
  }
  const other = buildInconclusiveEvidence({ inconclusive: { reason: 'other', detail: 'unparseable response' } });
  assert.equal(validateEvidence(other), true, JSON.stringify(validateEvidence.errors));
  // execution.isError may accompany it; isError alone never implies inconclusive.
  const withExecution = buildInconclusiveEvidence({
    inconclusive: { reason: 'tool_error' },
    execution: { runner: 'bash', label: 'p95 probe', isError: true },
  });
  assert.equal(validateEvidence(withExecution), true, JSON.stringify(validateEvidence.errors));
});

test('inconclusive: rejected together with `passing` (true or false)', () => {
  const validateEvidence = compileRoot('evidence.schema.json');
  for (const passing of [true, false]) {
    assert.equal(validateEvidence(buildInconclusiveEvidence({ passing })), false, `passing: ${passing}`);
    assert.ok(
      validateEvidence.errors.some((e) => e.keyword === 'not'),
      JSON.stringify(validateEvidence.errors),
    );
  }
});

test('inconclusive: rejected with supportStrength "entails"', () => {
  const validateEvidence = compileRoot('evidence.schema.json');
  assert.equal(validateEvidence(buildInconclusiveEvidence({ supportStrength: 'entails' })), false);
  assert.ok(
    validateEvidence.errors.some((e) => e.instancePath === '/supportStrength' && e.keyword === 'const'),
    JSON.stringify(validateEvidence.errors),
  );
});

test('inconclusive: rejected when supportStrength is absent (absent means entails)', () => {
  const validateEvidence = compileRoot('evidence.schema.json');
  assert.equal(validateEvidence(withoutKey(buildInconclusiveEvidence(), 'supportStrength')), false);
  assert.ok(
    validateEvidence.errors.some((e) => e.keyword === 'required' && e.params.missingProperty === 'supportStrength'),
    JSON.stringify(validateEvidence.errors),
  );
});

test('inconclusive: reason "other" without detail is rejected', () => {
  const validateEvidence = compileRoot('evidence.schema.json');
  assert.equal(validateEvidence(buildInconclusiveEvidence({ inconclusive: { reason: 'other' } })), false);
  assert.ok(
    validateEvidence.errors.some((e) => e.keyword === 'required' && e.params.missingProperty === 'detail'),
    JSON.stringify(validateEvidence.errors),
  );
  assert.equal(validateEvidence(buildInconclusiveEvidence({ inconclusive: { reason: 'other', detail: '' } })), false);
});

test('inconclusive: an unknown reason, a missing reason, and an unknown key are rejected', () => {
  const validateEvidence = compileRoot('evidence.schema.json');
  for (const inconclusive of [
    { reason: 'rate_limited' },
    { reason: 'not_applicable' },
    { detail: 'no reason given' },
    { reason: 'timeout', retries: 3 },
    true,
  ]) {
    assert.equal(validateEvidence(buildInconclusiveEvidence({ inconclusive })), false, JSON.stringify(inconclusive));
  }
});

test('the inconclusive constraints leave ordinary evidence alone', () => {
  const validateEvidence = compileRoot('evidence.schema.json');
  const base = withoutKey(buildInconclusiveEvidence(), 'inconclusive');
  for (const evidence of [
    base,
    withoutKey(base, 'supportStrength'),
    { ...base, supportStrength: 'entails', passing: false, blocking: true },
    { ...base, passing: true },
  ]) {
    assert.equal(validateEvidence(evidence), true, JSON.stringify(validateEvidence.errors));
  }
});

test('collectedByKind: each of human / deterministic / model validates', () => {
  const validateEvidence = compileRoot('evidence.schema.json');
  const base = withoutKey(buildInconclusiveEvidence(), 'inconclusive');
  for (const collectedByKind of ['human', 'deterministic', 'model']) {
    assert.equal(validateEvidence({ ...base, collectedByKind }), true, JSON.stringify(validateEvidence.errors));
  }
  const withModel = {
    ...base,
    collectedByKind: 'model',
    metadata: { collectorModel: { name: 'example-llm', version: '2026-06' } },
  };
  assert.equal(validateEvidence(withModel), true, JSON.stringify(validateEvidence.errors));
});

test('collectedByKind: an unknown value is rejected', () => {
  const validateEvidence = compileRoot('evidence.schema.json');
  const base = withoutKey(buildInconclusiveEvidence(), 'inconclusive');
  for (const collectedByKind of ['hybrid', 'llm', '', null]) {
    assert.equal(validateEvidence({ ...base, collectedByKind }), false, JSON.stringify(collectedByKind));
    assert.ok(
      validateEvidence.errors.some((e) => e.instancePath === '/collectedByKind' && e.keyword === 'enum'),
      JSON.stringify(validateEvidence.errors),
    );
  }
});

test('schemaVersion 9: a bundle using the new evidence fields validates', () => {
  const validateBundle = compileRoot('trust-bundle.schema.json');
  const bundle = buildBaseBundle(9, buildBaseClaim());
  bundle.evidence = [buildInconclusiveEvidence({ collectedByKind: 'deterministic' })];
  assert.equal(validateBundle(bundle), true, JSON.stringify(validateBundle.errors));
});

test('schemaVersion 9: a bundle declaring 8 or lower is rejected when it uses a version 9 evidence field', () => {
  const validateBundle = compileRoot('trust-bundle.schema.json');
  const plain = withoutKey(buildInconclusiveEvidence(), 'inconclusive');
  for (const schemaVersion of [5, 8]) {
    for (const evidence of [buildInconclusiveEvidence(), { ...plain, collectedByKind: 'model' }]) {
      const bundle = buildBaseBundle(schemaVersion, buildBaseClaim());
      bundle.evidence = [evidence];
      assert.equal(validateBundle(bundle), false, `schemaVersion ${schemaVersion}`);
      assert.ok(
        validateBundle.errors.some((e) => e.instancePath === '/evidence/0' && e.keyword === 'not'),
        JSON.stringify(validateBundle.errors),
      );
    }
    // The same bundle without the new fields validates as before.
    const bundle = buildBaseBundle(schemaVersion, buildBaseClaim());
    bundle.evidence = [plain];
    assert.equal(validateBundle(bundle), true, JSON.stringify(validateBundle.errors));
  }
});

test('schemaVersion 9: 5 through 9 are accepted and 10 is not', () => {
  const validateBundle = compileRoot('trust-bundle.schema.json');
  assert.deepEqual(schemaFiles['trust-bundle.schema.json'].properties.schemaVersion.enum, [5, 6, 7, 8, 9]);
  for (const schemaVersion of [5, 6, 7, 8, 9]) {
    assert.equal(
      validateBundle(buildBaseBundle(schemaVersion, buildBaseClaim())),
      true,
      `${schemaVersion}: ${JSON.stringify(validateBundle.errors)}`,
    );
  }
  assert.equal(validateBundle(buildBaseBundle(10, buildBaseClaim())), false);
});

test('inconclusive: a whitespace-only detail is rejected', () => {
  const validateEvidence = compileRoot('evidence.schema.json');
  // U+00A0 (no-break space) is whitespace under ECMAScript \s, which is what the schema pattern uses.
  for (const detail of [' ', '\t\n', '', '\u00a0', '\u00a0 \u00a0']) {
    for (const reason of ['other', 'timeout']) {
      const evidence = buildInconclusiveEvidence({ inconclusive: { reason, detail } });
      assert.equal(validateEvidence(evidence), false, JSON.stringify({ reason, detail }));
    }
  }
});

// Derivation is defined only for schema-valid bundles, and deriveStatuses does
// not validate. The CLI is the bundled caller, so it validates before deriving.
function writeInconclusiveBundle(evidenceOverrides) {
  const dir = mkdtempSync(join(tmpdir(), 'hachure-derive-'));
  const claim = {
    ...buildBaseClaim(),
    verificationPolicyId: 'policy.coverage',
  };
  const bundle = buildBaseBundle(9, claim);
  bundle.evidence = [buildInconclusiveEvidence(evidenceOverrides)];
  bundle.policies = [
    {
      id: 'policy.coverage',
      claimType: 'coverage',
      requiredEvidence: ['runtime_observation'],
      requiredMethods: ['monitoring'],
      requiresCorroboration: false,
      acceptanceCriteria: ['p95 observed'],
      reviewAuthority: 'operator',
      validityRule: { kind: 'historical' },
      stalenessTriggers: [],
      conflictRules: [],
      impactLevel: 'medium',
    },
  ];
  const path = join(dir, 'bundle.json');
  writeFileSync(path, JSON.stringify(bundle));
  return path;
}

test('hachure derive refuses a bundle whose inconclusive evidence is entailing, and derives the valid one', () => {
  const now = ['--now', '2026-10-01T00:00:00.000Z'];
  const invalid = writeInconclusiveBundle({ supportStrength: undefined });
  const refused = spawnSync(process.execPath, [CLI, 'derive', invalid, ...now], { encoding: 'utf8' });
  assert.equal(refused.status, 1, refused.stdout + refused.stderr);
  assert.match(refused.stderr, /hachure: refusing to derive from /);
  assert.match(refused.stderr, /\/evidence\/0 inconclusive evidence "ev-9" must have supportStrength "cited" \(found undefined\)/);
  assert.equal(refused.stdout, '', 'no statuses are printed for an invalid bundle');

  const valid = writeInconclusiveBundle({});
  const derived = spawnSync(process.execPath, [CLI, 'derive', valid, ...now], { encoding: 'utf8' });
  assert.equal(derived.status, 0, derived.stdout + derived.stderr);
  assert.deepEqual(JSON.parse(derived.stdout).statusByClaimId, { 'claim.facet-rename-test.1': 'unknown' });
});

test('hachure vectors honours --status-function-version and rejects stray arguments', () => {
  const v2 = spawnSync(process.execPath, [CLI, 'vectors', '--status-function-version', '2'], { encoding: 'utf8' });
  assert.equal(v2.status, 0, v2.stdout + v2.stderr);
  assert.match(v2.stdout, /SKIP sf-v3-no-policy/);
  assert.match(v2.stdout, /PASS sf-inconclusive-evidence/);
  assert.match(v2.stdout, /all 14 applicable vectors pass \(statusFunctionVersion "2"\)/);

  const unsupported = spawnSync(process.execPath, [CLI, 'vectors', '--status-function-version', '5'], { encoding: 'utf8' });
  assert.equal(unsupported.status, 1);
  assert.match(unsupported.stderr, /unsupported --status-function-version 5/);

  const v3 = spawnSync(process.execPath, [CLI, 'vectors', '--status-function-version', '3'], { encoding: 'utf8' });
  assert.equal(v3.status, 0, v3.stdout + v3.stderr);
  assert.match(v3.stdout, /SKIP sf-v4-authority-window/);
  assert.match(v3.stdout, /PASS sf-v3-no-policy/);
  assert.match(v3.stdout, /all 22 applicable vectors pass \(statusFunctionVersion "3"\)/);

  const stray = spawnSync(process.execPath, [CLI, 'vectors', '--verbose'], { encoding: 'utf8' });
  assert.equal(stray.status, 1);
  assert.match(stray.stderr, /unexpected: --verbose/);
});

test('hachure derive and vectors reject stray arguments and a flag with no value', () => {
  const valid = writeInconclusiveBundle({});
  const cases = [
    [['derive', valid, 'extra.json'], /unexpected: extra.json/],
    [['derive', valid, '--verbose'], /unexpected: --verbose/],
    [['derive', valid, '--now'], /--now requires a value/],
    [['derive', valid, '--now', ''], /invalid --now value: ""/],
    [['derive', '--now', valid], /invalid --now value: .*the file path after it was read as its value/],
    [['diff', valid, valid, '--now', ''], /invalid --now value: ""/],
    [['validate', valid, 'extra.json'], /unexpected: extra.json/],
    [['validate', valid, '--strict'], /unexpected: --strict/],
    [['merge', valid, valid, '--verbose'], /unexpected: --verbose/],
    [['derive', valid, '--status-function-version'], /--status-function-version requires a value/],
    [['vectors', '--status-function-version'], /--status-function-version requires a value/],
    [['diff', valid, valid, 'extra.json'], /unexpected: extra.json/],
  ];
  for (const [argv, pattern] of cases) {
    const r = spawnSync(process.execPath, [CLI, ...argv], { encoding: 'utf8' });
    assert.equal(r.status, 1, `${argv.join(' ')}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, pattern);
    assert.equal(r.stdout, '', argv.join(' '));
  }
});

test('hachure diff refuses an invalid bundle on either side', () => {
  const now = ['--now', '2026-10-01T00:00:00.000Z'];
  const valid = writeInconclusiveBundle({});
  const invalid = writeInconclusiveBundle({ supportStrength: undefined });
  for (const pair of [[invalid, valid], [valid, invalid]]) {
    const r = spawnSync(process.execPath, [CLI, 'diff', ...pair, ...now], { encoding: 'utf8' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /hachure: refusing to derive from /);
    assert.match(r.stderr, /inconclusive evidence "ev-9"/);
    assert.equal(r.stdout, '');
  }
  const same = spawnSync(process.execPath, [CLI, 'diff', valid, valid, ...now], { encoding: 'utf8' });
  assert.equal(same.status, 0, same.stdout + same.stderr);
});

// The package does not depend on ajv, so an installed consumer may not have
// it. Reproduce that: a copy of the package with no node_modules beside it.
function packageWithoutAjv() {
  const dir = mkdtempSync(join(tmpdir(), 'hachure-noajv-'));
  const root = join(__dirname, '..');
  for (const entry of ['bin', 'lib', 'schemas', 'conformance', 'index.mjs', 'package.json']) {
    cpSync(join(root, entry), join(dir, entry), { recursive: true });
  }
  return join(dir, 'bin', 'hachure.mjs');
}

// Schema-invalid (a policy field is missing) but the built-in invariants hold.
function writeSchemaInvalidBundle() {
  const path = writeInconclusiveBundle({});
  const bundle = JSON.parse(readFileSync(path, 'utf8'));
  delete bundle.policies[0].reviewAuthority;
  writeFileSync(path, JSON.stringify(bundle));
  return path;
}

const NOW_ARGS = ['--now', '2026-10-01T00:00:00.000Z'];
const AJV_WARNING = /warning: full schema validation was skipped because ajv could not be loaded/;

test('without ajv, hachure derive still runs the built-in check, derives, and warns once', () => {
  const cli = packageWithoutAjv();
  const valid = writeInconclusiveBundle({});

  // The copy really has no validator.
  const validate = spawnSync(process.execPath, [cli, 'validate', valid], { encoding: 'utf8' });
  assert.equal(validate.status, 1);
  assert.match(validate.stderr, /validate requires ajv/);

  const derived = spawnSync(process.execPath, [cli, 'derive', valid, ...NOW_ARGS], { encoding: 'utf8' });
  assert.equal(derived.status, 0, derived.stdout + derived.stderr);
  assert.match(derived.stderr, AJV_WARNING);
  assert.match(derived.stderr, /same node_modules as hachure/);
  assert.deepEqual(JSON.parse(derived.stdout).statusByClaimId, { 'claim.facet-rename-test.1': 'unknown' });

  // Full validation is what is skipped: a schema-invalid bundle that keeps the invariants derives.
  const schemaInvalid = spawnSync(process.execPath, [cli, 'derive', writeSchemaInvalidBundle(), ...NOW_ARGS], { encoding: 'utf8' });
  assert.equal(schemaInvalid.status, 0, schemaInvalid.stdout + schemaInvalid.stderr);
  assert.match(schemaInvalid.stderr, AJV_WARNING);

  const diffed = spawnSync(process.execPath, [cli, 'diff', valid, valid, ...NOW_ARGS], { encoding: 'utf8' });
  assert.equal(diffed.status, 0, diffed.stdout + diffed.stderr);
  assert.equal(diffed.stderr.match(new RegExp(AJV_WARNING, 'g')).length, 1, 'one warning for both bundles');
});

test('without ajv, the built-in check still refuses each invariant violation', () => {
  const cli = packageWithoutAjv();
  const valid = writeInconclusiveBundle({});
  const lowVersion = writeInconclusiveBundle({});
  writeFileSync(lowVersion, JSON.stringify({ ...JSON.parse(readFileSync(lowVersion, 'utf8')), schemaVersion: 8 }));
  const cases = [
    [writeInconclusiveBundle({ supportStrength: undefined }), /inconclusive evidence "ev-9" must have supportStrength "cited"/],
    [writeInconclusiveBundle({ supportStrength: 'entails' }), /must have supportStrength "cited" \(found "entails"\)/],
    [writeInconclusiveBundle({ passing: false }), /inconclusive evidence "ev-9" must not carry passing/],
    [lowVersion, /evidence "ev-9" carries inconclusive, which requires schemaVersion 9 or later \(declared 8\)/],
  ];
  for (const [path, pattern] of cases) {
    const r = spawnSync(process.execPath, [cli, 'derive', path, ...NOW_ARGS], { encoding: 'utf8' });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /hachure: refusing to derive from /);
    assert.match(r.stderr, pattern);
    assert.equal(r.stdout, '', 'no statuses are printed');
    for (const pair of [[path, valid], [valid, path]]) {
      const d = spawnSync(process.execPath, [cli, 'diff', ...pair, ...NOW_ARGS], { encoding: 'utf8' });
      assert.equal(d.status, 1, d.stdout + d.stderr);
      assert.match(d.stderr, pattern);
    }
  }
});

test('with ajv, hachure derive also refuses a schema-invalid bundle that keeps the invariants', () => {
  const path = writeSchemaInvalidBundle();
  assert.deepEqual(checkBasisInvariants(JSON.parse(readFileSync(path, 'utf8'))), []);
  const r = spawnSync(process.execPath, [CLI, 'derive', path, ...NOW_ARGS], { encoding: 'utf8' });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, /invalid TrustBundle/);
  assert.match(r.stderr, /must have required property 'reviewAuthority'/);
  assert.doesNotMatch(r.stderr, AJV_WARNING);
  assert.equal(r.stdout, '');
});

test('checkBasisInvariants agrees with the schema on every inconclusive / version fixture', () => {
  const validateBundle = compileRoot('trust-bundle.schema.json');
  const plain = withoutKey(buildInconclusiveEvidence(), 'inconclusive');
  const fixtures = [
    [9, buildInconclusiveEvidence(), true],
    [9, { ...plain, collectedByKind: 'model' }, true],
    [9, plain, true],
    [8, plain, true],
    [9, buildInconclusiveEvidence({ passing: true }), false],
    [9, buildInconclusiveEvidence({ passing: false }), false],
    [9, buildInconclusiveEvidence({ supportStrength: 'entails' }), false],
    [9, withoutKey(buildInconclusiveEvidence(), 'supportStrength'), false],
    [8, buildInconclusiveEvidence(), false],
    [5, { ...plain, collectedByKind: 'model' }, false],
  ];
  for (const [schemaVersion, evidence, ok] of fixtures) {
    const bundle = buildBaseBundle(schemaVersion, buildBaseClaim());
    bundle.evidence = [evidence];
    const label = JSON.stringify({ schemaVersion, evidence });
    assert.equal(validateBundle(bundle), ok, `schema: ${label}`);
    const errors = checkBasisInvariants(bundle);
    assert.equal(errors.length === 0, ok, `built-in: ${label} ${JSON.stringify(errors)}`);
    for (const e of errors) {
      assert.equal(e.instancePath, '/evidence/0');
      assert.match(e.message, /evidence "ev-9"/);
    }
  }
});

test('checkBasisInvariants reports malformed input instead of throwing', () => {
  assert.deepEqual(checkBasisInvariants(null).map((e) => e.message), ['bundle must be an object']);
  assert.deepEqual(checkBasisInvariants([]).map((e) => e.message), ['bundle must be an object']);
  assert.deepEqual(checkBasisInvariants({ evidence: 'x' }).map((e) => e.message), ['evidence must be an array']);
  assert.deepEqual(checkBasisInvariants({ evidence: [null] }).map((e) => e.instancePath), ['/evidence/0']);
  assert.deepEqual(checkBasisInvariants({}), []);
});

test('--no-validate on a structurally malformed bundle exits 1 with a hachure: message, never a stack', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hachure-malformed-'));
  const valid = writeInconclusiveBundle({});
  const base = JSON.parse(readFileSync(valid, 'utf8'));
  const shapes = [
    ['null', null, /expected a JSON object/],
    ['array', [], /expected a JSON object/],
    ['claims-string', { claims: 'x' }, /claims must be an array/],
    ['claims-null-entry', { claims: [null] }, /claims\[0\] must be an object/],
    ['claim-no-id', { ...base, claims: [withoutKey(base.claims[0], 'id')] }, /claims\[0\] has no id/],
    ['evidence-null-entry', { ...base, evidence: [null] }, /could not derive: /],
    ['evidence-string', { ...base, evidence: 'x' }, /could not derive: /],
  ];
  for (const [name, bundle, pattern] of shapes) {
    const path = join(dir, `${name}.json`);
    writeFileSync(path, JSON.stringify(bundle));
    for (const argv of [['derive', path], ['diff', valid, path]]) {
      const r = spawnSync(process.execPath, [CLI, ...argv, ...NOW_ARGS, '--no-validate'], { encoding: 'utf8' });
      assert.equal(r.status, 1, `${name}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, pattern, name);
      assert.match(r.stderr, /^hachure: (?!warning)/m, name);
      assert.doesNotMatch(r.stderr, /TypeError|\n\s+at /, name);
      assert.equal(r.stdout, '', name);
    }
  }
});

test('--no-validate skips validation even when ajv is installed, and warns', () => {
  const invalid = writeInconclusiveBundle({ supportStrength: undefined });
  const r = spawnSync(process.execPath, [CLI, 'derive', invalid, '--now', '2026-10-01T00:00:00.000Z', '--no-validate'], {
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stderr, /warning: --no-validate/);
  // The unreliable result the warning is about: the attempt counts as evidence.
  assert.deepEqual(JSON.parse(r.stdout).statusByClaimId, { 'claim.facet-rename-test.1': 'proposed' });
});
