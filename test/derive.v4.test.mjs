/**
 * Status function version "4": what a timestamp is, and times that cannot be
 * evaluated in Step 1 (status-function.md §"Timestamps", §"Version 3").
 * Each rule is checked against version "3", which must keep its published
 * behaviour. Run with: node --test test/derive.v4.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { deriveStatuses, parseTimestamp, compareTimestamps, statusFunctionVersion } from '../index.mjs';

const NOW = new Date('2026-06-10T00:00:00.000Z');
const T0 = '2026-06-01T00:00:00.000Z';
const BAD = 'not-a-timestamp';

test('the default version is 4', () => {
  assert.equal(statusFunctionVersion, '4');
});

// --- parseTimestamp -----------------------------------------------------------

const ms = (value) => parseTimestamp(value)?.epochMilliseconds;
const same = (a, b) => compareTimestamps(parseTimestamp(a), parseTimestamp(b)) === 0;
const earlier = (a, b) => compareTimestamps(parseTimestamp(a), parseTimestamp(b)) < 0 && compareTimestamps(parseTimestamp(b), parseTimestamp(a)) > 0;

test('parseTimestamp reads RFC 3339 date-times as instants', () => {
  const base = Date.UTC(2026, 4, 2, 0, 0, 0);
  for (const spelling of [
    '2026-05-02T00:00:00Z',
    '2026-05-02T00:00:00.000Z',
    '2026-05-02T00:00:00.000000000Z',
    '2026-05-02t00:00:00z',
    '2026-05-02T02:00:00+02:00',
    '2026-05-01T19:30:00-04:30',
    '2026-05-02T00:00:00+00:00',
    '2026-05-02T00:00:00-00:00',
  ]) {
    assert.deepEqual(parseTimestamp(spelling), { epochMilliseconds: base, subMillisecond: '' }, spelling);
    assert.ok(same(spelling, '2026-05-02T00:00:00Z'), spelling);
  }
  assert.deepEqual(parseTimestamp('2026-05-02T00:00:00.5Z'), { epochMilliseconds: base + 500, subMillisecond: '' });
  assert.deepEqual(parseTimestamp('2026-05-02T00:00:00.123456Z'), { epochMilliseconds: base + 123, subMillisecond: '456' });
  assert.deepEqual(parseTimestamp('2026-05-02T00:00:00.1234560Z'), { epochMilliseconds: base + 123, subMillisecond: '456' });
  assert.deepEqual(parseTimestamp('2026-05-02T00:00:00.00010Z'), { epochMilliseconds: base, subMillisecond: '1' });
  assert.equal(ms('2024-02-29T00:00:00Z'), Date.UTC(2024, 1, 29));
  assert.equal(ms('2000-02-29T00:00:00Z'), Date.UTC(2000, 1, 29));
  // Years 0000-0099 are themselves, not 1900-1999.
  assert.equal(new Date(ms('0050-01-01T00:00:00Z')).getUTCFullYear(), 50);
});

test('compareTimestamps is exact: no rounding, any number of fractional digits', () => {
  assert.ok(earlier('2026-05-02T00:00:00.0001Z', '2026-05-02T00:00:00.0009Z'));
  assert.ok(earlier('2026-05-02T00:00:00.000Z', '2026-05-02T00:00:00.0009Z'));
  assert.ok(earlier('2026-05-02T00:00:00.123400Z', '2026-05-02T00:00:00.123900Z'));
  // Below what a double of milliseconds can tell apart.
  assert.ok(earlier('2026-05-02T00:00:00.00000001Z', '2026-05-02T00:00:00.00000002Z'));
  assert.ok(earlier('2026-05-02T00:00:00.9999999999Z', '2026-05-02T00:00:01Z'));
  assert.ok(earlier('2026-05-02T00:00:00.99999999999999999999Z', '2026-05-02T00:00:01.00000000000000000001Z'));
  assert.ok(earlier('2026-05-02T00:00:00.12Z', '2026-05-02T00:00:00.123Z'));
  assert.ok(earlier('2026-05-02T00:00:00.1239Z', '2026-05-02T00:00:00.124Z'));
  assert.ok(earlier('2026-05-02T00:00:00.00012Z', '2026-05-02T00:00:00.000123Z'));
  assert.ok(earlier('1969-12-31T23:59:59.9995Z', '1969-12-31T23:59:59.9996Z'));
  assert.ok(same('2026-05-02T00:00:00.5Z', '2026-05-02T00:00:00.500000Z'));
  assert.ok(same('2026-05-02T00:00:00.00010Z', '2026-05-02T02:00:00.0001+02:00'));
});

// An independent reading: civil date to days by arithmetic, everything in
// BigInt, the fraction scaled to a fixed 40 digits. Shares no code with lib/.
function referenceInstant(text) {
  const m = /^(\d{4})-(\d\d)-(\d\d)[Tt](\d\d):(\d\d):(\d\d)(?:\.(\d+))?(?:[Zz]|([+-])(\d\d):(\d\d))$/.exec(text);
  let [y, mo, d, h, mi, sec] = m.slice(1, 7).map(Number);
  y -= mo <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  const days = era * 146097 + doe - 719468;
  const offset = m[8] ? (m[8] === '-' ? -1 : 1) * (Number(m[9]) * 60 + Number(m[10])) : 0;
  const seconds = BigInt(days) * 86400n + BigInt(h * 3600 + mi * 60 + sec - offset * 60);
  const fraction = BigInt((m[7] ?? '').padEnd(40, '0').slice(0, 40));
  return seconds * 10n ** 40n + fraction;
}

test('parseTimestamp and compareTimestamps agree with an independent BigInt reference', () => {
  let seed = 0x9e3779b9;
  const rnd = (n) => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0;
    return seed % n;
  };
  const two = (n) => String(n).padStart(2, '0');
  const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const FRACTIONS = ['', '.0', '.5', '.000', '.0001', '.0009', '.123400', '.1239', '.9999999999', '.00000000001', '.00000000002', '.999', '.9990', '.1', '.10', '.100000000000000000001'];
  const random = () => {
    // A narrow window of dates and times so that near-collisions are common.
    const year = [1969, 2026, 2026, 2026, 50][rnd(5)];
    const month = rnd(12) === 0 ? 1 + rnd(12) : 1 + rnd(2);
    const day = rnd(12) === 0 ? 1 + rnd(DAYS[month - 1]) : 1 + rnd(2);
    const time = `${two(rnd(6) === 0 ? rnd(24) : 0)}:${two(rnd(6) === 0 ? rnd(60) : 0)}:${two(rnd(3))}`;
    const offset = rnd(4) === 0 ? ['+02:00', '-04:30', '+23:59', '-23:59'][rnd(4)] : ['Z', 'z', '+00:00', '-00:00'][rnd(4)];
    return `${String(year).padStart(4, '0')}-${two(month)}-${two(day)}${rnd(8) === 0 ? 't' : 'T'}${time}${FRACTIONS[rnd(FRACTIONS.length)]}${offset}`;
  };
  // The same instant written another way: more trailing zeros, another case.
  const respell = (text) => {
    const m = /^(.*?)(\.\d+)?([Zz]|[+-]\d\d:\d\d)$/.exec(text);
    return `${m[1].toLowerCase()}${m[2] ?? '.'}${'0'.repeat(1 + rnd(5))}${m[3] === 'Z' ? 'z' : m[3]}`;
  };
  const sign = (n) => (n < 0 ? -1 : n > 0 ? 1 : 0);
  let equal = 0;
  let unequal = 0;
  for (let i = 0; i < 20000; i++) {
    const a = random();
    const b = rnd(4) === 0 ? respell(a) : random();
    const pa = parseTimestamp(a);
    const pb = parseTimestamp(b);
    assert.ok(pa && pb, `${a} / ${b} must parse`);
    const ra = referenceInstant(a);
    const rb = referenceInstant(b);
    const expected = ra < rb ? -1 : ra > rb ? 1 : 0;
    assert.equal(sign(compareTimestamps(pa, pb)), expected, `${a} vs ${b}`);
    assert.equal(sign(compareTimestamps(pb, pa)), 0 - expected, `${b} vs ${a}`);
    if (expected === 0) equal++;
    else unequal++;
  }
  // The generator must actually produce both outcomes, or the check proves little.
  assert.ok(equal > 200, `only ${equal} equal pairs`);
  assert.ok(unequal > 200, `only ${unequal} unequal pairs`);
});

test('parseTimestamp reads a leap second only at 23:59:60 UTC, as the following instant', () => {
  const next = Date.UTC(2027, 0, 1, 0, 0, 0);
  assert.equal(ms('2026-12-31T23:59:60Z'), next);
  assert.equal(ms('2027-01-01T01:59:60+02:00'), next);
  assert.equal(ms('2026-12-31T18:59:60-05:00'), next);
  assert.deepEqual(parseTimestamp('2026-12-31T23:59:60.25Z'), { epochMilliseconds: next + 250, subMillisecond: '' });
  assert.ok(same('2026-12-31T23:59:60Z', '2027-01-01T00:00:00Z'));
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

test('v4: instants are ordered exactly where the fold compares two of them (v3 truncated to the millisecond)', () => {
  // event order
  const ordered = (first, second) => {
    const b = resolutionBundle({ traces: [] });
    b.events = [
      { id: 'a', claimId: 'c', status: 'rejected', actor: 'ci', method: 'm', evidenceIds: ['e'], createdAt: first },
      { id: 'b', claimId: 'c', status: 'verified', actor: 'ci', method: 'm', evidenceIds: ['e'], createdAt: second },
    ];
    return v34(b);
  };
  assert.deepEqual(ordered('2026-06-02T00:00:00.0001Z', '2026-06-02T00:00:00.0009Z'), { v3: 'rejected', v4: 'verified' });
  assert.deepEqual(ordered('2026-06-02T00:00:00.0009Z', '2026-06-02T00:00:00.0001Z'), { v3: 'rejected', v4: 'rejected' });
  // a blocking failure against the resolution
  const failing = (resolvedAt, observedAt) => resolutionBundle({ later: false, resolvedAt, evidence: [{ observedAt }] });
  assert.deepEqual(v34(failing('2026-06-02T00:00:00.123400Z', '2026-06-02T00:00:00.123900Z')), { v3: 'verified', v4: 'disputed' });
  assert.deepEqual(v34(failing('2026-06-02T00:00:00.123900Z', '2026-06-02T00:00:00.123400Z')), { v3: 'verified', v4: 'verified' });
  // a revocation against the resolution
  const revoked = (resolvedAt, revokedAt) => resolutionBundle({ resolvedAt, bounds: { revokedAt } });
  assert.deepEqual(v34(revoked('2026-06-02T00:00:00.0001Z', '2026-06-02T00:00:00.0005Z')), { v3: 'disputed', v4: 'verified' });
  assert.deepEqual(v34(revoked('2026-06-02T00:00:00.00000001Z', '2026-06-02T00:00:00.00000002Z')), { v3: 'disputed', v4: 'verified' });
});

test('v4: an unevaluable createdAt sorts before every timestamp, including one before 1970 (v3 read it as the epoch)', () => {
  const b = resolutionBundle({ traces: [] });
  const event = (id, status, createdAt) => ({ id, claimId: 'c', status, actor: 'ci', method: 'm', evidenceIds: ['e'], createdAt });
  b.events = [event('bad', 'rejected', BAD), event('old', 'verified', '1969-12-31T00:00:00Z')];
  assert.deepEqual(v34(b), { v3: 'rejected', v4: 'verified' });
  b.events = [event('old', 'verified', '1969-12-31T00:00:00Z'), event('absent', 'rejected', undefined)];
  assert.deepEqual(v34(b), { v3: 'rejected', v4: 'verified' });
});

test('v4: an absent createdAt on a resolution, or observedAt on a blocking failure, is unevaluable', () => {
  const noTime = resolutionBundle();
  delete noTime.events[0].createdAt;
  assert.deepEqual(v34(noTime), { v3: 'verified', v4: 'disputed' });
  assert.deepEqual(v34(resolutionBundle({ later: false, evidence: [{ observedAt: undefined }] })), { v3: 'verified', v4: 'disputed' });
});

test('v4: a validity window is whole milliseconds, and the whole-millisecond part of a time decides against now', () => {
  const at = (now, claim, event = {}) => {
    const b = resolutionBundle({ traces: [] });
    Object.assign(b.claims[0], claim);
    b.events = [{ id: 'v', claimId: 'c', status: 'verified', actor: 'ci', method: 'm', evidenceIds: ['e'], createdAt: '2026-06-01T00:00:00.000Z', ...event }];
    return deriveStatuses(b, new Date(now), { statusFunctionVersion: '4' }).c;
  };
  // expiresAt 0.9 ms after now: not yet expired; now one millisecond on: expired.
  assert.equal(at('2026-06-10T00:00:00.000Z', { expiresAt: '2026-06-10T00:00:00.0009Z' }), 'verified');
  assert.equal(at('2026-06-10T00:00:00.001Z', { expiresAt: '2026-06-10T00:00:00.0009Z' }), 'stale');
  // ttl of 1 s from a verification 0.5 ms past the second: fresh at +1.000 s, stale at +1.001 s.
  assert.equal(at('2026-06-01T00:00:01.000Z', { ttlSeconds: 1 }, { verifiedAt: '2026-06-01T00:00:00.0005Z' }), 'verified');
  assert.equal(at('2026-06-01T00:00:01.001Z', { ttlSeconds: 1 }, { verifiedAt: '2026-06-01T00:00:00.0005Z' }), 'stale');
});
