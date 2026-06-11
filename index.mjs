/**
 * hachure — canonical npm distribution of the Hachure trust format spec.
 *
 * Exports:
 *   STATUS_FUNCTION_VERSION  — spec-side declaration of the current status
 *                               derivation algorithm version. Reference
 *                               implementations must export a matching value.
 *   schemas                  — Map<recordName, parsedSchemaObject> for every
 *                               normative schema shipped with this package.
 *   testVectors              — Array<{name, vector}> of all conformance test
 *                               vectors. Each vector has `input`, `expect`, and
 *                               `now` fields; run them against your implementation
 *                               to claim conformance.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname, basename } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Spec-side declaration of the status function version.
// Any implementation claiming conformance at this version must produce the
// same status outputs as the test vectors for all cases in conformance/.
// ---------------------------------------------------------------------------
export const STATUS_FUNCTION_VERSION = '1';

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
    if (!file.endsWith('.json')) continue;
    const name = basename(file, '.json');
    const vector = JSON.parse(readFileSync(join(conformanceDir, file), 'utf8'));
    vectors.push({ name, vector });
  }
  return vectors;
}

export const testVectors = loadTestVectors();
