#!/usr/bin/env node
/**
 * Self-attestation: emit a TrustBundle (and derived TrustReport) in which the
 * spec package attests its own state, using only this package — no external
 * implementation involved.
 *
 * Claims:
 *   - the test suite passes (evidence: `node --test` run output)
 *   - the bundled implementation derives every conformance vector correctly
 *   - the statusFunctionVersion this package declares
 *   - package content identity (evidence: `npm pack --dry-run` integrity)
 *
 * The integrity anchor is the npm tarball's sha512 integrity string, so the
 * attestation is about exact package content, independent of git state or
 * whether this version has been published yet.
 *
 * Usage: node scripts/self-trust-bundle.mjs [--out <dir>]
 * Writes <dir>/latest-bundle.json (pure TrustBundle) and <dir>/latest.json
 * (report: bundle + derived per-claim status), default dir dist/trust.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { deriveStatuses, testVectors, statusFunctionVersion, schemas } from '../index.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outIdx = process.argv.indexOf('--out');
const outDir = outIdx !== -1 ? process.argv[outIdx + 1] : join(root, 'dist', 'trust');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const subjectId = `${pkg.name}@${pkg.version}`;
const now = new Date().toISOString();

// --- Gather evidence ---------------------------------------------------------

function run(cmd, args) {
  try {
    return { ok: true, output: execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    return { ok: false, output: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

console.error('running test suite (npm test)...');
const tests = run('npm', ['test']);
const testSummary = (tests.output.match(/(?:tests|pass|fail) \d+/g) ?? [])
  .slice(0, 3)
  .join(', ') || tests.output.slice(-300).trim();

console.error('running conformance vectors against the bundled implementation...');
const vectorResults = testVectors.map(({ name, vector }) => {
  const derived = deriveStatuses(vector.input, new Date(vector.now));
  const pass = Object.entries(vector.expect.statusByClaimId).every(
    ([claimId, expected]) => derived[claimId] === expected
  );
  return { name, pass };
});
const vectorsPass = vectorResults.every((v) => v.pass);

console.error('computing package integrity (npm pack --dry-run)...');
const pack = run('npm', ['pack', '--dry-run', '--json']);
let integrity = 'unavailable';
try {
  integrity = JSON.parse(pack.output)[0].integrity;
} catch {
  /* leave 'unavailable' — the claim below will carry it honestly */
}
const integrityRef = `npm-pack:${integrity}`;

// --- Build the bundle ---------------------------------------------------------

const schemaVersion = Math.max(...schemas.get('trust-bundle').properties.schemaVersion.enum);

function claim(id, fieldOrBehavior, value, policyId) {
  return {
    id,
    subjectType: 'npm-package',
    subjectId,
    facet: 'hachure-spec.self',
    claimType: 'release-quality',
    fieldOrBehavior,
    value,
    createdAt: now,
    updatedAt: now,
    impactLevel: 'high',
    verificationPolicyId: policyId,
    currentIntegrityRef: integrityRef,
  };
}

function evidence(id, claimId, evidenceType, method, excerptOrSummary, passing) {
  return {
    id,
    claimId,
    evidenceType,
    method,
    sourceRef: 'scripts/self-trust-bundle.mjs',
    excerptOrSummary,
    observedAt: now,
    collectedBy: 'hachure-spec.self-attestation',
    integrityRef,
    passing,
    blocking: true,
    supportStrength: 'entails',
  };
}

function policy(id, requiredEvidence, requiredMethods, criteria) {
  return {
    id,
    claimType: 'release-quality',
    requiredEvidence,
    requiredMethods,
    requiresCorroboration: false,
    acceptanceCriteria: [criteria],
    reviewAuthority: 'repo policy',
    validityRule: { kind: 'commit' },
    stalenessTriggers: ['package content changes'],
    conflictRules: [],
    impactLevel: 'high',
  };
}

function event(id, claimId, evidenceIds) {
  return {
    id,
    claimId,
    status: 'verified',
    actor: 'ci',
    method: 'automated-validation',
    evidenceIds,
    createdAt: now,
    verifiedAt: now,
  };
}

