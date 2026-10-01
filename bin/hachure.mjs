#!/usr/bin/env node
/**
 * hachure — CLI for the open trust format.
 *
 *   hachure derive <bundle.json> [--now <ISO timestamp>] [--status-function-version <v>] [--no-validate]
 *       Derive per-claim statuses from a TrustBundle (status-function.md),
 *       under the current statusFunctionVersion unless another supported one
 *       is named. The bundle is validated first, as `hachure validate` does,
 *       and an invalid bundle is refused (exit 1): the function does not
 *       validate its own input. Validation needs ajv (npm i ajv), which this
 *       package does not depend on. If ajv cannot be loaded the command
 *       refuses to derive (exit 1) unless --no-validate is given; with that
 *       flag it derives unvalidated and says so on stderr.
 *
 *   hachure diff <before.json> <after.json> [--now <ISO timestamp>] [--no-validate]
 *       Report status transitions between two bundles. Both are validated
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

/**
 * Gate for commands that derive status: deriveStatuses does not validate, so
 * the CLI, as its caller, does (status-function.md). Fails closed when the
 * validator cannot be loaded; --no-validate is the only way past that.
 */
async function requireValidBundle(bundle, path, noValidate) {
  if (noValidate) {
    console.error(`hachure: warning: --no-validate: ${path} was not validated; derived statuses are not reliable for an invalid bundle`);
    return;
  }
  const errors = await bundleErrors(bundle);
  if (errors === undefined) {
    fail('cannot validate the bundle: ajv is not installed (npm i ajv). Refusing to derive from an unvalidated bundle; pass --no-validate to derive anyway');
  }
  if (errors.length > 0) reportInvalid(errors, path);
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'derive': {
    const nowArg = takeFlag(args, '--now');
    const version = takeVersionFlag(args);
    const noValidate = takeSwitch(args, '--no-validate');
    const usage = 'hachure derive <bundle.json> [--now <ISO timestamp>] [--status-function-version <v>] [--no-validate]';
    const [path] = args;
    if (!path) fail(`usage: ${usage}`);
    rejectStray(args, 1, usage);
    const now = nowArg ? new Date(nowArg) : new Date();
    if (Number.isNaN(now.getTime())) fail(`invalid --now value: ${nowArg}`);
    const bundle = readJson(path);
    await requireValidBundle(bundle, path, noValidate);
    console.log(
      JSON.stringify(
        {
          statusFunctionVersion: version,
          evaluatedAt: now.toISOString(),
          statusByClaimId: deriveStatuses(bundle, now, { statusFunctionVersion: version }),
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
    const usage = 'hachure diff <before.json> <after.json> [--now <ISO timestamp>] [--no-validate]';
    const [beforePath, afterPath] = args;
    if (!beforePath || !afterPath) fail(`usage: ${usage}`);
    rejectStray(args, 2, usage);
    const now = nowArg ? new Date(nowArg) : new Date();
    if (Number.isNaN(now.getTime())) fail(`invalid --now value: ${nowArg}`);
    const before = readJson(beforePath);
    const after = readJson(afterPath);
    await requireValidBundle(before, beforePath, noValidate);
    await requireValidBundle(after, afterPath, noValidate);
    const { transitions, unchanged } = diffStatuses(before, after, now);
    const changed = Object.keys(transitions).length;
    for (const [claimId, { from, to }] of Object.entries(transitions)) {
      console.error(`  ${claimId}: ${from ?? '(absent)'} -> ${to ?? '(absent)'}`);
    }
    console.log(
      JSON.stringify(
        { statusFunctionVersion, evaluatedAt: now.toISOString(), transitions, unchanged },
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
    const detailed = args.includes('--detailed');
    const paths = args.filter((a) => a !== '--detailed');
    if (paths.length < 2) fail('usage: hachure merge <a.json> <b.json> [...more] [--detailed]');
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
        '                                               validate, then derive per-claim statuses\n' +
        '  diff <before.json> <after.json> [--now <ISO>] [--no-validate]\n' +
        '                                               validate both, then report status transitions (exit 3 if any)\n' +
        '  merge <a.json> <b.json> [...] [--detailed]   merge producer bundles\n' +
        '  validate <bundle.json>                       schema-validate a bundle\n' +
        '  vectors [--status-function-version <v>]      run conformance vectors'
    );
    process.exit(command ? 1 : 0);
}
