#!/usr/bin/env node
/**
 * hachure — CLI for the open trust format.
 *
 *   hachure derive <bundle.json> [--now <RFC 3339 date-time>] [--status-function-version <v>] [--no-validate]
 *       Derive per-claim statuses from a TrustBundle (status-function.md),
 *       under the current statusFunctionVersion unless another supported one
 *       is named. --now is the evaluation instant: under version "4" an RFC
 *       3339 date-time with an offset (e.g. 2026-06-10T00:00:00Z), read
 *       exactly; under "3" and "2" whatever Date.parse reads. Default: the
 *       current time. deriveStatuses does not validate its input, so this command
 *       checks the bundle first and refuses one that fails (exit 1):
 *         1. Always: the built-in checkBasisInvariants (inconclusive evidence
 *            is cited with no passing; schemaVersion 9 fields are declared).
 *         2. When ajv can be loaded: full schema validation, as `hachure
 *            validate` does. This package does not depend on ajv; it is used
 *            when resolvable from this package's own install location (the
 *            same node_modules). When it is not, the command derives after
 *            step 1 and warns once on stderr that step 2 was skipped.
 *       --no-validate skips both checks, with a warning.
 *
 *   hachure diff <before.json> <after.json> [--now <RFC 3339 date-time>] [--no-validate]
 *       Report status transitions between two bundles. Both are checked
 *       first, under the same rules as derive.
 *
 *   hachure merge <a.json> <b.json> [...more] [--detailed]
 *       Merge bundles (merge.md). --detailed reports collisions instead of
 *       throwing on claim collisions.
 *
 *   hachure validate <bundle.json>
 *       Validate a TrustBundle against the normative schemas (requires ajv:
 *       npm i ajv), plus the schemaVersion 8 conclusionConfidence checks JSON
 *       Schema cannot express.
 *
 *   hachure vectors [--status-function-version <v>]
 *       Run every conformance vector against the bundled implementation and
 *       report pass/fail — the self-conformance proof. Runs the vectors that
 *       apply to the current statusFunctionVersion unless another supported
 *       one is named.
 */

import { readFileSync } from 'node:fs';

import {
  statusFunctionVersion,
  supportedStatusFunctionVersions,
  schemas,
  testVectors,
  deriveStatuses,
  diffStatuses,
  mergeBundles,
  mergeBundlesDetailed,
  validateConclusionConfidence,
  checkBasisInvariants,
  parseTimestamp,
} from '../index.mjs';

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    fail(`could not read ${path}: ${err.message}`);
  }
}

function fail(message) {
  console.error(`hachure: ${message}`);
  process.exit(1);
}

function takeFlag(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const [, value] = args.splice(i, 2);
  if (value === undefined || value.startsWith('--')) fail(`${name} requires a value`);
  return value;
}

function takeSwitch(args, name) {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
}

/** Refuse anything left over once the expected positionals are taken. */
function rejectStray(args, expected, usage) {
  const stray = [...args.filter((a) => a.startsWith('--')), ...args.filter((a) => !a.startsWith('--')).slice(expected)];
  if (stray.length > 0) fail(`usage: ${usage} (unexpected: ${stray.join(' ')})`);
}

function takeVersionFlag(args) {
  const version = takeFlag(args, '--status-function-version') ?? statusFunctionVersion;
  if (!supportedStatusFunctionVersions.includes(version)) {
    fail(`unsupported --status-function-version ${version}; supported: ${supportedStatusFunctionVersions.join(', ')}`);
  }
  return version;
}

/**
 * Schema errors for a bundle, then the cross-field rules JSON Schema cannot
 * express. Returns undefined when ajv is not installed.
 */
async function bundleErrors(bundle) {
  let Ajv;
  try {
    ({ default: Ajv } = await import('ajv/dist/2020.js'));
  } catch {
    return undefined;
  }
  const ajv = new Ajv({ strict: false, allErrors: true, logger: false });
  for (const schema of schemas.values()) ajv.addSchema(schema);
  const validate = ajv.getSchema(schemas.get('trust-bundle').$id);
  return validate(bundle) ? validateConclusionConfidence(bundle) : validate.errors;
}

function reportInvalid(errors, path) {
  console.error(path ? `invalid TrustBundle (${path}):` : 'invalid TrustBundle:');
  for (const e of errors) console.error(`  ${e.instancePath || '/'} ${e.message}`);
  process.exit(1);
}

let warnedNoAjv = false;

