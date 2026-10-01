/**
 * The schema constraints that status derivation relies on but does not
 * itself check (status-function.md §"Fields that are not inputs"), written
 * without a JSON Schema validator so a caller that cannot run one still has
 * a minimum check. This is not a substitute for schema validation and not a
 * step of the status function: deriveStatuses never calls it.
 */

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Check that inconclusive evidence is kept out of derivation, and that the
 * schemaVersion 9 evidence fields are declared.
 *
 * - An evidence item with `inconclusive` must have `supportStrength: "cited"`
 *   and no `passing`.
 * - A bundle with an evidence item carrying `inconclusive` or
 *   `collectedByKind` must declare `schemaVersion` 9 or later.
 *
 * @param {object} bundle - a TrustBundle
 * @returns {Array<{ instancePath: string, message: string }>} empty when the
 *   invariants hold. Each message names the evidence item.
 */
export function checkBasisInvariants(bundle) {
  if (!isObject(bundle)) return [{ instancePath: '', message: 'bundle must be an object' }];
  if (bundle.evidence === undefined) return [];
  if (!Array.isArray(bundle.evidence)) return [{ instancePath: '/evidence', message: 'evidence must be an array' }];

  const errors = [];
  const declares9 = typeof bundle.schemaVersion === 'number' && bundle.schemaVersion >= 9;
  bundle.evidence.forEach((item, i) => {
    const instancePath = `/evidence/${i}`;
    if (!isObject(item)) {
      errors.push({ instancePath, message: 'evidence item must be an object' });
      return;
    }
    const name = `evidence ${JSON.stringify(item.id)}`;
    if (item.inconclusive !== undefined) {
      if (item.supportStrength !== 'cited') {
        errors.push({
          instancePath,
          message: `inconclusive ${name} must have supportStrength "cited" (found ${JSON.stringify(item.supportStrength)})`,
        });
      }
      if (item.passing !== undefined) {
        errors.push({ instancePath, message: `inconclusive ${name} must not carry passing` });
      }
    }
    if (!declares9) {
      for (const field of ['inconclusive', 'collectedByKind']) {
        if (item[field] !== undefined) {
          errors.push({
            instancePath,
            message: `${name} carries ${field}, which requires schemaVersion 9 or later (declared ${JSON.stringify(bundle.schemaVersion)})`,
          });
        }
      }
    }
  });
  return errors;
}
