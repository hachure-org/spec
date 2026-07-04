#!/usr/bin/env node
/**
 * hachure — CLI for the open trust format.
 *
 *   hachure derive <bundle.json> [--now <ISO timestamp>]
 *       Derive per-claim statuses from a TrustBundle (status-function.md).
 *
 *   hachure merge <a.json> <b.json> [...more] [--detailed]
 *       Merge bundles (merge.md). --detailed reports collisions instead of
 *       throwing on claim collisions.
 *
 *   hachure validate <bundle.json>
 *       Validate a TrustBundle against the normative schemas (requires ajv:
 *       npm i ajv).
 *
 *   hachure vectors
 *       Run every conformance vector against the bundled implementation and
 *       report pass/fail — the self-conformance proof.
 */

import { readFileSync } from 'node:fs';

import {
  statusFunctionVersion,
  schemas,
  testVectors,
  deriveStatuses,
  diffStatuses,
  mergeBundles,
  mergeBundlesDetailed,
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
  return value;
}

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'derive': {
    const nowArg = takeFlag(args, '--now');
    const [path] = args;
    if (!path) fail('usage: hachure derive <bundle.json> [--now <ISO timestamp>]');
    const now = nowArg ? new Date(nowArg) : new Date();
    if (Number.isNaN(now.getTime())) fail(`invalid --now value: ${nowArg}`);
    const bundle = readJson(path);
    console.log(
      JSON.stringify(
        {
          statusFunctionVersion,
          evaluatedAt: now.toISOString(),
          statusByClaimId: deriveStatuses(bundle, now),
        },
        null,
        2
      )
    );
    break;
  }

  case 'diff': {
    const nowArg = takeFlag(args, '--now');
    const [beforePath, afterPath] = args;
    if (!beforePath || !afterPath) fail('usage: hachure diff <before.json> <after.json> [--now <ISO timestamp>]');
    const now = nowArg ? new Date(nowArg) : new Date();
    if (Number.isNaN(now.getTime())) fail(`invalid --now value: ${nowArg}`);
    const { transitions, unchanged } = diffStatuses(readJson(beforePath), readJson(afterPath), now);
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
    let Ajv;
    try {
      ({ default: Ajv } = await import('ajv/dist/2020.js'));
    } catch {
      fail('validate requires ajv — install it with: npm i ajv');
    }
    const ajv = new Ajv({ strict: false, allErrors: true, logger: false });
    for (const schema of schemas.values()) ajv.addSchema(schema);
    const validate = ajv.getSchema(schemas.get('trust-bundle').$id);
    if (validate(bundle)) {
      console.log(`valid TrustBundle (schemaVersion ${bundle.schemaVersion})`);
    } else {
      console.error('invalid TrustBundle:');
      for (const e of validate.errors) console.error(`  ${e.instancePath || '/'} ${e.message}`);
      process.exit(1);
    }
    break;
  }

  case 'vectors': {
    let failed = 0;
    for (const { name, vector } of testVectors) {
      const derived = deriveStatuses(vector.input, new Date(vector.now));
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
        ? `all ${testVectors.length} vectors pass (statusFunctionVersion "${statusFunctionVersion}")`
        : `${failed} vector(s) failed`
    );
    if (failed > 0) process.exit(1);
    break;
  }

  default:
    console.error(
      'usage: hachure <derive|diff|merge|validate|vectors> [...]\n' +
        '  derive <bundle.json> [--now <ISO>]           derive per-claim statuses\n' +
        '  diff <before.json> <after.json> [--now <ISO>] report status transitions (exit 3 if any)\n' +
        '  merge <a.json> <b.json> [...] [--detailed]   merge producer bundles\n' +
        '  validate <bundle.json>                       schema-validate a bundle\n' +
        '  vectors                                      run conformance vectors'
    );
    process.exit(command ? 1 : 0);
}
