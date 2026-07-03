/**
 * RFC 8785 (JSON Canonicalization Scheme) serialization.
 *
 * In JavaScript this is a recursive sorted-key serialization on top of the
 * native JSON.stringify primitives, which is conformant by construction:
 * JSON.stringify emits literal UTF-8 for non-ASCII (escaping only the
 * two-char sequences and control characters RFC 8785 §3.2.2.2 requires),
 * number serialization is the ECMAScript Number::toString algorithm
 * (RFC 8785 §3.2.2.3), and the default Array.prototype.sort comparison is by
 * UTF-16 code unit (RFC 8785 §3.2.3). See merge.md §6's informative note for
 * why the same shortcut is NOT safe in other languages.
 *
 * Used for merge.md §6's deterministic tie-break and available for
 * "hash"-kind integrityAnchor computation (SECURITY.md).
 */
export function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
      throw new TypeError('cannot canonicalize undefined, functions, or symbols');
    }
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new TypeError('cannot canonicalize non-finite numbers');
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((item) => canonicalize(item === undefined ? null : item)).join(',') + ']';
  }
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return (
    '{' +
    keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') +
    '}'
  );
}