/**
 * Gate for commands that derive status. deriveStatuses does not validate, so
 * the CLI, as its caller, does (status-function.md): the built-in invariant
 * check always, full schema validation when ajv can be loaded.
 */
async function requireValidBundle(bundle, path, noValidate) {
  if (noValidate) {
    console.error(`hachure: warning: --no-validate: ${path} was not checked; derived statuses are not reliable for an invalid bundle`);
    return;
  }
  const violations = checkBasisInvariants(bundle);
  if (violations.length > 0) {
    console.error(`hachure: refusing to derive from ${path}:`);
    for (const e of violations) console.error(`  ${e.instancePath || '/'} ${e.message}`);
    process.exit(1);
  }
  const errors = await bundleErrors(bundle);
  if (errors === undefined) {
    if (!warnedNoAjv) {
      warnedNoAjv = true;
      console.error(
        'hachure: warning: full schema validation was skipped because ajv could not be loaded; only the built-in ' +
          "inconclusive-evidence check ran. To enable full validation, ajv must be resolvable from hachure's own " +
          'install location (installed into the same node_modules as hachure).'
      );
    }
    return;
  }
  if (errors.length > 0) reportInvalid(errors, path);
}

/**
 * The least a bundle needs for a derived result to be printable: an object
 * whose claims are objects with string ids. Applies even under --no-validate,
 * where nothing else has looked at the bundle.
 */
function requireDerivableShape(bundle, path) {
  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isObject(bundle)) fail(`${path} is not a TrustBundle: expected a JSON object`);
  if (!Array.isArray(bundle.claims)) fail(`${path} is not a TrustBundle: claims must be an array`);
  bundle.claims.forEach((claim, i) => {
    if (!isObject(claim)) fail(`${path} is not a TrustBundle: claims[${i}] must be an object`);
    if (typeof claim.id !== 'string' || claim.id === '') fail(`${path} is not a TrustBundle: claims[${i}] has no id`);
  });
}

/** Run a derivation, turning a throw on a malformed bundle into a CLI error. */
function deriving(fn) {
  try {
    return fn();
  } catch (err) {
    fail(`could not derive: ${err.message}`);
  }
}

/**
 * Parse --now. Under version "4" the value must be a timestamp as that version
 * defines one (RFC 3339 date-time) and is passed through as written, so it is
 * read exactly; under "2" and "3" it is read as those versions read it.
 */
function parseNow(nowArg, version, canSelectVersion = false) {
  if (nowArg === undefined) return new Date();
  const hint = /\.json$/i.test(nowArg) ? ' (--now takes a timestamp; the file path after it was read as its value)' : '';
  if (version === '4') {
    if (parseTimestamp(nowArg) === undefined) {
      fail(
        `invalid --now value: ${JSON.stringify(nowArg)}: expected an RFC 3339 date-time with an offset, e.g. 2026-06-10T00:00:00Z` +
          (canSelectVersion ? ' (or pass --status-function-version 3 to read it as version 3 does)' : '') +
          hint
      );
    }
    return nowArg;
  }
  const now = new Date(nowArg);
  if (nowArg === '' || Number.isNaN(now.getTime())) fail(`invalid --now value: ${JSON.stringify(nowArg)}${hint}`);
  return now;
}

