/**
 * statusFunctionVersion "3" rules that the conformance vectors cannot carry
 * because they need inputs a schema-valid bundle would not contain
 * (unparseable timestamps, a negative window), plus the version-selection
 * rejection path and the status ordering.
 * Run with: node --test test/derive.v3.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  deriveStatuses,
  deriveClaimStatus,
  resolvePolicy,
  statusOrder,
  weakerStatus,
  testVectors,
} from '../index.mjs';

const NOW = new Date('2026-06-10T00:00:00.000Z');
const T0 = '2026-06-01T00:00:00.000Z';

function bundle({ claim = {}, validityRule = { kind: 'historical' }, event = {} } = {}) {
  return {
    schemaVersion: 7,
    source: 'test',
    claims: [
      {
        id: 'c',
        subjectType: 'api',
        subjectId: 'x',
        claimType: 't',
        fieldOrBehavior: 'f',
        value: true,
        createdAt: T0,
        updatedAt: T0,
        verificationPolicyId: 'p',
        ...claim,
      },
    ],
    evidence: [
      {
        id: 'e',
        claimId: 'c',
        evidenceType: 'test_output',
        passing: true,
        method: 'validation',
        sourceRef: 'ci',
        excerptOrSummary: 'ok',
        observedAt: T0,
        collectedBy: 'ci',
      },
    ],
    policies: [
      {
        id: 'p',
        claimType: 't',
        requiredEvidence: ['test_output'],
        acceptanceCriteria: [],
        reviewAuthority: 'ci',
        validityRule,
        stalenessTriggers: [],
        conflictRules: [],
        impactLevel: 'low',
      },
    ],
    events: [
      {
        id: 'v',
        claimId: 'c',
        status: 'verified',
        actor: 'ci',
        method: 'test',
        evidenceIds: ['e'],
        createdAt: T0,
        ...event,
      },
    ],
  };
}

const both = (b) => ({
  v2: deriveStatuses(b, NOW, { statusFunctionVersion: '2' }).c,
  v3: deriveStatuses(b, NOW).c,
});

test('baseline fixture derives verified under both versions', () => {
  assert.deepEqual(both(bundle()), { v2: 'verified', v3: 'verified' });
});

test('v3: an unparseable claim expiresAt is stale (v2 treated it as never expiring)', () => {
  assert.deepEqual(both(bundle({ claim: { expiresAt: 'not-a-date' } })), { v2: 'verified', v3: 'stale' });
});

test('v3: ttlSeconds against an unparseable verification time is stale', () => {
  const b = bundle({ claim: { ttlSeconds: 3600 }, event: { createdAt: 'not-a-date' } });
  assert.deepEqual(both(b), { v2: 'verified', v3: 'stale' });
});

test('v3: a duration rule against an unparseable verification time is stale', () => {
  const b = bundle({ validityRule: { kind: 'duration', durationDays: 30 }, event: { createdAt: 'not-a-date' } });
  assert.deepEqual(both(b), { v2: 'verified', v3: 'stale' });
});

// Negative windows end before they start, so at a `now` after verification
// they read as stale even without the guard. Evaluating at a `now` before the
// verification time is the case where only the guard yields `stale`.
const BEFORE_VERIFICATION = new Date('2026-05-29T00:00:00.000Z');

test('v3: a negative durationDays is unevaluable, so stale', () => {
  const b = bundle({ validityRule: { kind: 'duration', durationDays: -1 } });
  assert.equal(deriveStatuses(b, BEFORE_VERIFICATION).c, 'stale');
  assert.equal(deriveStatuses(b, BEFORE_VERIFICATION, { statusFunctionVersion: '2' }).c, 'verified');
});

test('v3: a non-finite durationDays is unevaluable, so stale', () => {
  const b = bundle({ validityRule: { kind: 'duration', durationDays: 'forever' } });
  assert.deepEqual(both(b), { v2: 'verified', v3: 'stale' });
});

test('v3: a non-finite ttlSeconds is unevaluable, so stale', () => {
  const b = bundle({ claim: { ttlSeconds: 'forever' } });
  assert.deepEqual(both(b), { v2: 'verified', v3: 'stale' });
});

test('v3: a negative ttlSeconds is unevaluable, so stale', () => {
  const b = bundle({ claim: { ttlSeconds: -3600 } });
  assert.equal(deriveStatuses(b, BEFORE_VERIFICATION).c, 'stale');
  assert.equal(deriveStatuses(b, BEFORE_VERIFICATION, { statusFunctionVersion: '2' }).c, 'verified');
});

test('v3: an invalid now is refused; v2 keeps its old behaviour', () => {
  const b = bundle({ validityRule: { kind: 'duration', durationDays: 1 } });
  for (const now of [new Date('nope'), 'nope']) {
    assert.throws(() => deriveStatuses(b, now), RangeError);
    assert.throws(() => deriveClaimStatus(b.claims[0], b, now), RangeError);
  }
  // An empty bundle is refused too: the check does not depend on a claim reaching Step 4.
  assert.throws(() => deriveStatuses({ ...b, claims: [] }, new Date('nope')), RangeError);
  assert.equal(deriveStatuses(b, new Date('nope'), { statusFunctionVersion: '2' }).c, 'verified');
});

test('v3: a validity rule with no kind is stale', () => {
  assert.deepEqual(both(bundle({ validityRule: {} })), { v2: 'verified', v3: 'stale' });
});

test('v3: resolvePolicy does not fall back to claimType when verificationPolicyId dangles', () => {
  const claim = { id: 'c', claimType: 't', verificationPolicyId: 'missing' };
  const policies = [{ id: 'p', claimType: 't' }];
  assert.equal(resolvePolicy(claim, policies, { statusFunctionVersion: '2' })?.id, 'p');
  assert.equal(resolvePolicy(claim, policies), undefined);
});

test('v3: deriveClaimStatus reports the resolved policy id even when it requires nothing', () => {
  const b = bundle();
  b.policies[0].requiredEvidence = [];
  const result = deriveClaimStatus(b.claims[0], b, NOW);
  assert.deepEqual(result, { status: 'proposed', policyId: 'p' });
});

test('v3: derivation cycles terminate and still apply the ceiling', () => {
  const b = bundle({ claim: { derivedFrom: ['d'] } });
  b.claims.push({ ...b.claims[0], id: 'd', derivedFrom: ['c'] });
  const derived = deriveStatuses(b, NOW);
  // d has no event and no own evidence, so its own status is unknown; c is capped by it.
  assert.deepEqual(derived, { c: 'unknown', d: 'unknown' });
});

test('status ordering is the literal v3 order, weakest first', () => {
  assert.deepEqual(
    [...statusOrder],
    ['revoked', 'rejected', 'disputed', 'superseded', 'stale', 'unknown', 'assumed', 'proposed', 'verified']
  );
  assert.equal(weakerStatus('unknown', 'rejected'), 'rejected');
  assert.equal(weakerStatus('superseded', 'disputed'), 'disputed');
  assert.equal(weakerStatus('stale', 'unknown'), 'stale');
  assert.equal(weakerStatus('proposed', 'assumed'), 'assumed');
  assert.equal(weakerStatus('verified', 'not-a-status'), 'not-a-status');
});

test('an unsupported statusFunctionVersion is refused, not silently defaulted', () => {
  const b = bundle();
  for (const version of ['1', '4', 3, '']) {
    assert.throws(() => deriveStatuses(b, NOW, { statusFunctionVersion: version }), RangeError);
    assert.throws(() => deriveClaimStatus(b.claims[0], b, NOW, { statusFunctionVersion: version }), RangeError);
  }
});

// --- CLI ---------------------------------------------------------------------

const cli = fileURLToPath(new URL('../bin/hachure.mjs', import.meta.url));

test('CLI derive defaults to v3 and honours --status-function-version 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hachure-v3-'));
  const path = join(dir, 'bundle.json');
  // A schema-valid bundle that derives differently under the two versions
  // (commit rule, no currentIntegrityRef). `hachure derive` validates first,
  // so a schema-invalid shape such as `validityRule: {}` is refused instead.
  writeFileSync(path, JSON.stringify(bundle({ validityRule: { kind: 'commit' } })));
  const run = (...extra) =>
    JSON.parse(execFileSync(process.execPath, [cli, 'derive', path, '--now', NOW.toISOString(), ...extra], { encoding: 'utf8' }));
  assert.deepEqual(run().statusByClaimId, { c: 'stale' });
  assert.equal(run().statusFunctionVersion, '3');
  const v2 = run('--status-function-version', '2');
  assert.deepEqual(v2.statusByClaimId, { c: 'verified' });
  assert.equal(v2.statusFunctionVersion, '2');
});

test('CLI derive rejects an unsupported --status-function-version with exit 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hachure-v3-'));
  const path = join(dir, 'bundle.json');
  writeFileSync(path, JSON.stringify(bundle()));
  const r = spawnSync(process.execPath, [cli, 'derive', path, '--status-function-version', '4'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unsupported --status-function-version 4/);
});

test('CLI vectors runs every applicable vector and exits 0', () => {
  const r = spawnSync(process.execPath, [cli, 'vectors'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const applicable = testVectors.filter(
    ({ vector }) => !vector.statusFunctionVersions || vector.statusFunctionVersions.includes('3')
  ).length;
  assert.match(r.stdout, new RegExp(`all ${applicable} applicable vectors pass`));
});

// --- Step 1 authority window: unevaluable bounds (issue #30) -----------------
// A resolution to verified followed by a later disputed event: `verified` when
// the resolver's trace is active, `disputed` when it is not.
function resolutionBundle(traceBounds, resolvedAt = '2026-06-02T00:00:00.000Z') {
  const b = bundle();
  b.events = [
    { ...b.events[0], id: 'resolution', actor: 'reviewer', resolvesDispute: true, createdAt: resolvedAt, verifiedAt: undefined },
    { ...b.events[0], id: 'later', status: 'disputed', createdAt: '2026-06-03T00:00:00.000Z', verifiedAt: undefined },
  ];
  b.authorityTrace = [
    {
      id: 't',
      subject: { subjectType: 'api', subjectId: 'x' },
      actorRef: 'reviewer',
      authorityType: 'role',
      authorityRef: 'r',
      sourceRef: 's',
      observedAt: T0,
      ...traceBounds,
    },
  ];
  return b;
}

test('authority window: a parseable window is honoured under both versions', () => {
  assert.deepEqual(both(resolutionBundle({})), { v2: 'verified', v3: 'verified' });
  assert.deepEqual(both(resolutionBundle({ validFrom: T0, validUntil: '2027-01-01T00:00:00Z' })), { v2: 'verified', v3: 'verified' });
  assert.deepEqual(both(resolutionBundle({ revokedAt: T0 })), { v2: 'disputed', v3: 'disputed' });
});

test('v3: an unparseable authority bound makes the trace inactive (v2 as shipped kept it active)', () => {
  for (const bound of ['revokedAt', 'validFrom', 'validUntil']) {
    for (const value of ['not-a-timestamp', '', '2026-13-45T00:00:00Z']) {
      assert.deepEqual(both(resolutionBundle({ [bound]: value })), { v2: 'verified', v3: 'disputed' }, `${bound}=${value}`);
    }
  }
});

test('v3: a bounded trace is not active for a resolution event whose createdAt is unparseable', () => {
  assert.deepEqual(both(resolutionBundle({ validUntil: '2027-01-01T00:00:00Z' }, 'not-a-timestamp')), { v2: 'verified', v3: 'disputed' });
  // An unbounded trace needs no time comparison, so the resolution stands.
  assert.deepEqual(both(resolutionBundle({}, 'not-a-timestamp')), { v2: 'verified', v3: 'verified' });
});

test('v3: one evaluable active trace is enough when another for the same actor is unevaluable', () => {
  const b = resolutionBundle({ revokedAt: 'not-a-timestamp' });
  b.authorityTrace.push({ ...b.authorityTrace[0], id: 't2', revokedAt: undefined });
  assert.equal(deriveStatuses(b, NOW).c, 'verified');
});

// The schemas reject these two shapes, so no conformance vector can carry
// them; the fold still defines them (status-function.md Step 4a).
test('v3: a missing or unknown validity-rule kind is stale (v2 treated it as never stale)', () => {
  for (const validityRule of [{}, { kind: 'weekly' }, { kind: null }]) {
    assert.deepEqual(both(bundle({ validityRule })), { v2: 'verified', v3: 'stale' }, JSON.stringify(validityRule));
  }
});
