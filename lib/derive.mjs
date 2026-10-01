/**
 * Status derivation — statusFunctionVersion "3" (default) and "2".
 *
 * A direct, dependency-free implementation of status-function.md. The prose
 * specification is normative; this module exists so the format is usable
 * without any particular vendor's implementation. Conformance is proven by
 * test/derive.conformance.test.mjs running every conformance/sf-*.json
 * vector through deriveStatuses.
 *
 * Version "2" is kept exactly as specified (status-function.md §"Version 2")
 * so a consumer can re-derive a record under the version it was resolved at.
 */

/** The version this package implements by default. */
export const statusFunctionVersion = '3';

/** Every version this module can evaluate. */
export const supportedStatusFunctionVersions = Object.freeze(['2', '3']);

const TERMINAL_EVENT_STATUSES = new Set([
  'rejected',
  'disputed',
  'superseded',
  'stale',
  'revoked',
]);

/**
 * Evidence types that record the result of a pass/fail check. Under version
 * "3" such evidence satisfies a policy requirement only when `passing` is
 * `true` (status-function.md §4c).
 */
const CHECK_EVIDENCE_TYPES = new Set(['test_output', 'calculation_trace', 'runtime_observation']);

/**
 * status-function.md §"Status ordering", weakest first. Version "3" order;
 * used for the derivation ceiling.
 */
export const statusOrder = Object.freeze([
  'revoked',
  'rejected',
  'disputed',
  'superseded',
  'stale',
  'unknown',
  'assumed',
  'proposed',
  'verified',
]);

const STATUS_RANK = new Map(statusOrder.map((s, i) => [s, i]));

/**
 * The weaker of two statuses under the version "3" ordering. A value outside
 * the TrustStatus vocabulary cannot be ranked, so it is treated as the
 * weakest status rather than as a neutral one.
 */
export function weakerStatus(a, b) {
  const ra = STATUS_RANK.get(a) ?? -1;
  const rb = STATUS_RANK.get(b) ?? -1;
  return ra <= rb ? a : b;
}

function checkVersion(options) {
  const version = options?.statusFunctionVersion ?? statusFunctionVersion;
  if (!supportedStatusFunctionVersions.includes(version)) {
    throw new RangeError(
      `unsupported statusFunctionVersion ${JSON.stringify(version)}; ` +
        `supported: ${supportedStatusFunctionVersions.join(', ')}`
    );
  }
  return version;
}

/**
 * `now` in epoch ms. Under v3 an unparseable `now` is refused: every freshness
 * comparison needs it, and a NaN comparison would read as "not stale".
 */
function nowToMs(now, version) {
  const ms = now instanceof Date ? now.getTime() : toTime(now);
  if (version !== '2' && !Number.isFinite(ms)) throw new RangeError(`invalid now: ${String(now)}`);
  return ms;
}

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

/**
 * status-function.md §Policy resolution.
 *
 * @param {object} claim
 * @param {object[]} policies
 * @param {{ statusFunctionVersion?: string }} [options] - under "3" a
 *   `verificationPolicyId` that names no policy resolves to nothing, with no
 *   fallback to claim-type resolution.
 */