const evaluatedAt = (now) => (typeof now === 'string' ? now : now.toISOString());

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'derive': {
    const nowArg = takeFlag(args, '--now');
    const version = takeVersionFlag(args);
    const noValidate = takeSwitch(args, '--no-validate');
    const usage = 'hachure derive <bundle.json> [--now <RFC 3339 date-time with offset>] [--status-function-version <v>] [--no-validate]';
    const now = parseNow(nowArg, version, true);
    const [path] = args;
    if (!path) fail(`usage: ${usage}`);
    rejectStray(args, 1, usage);
    const bundle = readJson(path);
    await requireValidBundle(bundle, path, noValidate);
    requireDerivableShape(bundle, path);
    const statusByClaimId = deriving(() => deriveStatuses(bundle, now, { statusFunctionVersion: version }));
    console.log(
      JSON.stringify(
        {
          statusFunctionVersion: version,
          evaluatedAt: evaluatedAt(now),
          statusByClaimId,
        },
        null,
        2
      )
    );
    break;
  }

  case 'diff': {
    const nowArg = takeFlag(args, '--now');
    const noValidate = takeSwitch(args, '--no-validate');
    const usage = 'hachure diff <before.json> <after.json> [--now <RFC 3339 date-time with offset>] [--no-validate]';
    const now = parseNow(nowArg, statusFunctionVersion);
    const [beforePath, afterPath] = args;
    if (!beforePath || !afterPath) fail(`usage: ${usage}`);
    rejectStray(args, 2, usage);
    const before = readJson(beforePath);
    const after = readJson(afterPath);
    await requireValidBundle(before, beforePath, noValidate);
    await requireValidBundle(after, afterPath, noValidate);
    requireDerivableShape(before, beforePath);
    requireDerivableShape(after, afterPath);
    const { transitions, unchanged } = deriving(() => diffStatuses(before, after, now));
    const changed = Object.keys(transitions).length;
    for (const [claimId, { from, to }] of Object.entries(transitions)) {
      console.error(`  ${claimId}: ${from ?? '(absent)'} -> ${to ?? '(absent)'}`);
    }
    console.log(
      JSON.stringify(
        { statusFunctionVersion, evaluatedAt: evaluatedAt(now), transitions, unchanged },
        null,
        2
      )
    );
    console.error(changed === 0 ? `no transitions (${unchanged} unchanged)` : `${changed} transition(s), ${unchanged} unchanged`);
    // Exit 3 on transitions so the command works as a scriptable gate;
    // 0 means "nothing changed", like diff(1)'s 0-means-same convention.
    if (changed > 0) process.exit(3);
    break;
  }

  case 'merge': {
    const detailed = takeSwitch(args, '--detailed');
    const paths = args;
    const usage = 'hachure merge <a.json> <b.json> [...more] [--detailed]';
    if (paths.length < 2) fail(`usage: ${usage}`);
    rejectStray(args, Infinity, usage);
    const bundles = paths.map(readJson);
    if (detailed) {
      console.log(JSON.stringify(mergeBundlesDetailed(bundles), null, 2));
    } else {
      try {
        console.log(JSON.stringify(mergeBundles(bundles), null, 2));
      } catch (err) {
        fail(err.message);
      }
    }
    break;
  }

  case 'validate': {
    const [path] = args;
    if (!path) fail('usage: hachure validate <bundle.json>');
    rejectStray(args, 1, 'hachure validate <bundle.json>');
    const bundle = readJson(path);
    const errors = await bundleErrors(bundle);
    if (errors === undefined) fail('validate requires ajv — install it with: npm i ajv');
    if (errors.length > 0) reportInvalid(errors);
    console.log(`valid TrustBundle (schemaVersion ${bundle.schemaVersion})`);
    break;
  }

  case 'vectors': {
    const version = takeVersionFlag(args);
    if (args.length > 0) fail(`usage: hachure vectors [--status-function-version <v>] (unexpected: ${args.join(' ')})`);
    let failed = 0;
    let run = 0;
    for (const { name, vector } of testVectors) {
      // A vector without statusFunctionVersions holds for every version.
      if (vector.statusFunctionVersions && !vector.statusFunctionVersions.includes(version)) {
        console.log(`  SKIP ${name} (applies to statusFunctionVersion ${vector.statusFunctionVersions.join(', ')})`);
        continue;
      }
      run++;
      const derived = deriveStatuses(vector.input, new Date(vector.now), { statusFunctionVersion: version });
      const mismatches = Object.entries(vector.expect.statusByClaimId).filter(
        ([claimId, expected]) => derived[claimId] !== expected
      );
      if (mismatches.length === 0) {
        console.log(`  PASS ${name}`);
      } else {
        failed++;
        for (const [claimId, expected] of mismatches) {
          console.error(`  FAIL ${name} / ${claimId}: expected ${expected}, derived ${derived[claimId]}`);
        }
      }
    }
    console.log(
      failed === 0
        ? `all ${run} applicable vectors pass (statusFunctionVersion "${version}")`
        : `${failed} vector(s) failed`
    );
    if (failed > 0) process.exit(1);
    break;
  }

  default:
    console.error(
      'usage: hachure <derive|diff|merge|validate|vectors> [...]\n' +
        '  derive <bundle.json> [--now <ISO>] [--status-function-version <v>] [--no-validate]\n' +
        '                                               check, then derive per-claim statuses\n' +
        '  diff <before.json> <after.json> [--now <ISO>] [--no-validate]\n' +
        '                                               check both, then report status transitions (exit 3 if any)\n' +
        '  merge <a.json> <b.json> [...] [--detailed]   merge producer bundles\n' +
        '  validate <bundle.json>                       schema-validate a bundle\n' +
        '  vectors [--status-function-version <v>]      run conformance vectors'
    );
    process.exit(command ? 1 : 0);
}
