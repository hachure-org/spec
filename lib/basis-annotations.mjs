/**
 * Basis-annotations profile checks (basis-annotations.md). The profile's
 * shapes live under the open `metadata` object, so JSON Schema validation of
 * a bundle never sees them; these functions are the profile's rejection path.
 * Neither function is called by status derivation.
 */

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;

function unknownKeys(object, allowed) {
  return Object.keys(object).filter((key) => !allowed.includes(key));
}

function estimateErrors(claim, path) {
  const estimate = claim.metadata.estimate;
  if (!isObject(estimate)) return [{ instancePath: path, message: 'estimate must be an object' }];
  const errors = [];
  const push = (suffix, message) => errors.push({ instancePath: `${path}${suffix}`, message });
  for (const key of unknownKeys(estimate, ['basis', 'low', 'high'])) push(`/${key}`, 'unknown estimate key');
  if (!isNonEmptyString(estimate.basis)) push('/basis', 'basis must be a non-empty string');

  const hasLow = estimate.low !== undefined;
  const hasHigh = estimate.high !== undefined;
  if (hasLow !== hasHigh) {
    push('', 'low and high must appear together or not at all');
    return errors;
  }
  if (!hasLow) return errors;
  const { low, high } = estimate;
  if (!Number.isFinite(low) || !Number.isFinite(high)) {
    push('', 'low and high must be finite numbers');
    return errors;
  }
  if (low > high) push('', `low (${low}) must be <= high (${high})`);
  if (typeof claim.value !== 'number') {
    push('', 'bounds require a numeric claim value');
  } else if (low <= high && (claim.value < low || claim.value > high)) {
    push('', `claim value (${claim.value}) must lie within [${low}, ${high}]`);
  }
  return errors;
}

function sourceOfRecordErrors(sourceOfRecord, path) {
  if (!isObject(sourceOfRecord)) return [{ instancePath: path, message: 'sourceOfRecord must be an object' }];
  const errors = unknownKeys(sourceOfRecord, ['authorityTraceId']).map((key) => ({
    instancePath: `${path}/${key}`,
    message: 'unknown sourceOfRecord key',
  }));
  if (!isNonEmptyString(sourceOfRecord.authorityTraceId)) {
    errors.push({ instancePath: `${path}/authorityTraceId`, message: 'authorityTraceId must be a non-empty string' });
  }
  return errors;
}

/**
 * Shape checks for `claim.metadata.estimate` and
 * `evidence.metadata.sourceOfRecord`. A record that does not use the profile
 * produces no errors.
 *
 * @param {object} bundle - a TrustBundle
 * @returns {Array<{ instancePath: string, message: string }>} empty when valid
 */
export function validateBasisAnnotations(bundle) {
  const errors = [];
  (bundle?.claims || []).forEach((claim, i) => {
    if (isObject(claim?.metadata) && claim.metadata.estimate !== undefined) {
      errors.push(...estimateErrors(claim, `/claims/${i}/metadata/estimate`));
    }
  });
  (bundle?.evidence || []).forEach((evidence, i) => {
    if (isObject(evidence?.metadata) && evidence.metadata.sourceOfRecord !== undefined) {
      errors.push(...sourceOfRecordErrors(evidence.metadata.sourceOfRecord, `/evidence/${i}/metadata/sourceOfRecord`));
    }
  });
  return errors;
}

const subjectKey = (subject) => JSON.stringify([subject.subjectType, subject.subjectId]);

/** The claim's subject, its aliases, and everything `equivalent` links join to them. */
function claimSubjectKeys(claim, bundle) {
  const keys = new Set([claim, ...(claim.subjectAliases || [])].map(subjectKey));
  const links = (bundle.identityLinks || [])
    .filter((link) => (link.relation ?? 'equivalent') === 'equivalent')
    .map((link) => (link.subjects || []).map(subjectKey));
  let grew = true;
  while (grew) {
    grew = false;
    for (const link of links) {
      if (!link.some((key) => keys.has(key))) continue;
      for (const key of link) {
        if (!keys.has(key)) {
          keys.add(key);
          grew = true;
        }
      }
    }
  }
  return keys;
}

/** Bound comparison that fails closed: an unparseable bound never passes. */
function boundHolds(bound, test) {
  if (bound === undefined) return true;
  const ms = Date.parse(bound);
  return !Number.isNaN(ms) && test(ms);
}

/**
 * Resolve an evidence item's `metadata.sourceOfRecord` against the bundle
 * (basis-annotations.md §"Resolution rules"). A consumer shows a
 * source-of-record label only when `backed` is true.
 *
 * @param {object} bundle - the TrustBundle (or merged bundle) holding the evidence
 * @param {object} evidence - an Evidence item carrying `metadata.sourceOfRecord`
 * @returns {{ backed: true, trace: object } | { backed: false, reason: string }}
 *   reason is one of: not-declared, malformed, claim-not-found, trace-not-found,
 *   authority-type, subject-mismatch, not-active
 */
export function resolveSourceOfRecord(bundle, evidence) {
  const fail = (reason) => ({ backed: false, reason });
  const sourceOfRecord = evidence?.metadata?.sourceOfRecord;
  if (sourceOfRecord === undefined) return fail('not-declared');
  if (sourceOfRecordErrors(sourceOfRecord, '').length > 0) return fail('malformed');

  const claim = (bundle.claims || []).find((c) => c.id === evidence.claimId);
  if (!claim) return fail('claim-not-found');
  const trace = (bundle.authorityTrace || []).find((t) => t.id === sourceOfRecord.authorityTraceId);
  if (!trace) return fail('trace-not-found');
  if (trace.authorityType !== 'system' && trace.authorityType !== 'organization') return fail('authority-type');
  if (!trace.subject || !claimSubjectKeys(claim, bundle).has(subjectKey(trace.subject))) {
    return fail('subject-mismatch');
  }

  const at = Date.parse(evidence.observedAt);
  const active =
    !Number.isNaN(at) &&
    boundHolds(trace.revokedAt, (ms) => ms > at) &&
    boundHolds(trace.validFrom, (ms) => ms <= at) &&
    boundHolds(trace.validUntil, (ms) => ms >= at);
  return active ? { backed: true, trace } : fail('not-active');
}
