/**
 * Ajv 2020-12 structural validation for every schema in schemas/, plus
 * positive/negative fixtures proving the schema-correctness fixes have teeth.
 * Run with: node --test test/
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
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
// AC4 — evidenceType/requiredEvidence enum alignment
// ---------------------------------------------------------------------------
test('AC4: requiredEvidence/evidenceType enums are identical 8-value lists across files', () => {
  const policyEnum = schemaFiles['verification-policy.schema.json'].properties.requiredEvidence.items.enum;
  const evidenceEnum = schemaFiles['evidence.schema.json'].properties.evidenceType.enum;
  const bundleEnum =
    schemaFiles['trust-bundle.schema.json'].$defs.validationStrategy.properties.requiredEvidence.items.enum;

  assert.deepEqual([...policyEnum].sort(), [...evidenceEnum].sort());
  assert.deepEqual([...policyEnum].sort(), [...bundleEnum].sort());
  assert.equal(policyEnum.length, 8);
  assert.ok(policyEnum.includes('attestation'));
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