export function resolvePolicy(claim, policies, options) {
  const version = checkVersion(options);
  const list = policies || [];
  if (claim.verificationPolicyId) {
    const byId = list.find((p) => p.id === claim.verificationPolicyId);
    if (byId) return byId;
    if (version !== '2') return undefined;
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

/** A policy that names at least one required evidence type or method (v3 §Effective policy). */
function requiresSomething(policy) {
  return (policy.requiredEvidence || []).length > 0 || (policy.requiredMethods || []).length > 0;
}

/** v3 §4c: evidence that can satisfy a requirement. */
function qualifies(evidence) {
  return !CHECK_EVIDENCE_TYPES.has(evidence.evidenceType) || evidence.passing === true;
}

/** Version "2" Step 4 (unchanged). */
function verifiedPathV2(claim, policy, entailing, latestEvent, nowMs) {
  const verifiedTime = toTime(latestEvent.verifiedAt ?? latestEvent.createdAt);

  // 4a. Staleness — claim-intrinsic validity window first.
  if (claim.expiresAt !== undefined) {
    if (nowMs > toTime(claim.expiresAt)) return 'stale';
  } else if (claim.ttlSeconds !== undefined) {
    if (nowMs > verifiedTime + claim.ttlSeconds * 1000) return 'stale';
  } else if (policy) {
    const kind = policy.validityRule && policy.validityRule.kind;
    if (kind === 'commit') {
      if (claim.currentIntegrityRef !== undefined) {
        const linked = entailing.filter((e) => (latestEvent.evidenceIds || []).includes(e.id));
        const anchored = linked.some((e) => e.integrityRef === claim.currentIntegrityRef);
        if (!anchored) return 'stale';
      }
    } else if (kind === 'duration') {
      const windowMs = (policy.validityRule.durationDays ?? 0) * 86400000;
      if (nowMs > verifiedTime + windowMs) return 'stale';
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
      return 'proposed';
    }
  }

  // 4c. Blocking failure check.
  if (entailing.some(isBlockingFailure)) return 'disputed';

  // 4d. Verified.
  return 'verified';
}

/**
 * Version "3" §4a: is the verification stale? Every input the check needs
 * must be present and evaluable; otherwise the verification is stale.
 */
function isStaleV3(claim, policy, entailing, latestEvent, nowMs) {
  const verifiedTime = toTime(latestEvent.verifiedAt ?? latestEvent.createdAt);

  if (claim.expiresAt !== undefined) {
    const expiry = toTime(claim.expiresAt);
    return expiry === undefined || nowMs > expiry;
  }
  if (claim.ttlSeconds !== undefined) {
    const ttl = claim.ttlSeconds;
    if (verifiedTime === undefined || typeof ttl !== 'number' || !Number.isFinite(ttl) || ttl < 0) return true;
    return nowMs > verifiedTime + claim.ttlSeconds * 1000;
  }
  if (!policy) return false; // §4c derives at most `proposed` without a policy.

  const rule = policy.validityRule;
  switch (rule && rule.kind) {
    case 'commit': {
      if (claim.currentIntegrityRef === undefined) return true;
      const linked = entailing.filter((e) => (latestEvent.evidenceIds || []).includes(e.id));
      return !linked.some((e) => e.integrityRef === claim.currentIntegrityRef);
    }
    case 'duration': {
      const days = rule.durationDays;
      if (typeof days !== 'number' || !Number.isFinite(days) || days < 0) return true;
      if (verifiedTime === undefined) return true;
      return nowMs > verifiedTime + days * 86400000;
    }
    case 'historical':
    case 'manual':
      return false;
    default:
      return true; // absent or unknown kind: unevaluable.
  }
}

/** Version "3" Step 4. */
function verifiedPathV3(claim, policy, entailing, latestEvent, nowMs) {
  // 4a. Staleness.
  if (isStaleV3(claim, policy, entailing, latestEvent, nowMs)) return 'stale';

  // 4b. Blocking failure.
  if (entailing.some(isBlockingFailure)) return 'disputed';

  // 4c. Policy requirements, evaluated only over qualifying evidence.
  if (!policy) return 'proposed';
  const qualifying = entailing.filter(qualifies);
  const types = new Set(qualifying.map((e) => e.evidenceType));
  const methods = new Set(qualifying.map((e) => e.method));
  const missingTypes = (policy.requiredEvidence || []).filter((t) => !types.has(t));
  const missingMethods = (policy.requiredMethods || []).filter((m) => !methods.has(m));
  const corroborationGap = policy.requiresCorroboration === true && qualifying.length < 2;
  if (missingTypes.length > 0 || missingMethods.length > 0 || corroborationGap) return 'proposed';

  // 4d. Verified.
  return 'verified';
}

/**
 * Derive the status of one claim, before the derivation ceiling (which needs
 * the whole bundle and is applied by deriveStatuses).
 *
 * Does not validate its input. Some guarantees hold only for schema-valid
 * records (status-function.md §"Fields that are not inputs"); the caller
 * validates first.
 *
 * @param {object} claim - the Claim being evaluated
 * @param {object} context - { evidence, events, policies, authorityTrace }
 *   evidence: Evidence[] whose claimId matches the claim (unpartitioned;
 *   this function applies the supportStrength partition);
 *   events / policies: full bundle collections;
 *   authorityTrace: AuthorityTrace[] (optional).
 * @param {Date} [now] - evaluation timestamp (defaults to wall clock)
 * @param {{ statusFunctionVersion?: string }} [options] - defaults to "3";
 *   any version not in supportedStatusFunctionVersions throws a RangeError.
 * @returns {{ status: string, policyId: string | undefined }}
 */
export function deriveClaimStatus(claim, context, now = new Date(), options) {
  const version = checkVersion(options);
  const v3 = version !== '2';
  const nowMs = nowToMs(now, version);
  const resolved = resolvePolicy(claim, context.policies, { statusFunctionVersion: version });
  // v3 §Effective policy: a policy that requires nothing constrains nothing.
  const policy = v3 && resolved && !requiresSomething(resolved) ? undefined : resolved;
  const entailing = (context.evidence || []).filter(
    (e) => e.claimId === claim.id && e.supportStrength !== 'cited'
  );
  const claimEvents = eventsForClaim(claim, context.events);
  const traces = context.authorityTrace || [];
  const policyId = resolved ? resolved.id : undefined;
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
    if (v3 && resolution.status === 'verified' && !policy) return done('proposed');
    return done(resolution.status);
  }

  const latestEvent = claimEvents[0];

  // Step 2: terminal event statuses.
  if (latestEvent) {
    if (latestEvent.status === 'revoked') return done('stale');
    if (latestEvent.type === 'invalidation') {
      // v3: an invalidation says the claim is no longer good, whatever status
      // it carries; a non-terminal status cannot make it good again.
      if (v3 && !TERMINAL_EVENT_STATUSES.has(latestEvent.status)) return done('stale');
      return done(latestEvent.status);
    }
    if (TERMINAL_EVENT_STATUSES.has(latestEvent.status)) return done(latestEvent.status);
  }

  // Step 3: assumed from event.
  if (latestEvent && latestEvent.status === 'assumed') return done('assumed');

  // Step 4: verified event path.
  if (latestEvent && latestEvent.status === 'verified') {
    const verifiedPath = v3 ? verifiedPathV3 : verifiedPathV2;
    return done(verifiedPath(claim, policy, entailing, latestEvent, nowMs));
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

/** Input claim ids named by derivedFrom and derivationEdges, deduplicated. */
function derivationInputIds(claim) {
  const ids = [...(claim.derivedFrom || []), ...(claim.derivationEdges || []).map((e) => e.inputClaimId)];
  return [...new Set(ids)];
}

/**
 * v3 §Derivation ceiling: bound `own` by the weakest own status reachable
 * through the claim's inputs, transitively. An input id that names no claim
 * in the bundle contributes `unknown`. Each claim is visited once, so cycles
 * terminate.
 */
function applyCeiling(claim, own, ownById, claimsById) {
  let status = own;
  const visited = new Set([claim.id]);
  const queue = derivationInputIds(claim);
  while (queue.length > 0) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    const input = claimsById.get(id);
    if (!input) {
      status = weakerStatus(status, 'unknown');
      continue;
    }
    status = weakerStatus(status, ownById[id]);
    queue.push(...derivationInputIds(input));
  }
  return status;
}

/**
 * Derive the status of every claim in a bundle.
 *
 * Does not validate the bundle. Some guarantees hold only for a schema-valid
 * bundle: the schema, not this function, is what keeps inconclusive evidence
 * `cited` and so out of the fold. Validate first. The `hachure derive` and
 * `hachure diff` commands do, and refuse to run when they cannot (ajv not
 * installed) unless given --no-validate.
 *
 * @param {object} bundle - a TrustBundle
 * @param {Date} [now] - evaluation timestamp
 * @param {{ statusFunctionVersion?: string }} [options] - defaults to "3"
 * @returns {Record<string, string>} claim id → derived status
 */
export function deriveStatuses(bundle, now = new Date(), options) {
  const version = checkVersion(options);
  nowToMs(now, version);
  const claims = bundle.claims || [];
  const own = {};
  for (const claim of claims) {
    own[claim.id] = deriveClaimStatus(
      claim,
      {
        evidence: bundle.evidence,
        events: bundle.events,
        policies: bundle.policies,
        authorityTrace: bundle.authorityTrace,
      },
      now,
      { statusFunctionVersion: version }
    ).status;
  }
  // Version "2" leaves the ceiling to a separate derivation layer.
  if (version === '2') return own;

  const claimsById = new Map(claims.map((c) => [c.id, c]));
  const result = {};
  for (const claim of claims) {
    result[claim.id] = applyCeiling(claim, own[claim.id], own, claimsById);
  }
  return result;
}
