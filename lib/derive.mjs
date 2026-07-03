/**
 * Status derivation — statusFunctionVersion "2".
 *
 * A direct, dependency-free implementation of status-function.md. The prose
 * specification is normative; this module exists so the format is usable
 * without any particular vendor's implementation. Conformance is proven by
 * test/derive.conformance.test.mjs running every conformance/sf-*.json
 * vector through deriveStatuses.
 */

const TERMINAL_EVENT_STATUSES = new Set([
  'rejected',
  'disputed',
  'superseded',
  'stale',
  'revoked',
]);

function toTime(value) {
  const t = Date.parse(value);
  return Number.isNaN(t) ? undefined : t;
}

/** Events for the claim, most-recent-first by createdAt. */
function eventsForClaim(claim, events) {
  return (events || [])
    .filter((e) => e.claimId === claim.id)
    .slice()
    .sort((a, b) => (toTime(b.createdAt) ?? 0) - (toTime(a.createdAt) ?? 0));
}

/** status-function.md §Policy resolution. */
export function resolvePolicy(claim, policies) {
  const list = policies || [];
  if (claim.verificationPolicyId) {
    const byId = list.find((p) => p.id === claim.verificationPolicyId);
    if (byId) return byId;
  }
  // Exact claimType match; first declared wins.
  const byType = new Map();
  const parentOf = new Map();
  for (const p of list) {
    if (p.claimType && !byType.has(p.claimType)) byType.set(p.claimType, p);
    if (p.claimType && p.parentType && !parentOf.has(p.claimType)) {
      parentOf.set(p.claimType, p.parentType);
    }
  }
  let type = claim.claimType;
  const seen = new Set();
  while (type && !seen.has(type)) {
    const policy = byType.get(type);
    if (policy) return policy;
    seen.add(type);
    type = parentOf.get(type);
  }
  return undefined;
}

/** An AuthorityTrace is active at eventCreatedAt (status-function.md Step 1). */
function traceActiveAt(trace, event) {
  const at = toTime(event.createdAt);
  if (trace.actorRef !== event.actor) return false;
  if (trace.revokedAt !== undefined && toTime(trace.revokedAt) <= at) return false;
  if (trace.validFrom !== undefined && toTime(trace.validFrom) > at) return false;
  if (trace.validUntil !== undefined && toTime(trace.validUntil) < at) return false;
  if (event.authorityRef !== undefined && trace.authorityRef !== event.authorityRef) return false;
  return true;
}

function isBlockingFailure(evidence) {
  return evidence.passing === false && evidence.blocking !== false;
}

/**
 * Derive the status of one claim.
 *
 * @param {object} claim - the Claim being evaluated
 * @param {object} context - { evidence, events, policies, authorityTrace }
 *   evidence: Evidence[] whose claimId matches the claim (unpartitioned;
 *   this function applies the supportStrength partition);
 *   events / policies: full bundle collections;
 *   authorityTrace: AuthorityTrace[] (optional).
 * @param {Date} [now] - evaluation timestamp (defaults to wall clock)
 * @returns {{ status: string, policyId: string | undefined }}
 */
export function deriveClaimStatus(claim, context, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : toTime(now);
  const policy = resolvePolicy(claim, context.policies);
  const entailing = (context.evidence || []).filter(
    (e) => e.claimId === claim.id && e.supportStrength !== 'cited'
  );
  const claimEvents = eventsForClaim(claim, context.events);
  const traces = context.authorityTrace || [];
  const policyId = policy ? policy.id : undefined;
  const done = (status) => ({ status, policyId });

  // Step 1: authority-gated dispute resolution.
  const resolution = claimEvents.find(
    (e) => e.resolvesDispute === true && traces.some((t) => traceActiveAt(t, e))
  );
  if (resolution) {
    const resolutionAt = toTime(resolution.createdAt);
    const newerBlockingFailure = entailing.some(
      (e) => isBlockingFailure(e) && toTime(e.observedAt) > resolutionAt
    );
    if (newerBlockingFailure) return done('disputed');
    return done(resolution.status);
  }

  const latestEvent = claimEvents[0];

  // Step 2: terminal event statuses.
  if (latestEvent) {
    if (latestEvent.status === 'revoked') return done('stale');
    if (latestEvent.type === 'invalidation') return done(latestEvent.status);
    if (TERMINAL_EVENT_STATUSES.has(latestEvent.status)) return done(latestEvent.status);
  }

  // Step 3: assumed from event.
  if (latestEvent && latestEvent.status === 'assumed') return done('assumed');

  // Step 4: verified event path.
  if (latestEvent && latestEvent.status === 'verified') {
    const verifiedTime = toTime(latestEvent.verifiedAt ?? latestEvent.createdAt);

    // 4a. Staleness — claim-intrinsic validity window first.
    if (claim.expiresAt !== undefined) {
      if (nowMs > toTime(claim.expiresAt)) return done('stale');
    } else if (claim.ttlSeconds !== undefined) {
      if (nowMs > verifiedTime + claim.ttlSeconds * 1000) return done('stale');
    } else if (policy) {
      const kind = policy.validityRule && policy.validityRule.kind;
      if (kind === 'commit') {
        if (claim.currentIntegrityRef !== undefined) {
          const linked = entailing.filter((e) =>
            (latestEvent.evidenceIds || []).includes(e.id)
          );
          const anchored = linked.some((e) => e.integrityRef === claim.currentIntegrityRef);
          if (!anchored) return done('stale');
        }
      } else if (kind === 'duration') {
        const windowMs = (policy.validityRule.durationDays ?? 0) * 86400000;
        if (nowMs > verifiedTime + windowMs) return done('stale');
      }
      // "historical" / "manual": never stale by time or commit change.
    }

    // 4b. Policy evidence gap check.
    if (policy) {
      const types = new Set(entailing.map((e) => e.evidenceType));
      const methods = new Set(entailing.map((e) => e.method));
      const missingTypes = (policy.requiredEvidence || []).filter((t) => !types.has(t));
      const missingMethods = (policy.requiredMethods || []).filter((m) => !methods.has(m));
      const corroborationGap = policy.requiresCorroboration === true && entailing.length < 2;
      if (missingTypes.length > 0 || missingMethods.length > 0 || corroborationGap) {
        return done('proposed');
      }
    }

    // 4c. Blocking failure check.
    if (entailing.some(isBlockingFailure)) return done('disputed');

    // 4d. Verified.
    return done('verified');
  }

  // Step 5: claim-level status baseline.
  if (claim.status === 'proposed') return done('proposed');
  if (claim.status === 'assumed') return done('assumed');

  // Step 6: no policy.
  if (!policy) return done(entailing.length > 0 ? 'proposed' : 'unknown');

  // Step 7: policy evidence presence.
  const types = new Set(entailing.map((e) => e.evidenceType));
  const satisfied = (policy.requiredEvidence || []).every((t) => types.has(t));
  return done(satisfied ? 'proposed' : 'unknown');
}

/**
 * Derive the status of every claim in a bundle.
 *
 * @param {object} bundle - a TrustBundle
 * @param {Date} [now] - evaluation timestamp
 * @returns {Record<string, string>} claim id → derived status
 */
export function deriveStatuses(bundle, now = new Date()) {
  const result = {};
  for (const claim of bundle.claims || []) {
    const { status } = deriveClaimStatus(
      claim,
      {
        evidence: bundle.evidence,
        events: bundle.events,
        policies: bundle.policies,
        authorityTrace: bundle.authorityTrace,
      },
      now
    );
    result[claim.id] = status;
  }
  return result;
}
