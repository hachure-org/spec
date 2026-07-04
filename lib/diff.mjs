/**
 * Status diff — the anti-monotonic primitive.
 *
 * Dominant attestation tooling freezes trust on first pass ("once
 * verification passes for an artifact, the addition of another attestation
 * cannot change that status"). Hachure's position is the opposite: status is
 * re-derived from the full record, so new evidence, events, or revocations
 * can — and should — change it. diffStatuses makes that observable: derive
 * two bundles at the same instant and report every per-claim transition.
 */

import { deriveStatuses } from './derive.mjs';

/**
 * Compare derived statuses of two bundles at one instant.
 *
 * @param {object} before - TrustBundle
 * @param {object} after - TrustBundle
 * @param {Date} [now] - evaluation timestamp applied to BOTH derivations, so
 *   every reported transition is attributable to record changes, never to
 *   time passing between two derivations.
 * @returns {{ transitions: Record<string, {from: string|null, to: string|null}>, unchanged: number }}
 *   `from`/`to` are null for claims present on only one side.
 */
export function diffStatuses(before, after, now = new Date()) {
  const a = deriveStatuses(before, now);
  const b = deriveStatuses(after, now);
  const transitions = {};
  let unchanged = 0;
  for (const claimId of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const from = claimId in a ? a[claimId] : null;
    const to = claimId in b ? b[claimId] : null;
    if (from === to) unchanged += 1;
    else transitions[claimId] = { from, to };
  }
  return { transitions, unchanged };
}
