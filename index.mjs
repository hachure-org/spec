/**
 * hachure — canonical npm distribution of the Hachure trust format spec.
 *
 * Exports:
 *   statusFunctionVersion  — spec-side declaration of the current status
 *                             derivation algorithm version. Reference
 *                             implementations must export a matching value.
 *   schemas                — Map<recordName, parsedSchemaObject> for every
 *                             normative schema shipped with this package.
 *   testVectors            — Array<{name, vector}> of all conformance test
 *                             vectors. Each vector has `input`, `expect`, and
 *                             `now` fields; run them against your implementation
 *                             to claim conformance.
 *   conformanceManifest    — structured object describing conformance levels
 *                             (L1 schema-valid, L2 status vectors, L3 merge
 *                             vectors), which files satisfy each, and the
 *                             schemaVersion/statusFunctionVersion it applies
 *                             to. Parsed from conformance/manifest.json.
 *                             Distinct from testVectors: this describes what
 *                             passing means, testVectors is the raw fixtures.
 *
 * Bundled implementation (lib/) — the prose spec is normative; this code is a
 * conforming, dependency-free implementation so the format is usable without
 * any particular vendor's library:
 *   deriveClaimStatus      — status-function.md, one claim → { status, policyId }
 *   deriveStatuses         — whole bundle → { claimId: status }
 *   mergeBundles           — merge.md §5/§6; throws on claim collisions
 *   mergeBundlesDetailed   — merge.md; returns { bundle, collisions }
 *   canonicalize           — RFC 8785 (JCS) serialization (merge.md §6, SECURITY.md)
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, basename } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export { deriveClaimStatus, deriveStatuses, resolvePolicy } from './lib/derive.mjs';
export { mergeBundles, mergeBundlesDetailed } from './lib/merge.mjs';
export { canonicalize } from './lib/canonicalize.mjs';

// ---------------------------------------------------------------------------
// Spec-side declaration of the status function version.
// Any implementation claiming conformance at this version must produce the
// same status outputs as the test vectors for all cases in conformance/.
// ---------------------------------------------------------------------------
export const statusFunctionVersion = '2';

// ---------------------------------------------------------------------------
// Schemas — Map of record name (filename without .schema.json) → parsed JSON.
// ---------------------------------------------------------------------------
function loadSchemas() {
  const schemasDir = join(__dirname, 'schemas');
  const map = new Map();
  for (const file of readdirSync(schemasDir).sort()) {
    if (!file.endsWith('.schema.json')) continue;
    const name = file.replace(/\.schema\.json$/, '');
    map.set(name, JSON.parse(readFileSync(join(schemasDir, file), 'utf8')));
  }
  return map;
}

export const schemas = loadSchemas();

// ---------------------------------------------------------------------------
// Test vectors — Array of { name, vector } loaded from conformance/*.json.
// Each vector: { now, input, expect: { statusByClaimId } }
// ---------------------------------------------------------------------------
function loadTestVectors() {
  const conformanceDir = join(__dirname, 'conformance');
  const vectors = [];
  for (const file of readdirSync(conformanceDir).sort()) {
    // manifest.json is structured metadata (see conformanceManifest below),
    // not a { now, input, expect } test vector — excluded here.
    if (!file.endsWith('.json') || file === 'manifest.json') continue;
    const name = basename(file, '.json');
    const vector = JSON.parse(readFileSync(join(conformanceDir, file), 'utf8'));
    vectors.push({ name, vector });
  }
  return vectors;
}

export const testVectors = loadTestVectors();

// ---------------------------------------------------------------------------
// Conformance manifest — structured levels/requirements, distinct from the
// raw testVectors list above. See conformance/manifest.json and
// conformance/README.md for the human-readable pointer.
// ---------------------------------------------------------------------------
function loadConformanceManifest() {
  const manifestPath = join(__dirname, 'conformance', 'manifest.json');
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

export const conformanceManifest = loadConformanceManifest();
