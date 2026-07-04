/**
 * diffStatuses + the `hachure diff` CLI: adding a revocation event to a
 * verified claim must surface as a verified→stale transition (spec issue #10,
 * the anti-monotonic-verification demonstration).
 * Run: node --test test/diff.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { diffStatuses, testVectors } from '../index.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = new Date('2026-06-10T00:00:00.000Z');

// Use the verified-commit vector as the "before" bundle; a revocation event
// appended after its verification is the archetypal new-evidence-arrives case.
const { vector } = testVectors.find((v) => v.name === 'sf-verified-commit');
const before = vector.input;
const after = structuredClone(before);
after.events.push({
  id: 'event.api.rate-limit.revoked',
  claimId: 'claim.api.rate-limit',
  status: 'revoked',
  type: 'invalidation',
  actor: 'security-team',
  method: 'manual-revocation',
  evidenceIds: [],
  createdAt: '2026-06-01T00:00:00.000Z',
});

test('AC1: revocation event produces a verified→stale transition', () => {
  const { transitions, unchanged } = diffStatuses(before, after, NOW);
  assert.deepEqual(transitions, {
    'claim.api.rate-limit': { from: 'verified', to: 'stale' },
  });
  assert.equal(unchanged, 0);
});

test('AC2: identical bundles produce an empty diff', () => {
  const { transitions, unchanged } = diffStatuses(before, structuredClone(before), NOW);
  assert.deepEqual(transitions, {});
  assert.equal(unchanged, 1);
});

test('claims present on only one side report null on the missing side', () => {
  const grown = structuredClone(before);
  grown.claims.push({
    ...structuredClone(before.claims[0]),
    id: 'claim.api.burst-limit',
    fieldOrBehavior: 'burst limit is enforced',
  });
  const { transitions } = diffStatuses(before, grown, NOW);
  assert.equal(transitions['claim.api.burst-limit'].from, null);
  assert.ok(typeof transitions['claim.api.burst-limit'].to === 'string');
});

test('AC1/AC2: CLI exit codes — 3 on transitions, 0 on none', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hachure-diff-'));
  const beforePath = join(dir, 'before.json');
  const afterPath = join(dir, 'after.json');
  writeFileSync(beforePath, JSON.stringify(before));
  writeFileSync(afterPath, JSON.stringify(after));

  // Transitions → exit 3, transition present in JSON on stdout.
  let code = 0;
  let stdout = '';
  try {
    stdout = execFileSync('node', ['bin/hachure.mjs', 'diff', beforePath, afterPath, '--now', NOW.toISOString()], { cwd: root, encoding: 'utf8' });
  } catch (err) {
    code = err.status;
    stdout = err.stdout;
  }
  assert.equal(code, 3, 'transitions must exit 3 (scriptable gate)');
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.transitions['claim.api.rate-limit'].to, 'stale');

  // No transitions → exit 0.
  const same = execFileSync('node', ['bin/hachure.mjs', 'diff', beforePath, beforePath, '--now', NOW.toISOString()], { cwd: root, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(same).transitions, {});
});
