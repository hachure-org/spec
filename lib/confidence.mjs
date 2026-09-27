/**
 * conclusionConfidence checks that JSON Schema cannot express
 * (ai-evaluation.md §Calibrated conclusion confidence): interval ordering and
 * value-within-interval. Applied to schemaVersion 8 and later, matching the
 * schema's own version gate, so earlier bundles validate as before.
 */

/**
 * @param {object} bundle - a TrustBundle
 * @returns {Array<{ instancePath: string, message: string }>} empty when valid
 */
export function validateConclusionConfidence(bundle) {
  const errors = [];
  if (!(typeof bundle?.schemaVersion === 'number' && bundle.schemaVersion >= 8)) return errors;
  (bundle.claims || []).forEach((claim, i) => {
    const cc = claim?.conclusionConfidence;
    const interval = cc?.interval;
    if (!interval) return;
    const path = `/claims/${i}/conclusionConfidence`;
    const { low, high } = interval;
    if (typeof low === 'number' && typeof high === 'number' && low > high) {
      errors.push({ instancePath: `${path}/interval`, message: `low (${low}) must be <= high (${high})` });
    }
    if (typeof cc.value === 'number') {
      if (typeof low === 'number' && cc.value < low) {
        errors.push({ instancePath: `${path}/value`, message: `value (${cc.value}) must be >= interval.low (${low})` });
      }
      if (typeof high === 'number' && cc.value > high) {
        errors.push({ instancePath: `${path}/value`, message: `value (${cc.value}) must be <= interval.high (${high})` });
      }
    }
  });
  return errors;
}
