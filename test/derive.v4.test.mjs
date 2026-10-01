/**
 * Status function version "4": what a timestamp is, and times that cannot be
 * evaluated in Step 1 (status-function.md §"Timestamps", §"Version 3").
 * Each rule is checked against version "3", which must keep its published
 * behaviour. Run with: node --test test/derive.v4.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveStatuses, parseTimestamp, statusFunctionVersion } from '../index.mjs';

const NOW = new Date('2026-06-10T00:00:00.000Z');
const T0 = '2026-06-01T00:00:00.000Z';
const BAD = 'not-a-timestamp';

test('the default version is 4', () => {
  assert.equal(statusFunctionVersion, '4');
});

// --- parseTimestamp -----------------------------------------------------------

test('parseTimestamp reads RFC 3339 date-times as instants', () => {
  const base = Date.UTC(2026, 4, 2, 0, 0, 0);
  for (const same of [
    '2026-05-02T00:00:00Z',
    '2026-05-02T00:00:00.000Z',
    '2026-05-02T00:00:00.000000000Z',
    '2026-05-02t00:00:00z',
    '2026-05-02T02:00:00+02:00',
    '2026-05-01T19:30:00-04:30',
    '2026-05-02T00:00:00+00:00',
    '2026-05-02T00:00:00-00:00',
  ]) {
    assert.equal(parseTimestamp(same), base, same);
  }
  assert.equal(parseTimestamp('2026-05-02T00:00:00.5Z'), base + 500);
  assert.equal(parseTimestamp('2026-05-02T00:00:00.123456Z'), base + 123.456);
  assert.equal(parseTimestamp('2024-02-29T00:00:00Z'), Date.UTC(2024, 1, 29));
  assert.equal(parseTimestamp('2000-02-29T00:00:00Z'), Date.UTC(2000, 1, 29));
  // Years 0000-0099 are themselves, not 1900-1999.
  assert.equal(new Date(parseTimestamp('0050-01-01T00:00:00Z')).getUTCFullYear(), 50);
});

test('parseTimestamp reads a leap second only at 23:59:60 UTC, as the following instant', () => {
  const next = Date.UTC(2027, 0, 1, 0, 0, 0);
  assert.equal(parseTimestamp('2026-12-31T23:59:60Z'), next);
  assert.equal(parseTimestamp('2027-01-01T01:59:60+02:00'), next);
  assert.equal(parseTimestamp('2026-12-31T18:59:60-05:00'), next);
  assert.equal(parseTimestamp('2026-12-31T23:59:60.25Z'), next + 250);
  for (const misplaced of ['2026-12-31T12:00:60Z', '2026-12-31T23:59:60+02:00', '2026-12-31T23:58:60Z']) {
    assert.equal(parseTimestamp(misplaced), undefined, misplaced);
  }
});

test('parseTimestamp rejects everything that is not an RFC 3339 date-time', () => {
  for (const value of [
    '2027-04-01',
    '2027-04-01T00:00:00',
    '2027-04-01T00:00Z',
    '2027-04-01T24:00:00Z',
    '2027-04-01T00:60:00Z',
    '2027-04-01T00:00:61Z',
    '2027-02-30T00:00:00Z',
    '2027-02-29T00:00:00Z',
    '1900-02-29T00:00:00Z',
    '2027-13-01T00:00:00Z',
    '2027-00-10T00:00:00Z',
    '2027-04-00T00:00:00Z',
    '2027-04-31T00:00:00Z',
    '2027-04-01 00:00:00Z',
    '2027-04-01T00:00:00+0000',
    '2027-04-01T00:00:00+24:00',
    '2027-04-01T00:00:00+00:60',
    '2027-04-01T00:00:00.Z',
    '27-04-01T00:00:00Z',
    ' 2027-04-01T00:00:00Z',
    '2027-04-01T00:00:00Z ',
    'April 1, 2027',
    BAD,
    '',
    0,
    1798761600000,
    null,
    undefined,
    true,
    {},
    new Date(0),
  ]) {
    assert.equal(parseTimestamp(value), undefined, String(JSON.stringify(value)));
  }
});

// --- Step 1 ---------------------------------------------------------------------
// A resolution to `verified` at 06-02, then a `disputed` event at 06-03:
// `verified` when the resolution is honoured, `disputed` when it is not.

function resolutionBundle({ bounds = {}, resolvedAt = '2026-06-02T00:00:00.000Z', resolutionStatus = 'verified', laterStatus = 'disputed', later = true, traces, evidence = [] } = {}) {
  const trace = (id, extra) => ({
    id,
    subject: { subjectType: 'api', subjectId: 'x' },
    actorRef: 'reviewer',
    authorityType: 'role',
    authorityRef: 'r',
    sourceRef: 's',
    observedAt: T0,
    ...extra,
  });
  const event = (id, status, createdAt, extra) => ({ id, claimId: 'c', status, actor: 'ci', method: 'm', evidenceIds: ['e'], createdAt, ...extra });
  return {
    schemaVersion: 7,
    source: 'test',
    claims: [{ id: 'c', subjectType: 'api', subjectId: 'x', claimType: 't', fieldOrBehavior: 'f', value: true, createdAt: T0, updatedAt: T0, verificationPolicyId: 'p' }],
    evidence: [
      { id: 'e', claimId: 'c', evidenceType: 'source_excerpt', method: 'observation', sourceRef: 's', excerptOrSummary: 'ok', observedAt: T0, collectedBy: 'ci' },
      ...evidence.map((e, i) => ({ id: `f${i}`, claimId: 'c', evidenceType: 'source_excerpt', method: 'observation', sourceRef: 's', excerptOrSummary: 'no', collectedBy: 'ci', passing: false, ...e })),
    ],
    policies: [
      {
        id: 'p', claimType: 't', requiredEvidence: ['source_excerpt'], requiredMethods: ['observation'], requiresCorroboration: false,
        acceptanceCriteria: ['a'], reviewAuthority: 'r', validityRule: { kind: 'historical' }, stalenessTriggers: [], conflictRules: [], impactLevel: 'high',
      },
    ],
    events: [
      event('resolution', resolutionStatus, resolvedAt, { actor: 'reviewer', resolvesDispute: true }),
      ...(later ? [event('later', laterStatus, '2026-06-03T00:00:00.000Z')] : []),
    ],
    authorityTrace: (traces ?? [bounds]).map((t, i) => trace(`t${i}`, t)),
  };
}

const v34 = (b) => ({
  v3: deriveStatuses(b, NOW, { statusFunctionVersion: '3' }).c,
  v4: deriveStatuses(b, NOW, { statusFunctionVersion: '4' }).c,
});

test('a window that can be evaluated is honoured the same way under 3 and 4', () => {
  assert.deepEqual(v34(resolutionBundle()), { v3: 'verified', v4: 'verified' });
  assert.deepEqual(v34(resolutionBundle({ bounds: { validFrom: T0, validUntil: '2027-01-01T00:00:00Z' } })), { v3: 'verified', v4: 'verified' });
  assert.deepEqual(v34(resolutionBundle({ bounds: { revokedAt: T0 } })), { v3: 'disputed', v4: 'disputed' });
});

test('v4: a bound that is present but is not a timestamp makes the trace inactive (v3 kept it active)', () => {
  for (const bound of ['revokedAt', 'validFrom', 'validUntil']) {
    for (const value of [BAD, '']) {
      assert.deepEqual(v34(resolutionBundle({ bounds: { [bound]: value } })), { v3: 'verified', v4: 'disputed' }, `${bound}=${JSON.stringify(value)}`);
    }
    // Values Date.parse reads but RFC 3339 does not: unevaluable under 4, whatever 3 made of them.
    for (const value of ['2027-01-01', '2026-01-01', 0, '2026-01-01T00:00:00']) {
      const b = resolutionBundle({ bounds: { [bound]: value } });
      assert.equal(deriveStatuses(b, NOW, { statusFunctionVersion: '4' }).c, 'disputed', `${bound}=${JSON.stringify(value)}`);
    }
  }
  // Version 3 read a date-only bound as a time: a future revokedAt left the trace active, a past one did not.
  assert.equal(deriveStatuses(resolutionBundle({ bounds: { revokedAt: '2027-01-01' } }), NOW, { statusFunctionVersion: '3' }).c, 'verified');
  assert.equal(deriveStatuses(resolutionBundle({ bounds: { revokedAt: '2026-01-01' } }), NOW, { statusFunctionVersion: '3' }).c, 'disputed');
});

test('v4: a resolution event whose createdAt is not a timestamp is not a resolution, bounded trace or not', () => {
  assert.deepEqual(v34(resolutionBundle({ resolvedAt: BAD })), { v3: 'verified', v4: 'disputed' });
  assert.deepEqual(v34(resolutionBundle({ resolvedAt: BAD, bounds: { validUntil: '2027-01-01T00:00:00Z' } })), { v3: 'verified', v4: 'disputed' });
  // It is still an event: alone, it is the latest event and its status is read by the later steps.
  assert.deepEqual(v34(resolutionBundle({ resolvedAt: BAD, resolutionStatus: 'rejected', later: false })), { v3: 'rejected', v4: 'rejected' });
});

test('v4: a blocking failure with an unevaluable observedAt stands against the resolution (v3 set it aside)', () => {
  const failing = (observedAt, extra) => resolutionBundle({ later: false, evidence: [{ observedAt, ...extra }] });
  assert.deepEqual(v34(failing(BAD)), { v3: 'verified', v4: 'disputed' });
  assert.deepEqual(v34(failing(undefined)), { v3: 'verified', v4: 'disputed' });
  // Evaluable times behave as before: earlier is set aside, later overrides.
  assert.deepEqual(v34(failing(T0)), { v3: 'verified', v4: 'verified' });
  assert.deepEqual(v34(failing('2026-06-05T00:00:00Z')), { v3: 'disputed', v4: 'disputed' });
  // Only a blocking failure counts.
  assert.deepEqual(v34(failing(BAD, { blocking: false })), { v3: 'verified', v4: 'verified' });
  assert.deepEqual(v34(failing(BAD, { supportStrength: 'cited' })), { v3: 'verified', v4: 'verified' });
});

test('v4: one active trace is enough; an unevaluable trace neither authorises nor vetoes', () => {
  assert.deepEqual(v34(resolutionBundle({ traces: [{ revokedAt: BAD }, {}] })), { v3: 'verified', v4: 'verified' });
  assert.deepEqual(v34(resolutionBundle({ traces: [{}, { revokedAt: BAD }] })), { v3: 'verified', v4: 'verified' });
  assert.deepEqual(v34(resolutionBundle({ traces: [{ revokedAt: BAD }, { revokedAt: T0 }] })), { v3: 'verified', v4: 'disputed' });
  assert.deepEqual(v34(resolutionBundle({ traces: [{ revokedAt: BAD }, { validFrom: BAD }] })), { v3: 'verified', v4: 'disputed' });
});

test('v4: refusing a resolution can strengthen the status', () => {
  const b = resolutionBundle({ bounds: { revokedAt: BAD }, resolutionStatus: 'rejected', laterStatus: 'verified' });
  assert.deepEqual(v34(b), { v3: 'rejected', v4: 'verified' });
});

test('v4: times outside RFC 3339 are unevaluable wherever the fold reads one', () => {
  const verified = (claim, event) => {
    const b = resolutionBundle({ traces: [] });
    Object.assign(b.claims[0], claim);
    b.events = [{ id: 'v', claimId: 'c', status: 'verified', actor: 'ci', method: 'm', evidenceIds: ['e'], createdAt: T0, ...event }];
    return b;
  };
  assert.deepEqual(v34(verified({ expiresAt: '2027-04-01' })), { v3: 'verified', v4: 'stale' });
  assert.deepEqual(v34(verified({ expiresAt: 'April 1, 2027' })), { v3: 'verified', v4: 'stale' });
  assert.deepEqual(v34(verified({ expiresAt: '2026-12-31T23:59:60Z' })), { v3: 'stale', v4: 'verified' });
  assert.deepEqual(v34(verified({ ttlSeconds: 315360000 }, { verifiedAt: '2026-06-01' })), { v3: 'verified', v4: 'stale' });
  assert.deepEqual(v34(verified({ expiresAt: '2027-04-01T00:00:00Z' })), { v3: 'verified', v4: 'verified' });
});