const bundle = {
  schemaVersion,
  source: 'hachure-spec-self-attestation',
  producerId: 'hachure-spec',
  claims: [
    claim('hachure-spec.release.test-suite-passes', 'test-suite-passes', tests.ok, 'hachure-spec.policy.test'),
    claim('hachure-spec.release.conformance-self-derivation', 'bundled-implementation-derives-all-vectors', vectorsPass, 'hachure-spec.policy.conformance'),
    claim('hachure-spec.release.status-function-version', 'statusFunctionVersion', statusFunctionVersion, 'hachure-spec.policy.identity'),
    claim('hachure-spec.release.package-identity', 'package-integrity', integrity, 'hachure-spec.policy.identity'),
  ],
  evidence: [
    evidence('hachure-spec.evidence.test-output', 'hachure-spec.release.test-suite-passes', 'test_output', 'validation', `node --test: ${testSummary}`, tests.ok),
    evidence(
      'hachure-spec.evidence.vector-results',
      'hachure-spec.release.conformance-self-derivation',
      'test_output',
      'validation',
      vectorResults.map((v) => `${v.name}: ${v.pass ? 'pass' : 'FAIL'}`).join('; '),
      vectorsPass
    ),
    evidence('hachure-spec.evidence.sfv', 'hachure-spec.release.status-function-version', 'source_excerpt', 'extraction', `index.mjs exports statusFunctionVersion = "${statusFunctionVersion}"`, true),
    evidence('hachure-spec.evidence.pack-integrity', 'hachure-spec.release.package-identity', 'calculation_trace', 'anchoring', `npm pack --dry-run integrity: ${integrity}`, integrity !== 'unavailable'),
  ],
  policies: [
    policy('hachure-spec.policy.test', ['test_output'], ['validation'], 'test suite passes for the packed content'),
    policy('hachure-spec.policy.conformance', ['test_output'], ['validation'], 'every conformance vector derives its expected statuses'),
    policy('hachure-spec.policy.identity', [], [], 'declared constants match packed content'),
  ],
  events: [
    event('hachure-spec.event.test', 'hachure-spec.release.test-suite-passes', ['hachure-spec.evidence.test-output']),
    event('hachure-spec.event.conformance', 'hachure-spec.release.conformance-self-derivation', ['hachure-spec.evidence.vector-results']),
    event('hachure-spec.event.sfv', 'hachure-spec.release.status-function-version', ['hachure-spec.evidence.sfv']),
    event('hachure-spec.event.identity', 'hachure-spec.release.package-identity', ['hachure-spec.evidence.pack-integrity']),
  ],
};

// --- Validate against our own schema (requires ajv, a devDependency) ---------

try {
  const { default: Ajv2020 } = await import('ajv/dist/2020.js');
  const ajv = new Ajv2020({ strict: false, allErrors: true, logger: false });
  for (const schema of schemas.values()) ajv.addSchema(schema);
  const validate = ajv.getSchema(schemas.get('trust-bundle').$id);
  if (!validate(bundle)) {
    console.error('self-attestation bundle failed schema validation:', validate.errors);
    process.exit(1);
  }
} catch (err) {
  if (err.code === 'ERR_MODULE_NOT_FOUND') {
    console.error('warning: ajv not installed; skipping schema validation');
  } else {
    throw err;
  }
}

// --- Derive and emit ----------------------------------------------------------

const statusByClaimId = deriveStatuses(bundle, new Date(now));
const report = {
  ...bundle,
  id: `hachure-spec-${Date.now()}`,
  generatedAt: now,
  statusFunctionVersion,
  claims: bundle.claims.map((c) => ({ ...c, status: statusByClaimId[c.id] })),
  summary: {
    byStatus: Object.values(statusByClaimId).reduce((acc, s) => ({ ...acc, [s]: (acc[s] ?? 0) + 1 }), {}),
  },
};

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'latest-bundle.json'), JSON.stringify(bundle, null, 2) + '\n');
writeFileSync(join(outDir, 'latest.json'), JSON.stringify(report, null, 2) + '\n');

console.error(`wrote ${join(outDir, 'latest-bundle.json')} and latest.json`);
console.error(`statuses: ${JSON.stringify(statusByClaimId)}`);
if (!tests.ok || !vectorsPass) {
  console.error('NOTE: attested state includes failures — the bundle records them honestly.');
  process.exit(2);
}
