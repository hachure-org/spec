# Contributing

> **DRAFT — pending owner review.** This document is a first-pass process
> description drafted as part of the 0.8.0 standalone-credibility delivery.
> It has not yet been reviewed or ratified by the project owner. Treat it as
> a proposal, not a settled process.

Thanks for considering a contribution to Hachure. This repository
(`hachure-org/spec`) is the canonical home of the specification: prose,
normative JSON Schemas, and conformance test vectors. See
[GOVERNANCE.md](GOVERNANCE.md) for who currently has decision authority and
how that is expected to evolve.

## Before you open a PR

**Read [README.md](README.md) first.** It defines the core record shapes,
status semantics, and namespace/versioning policy this repo is built around.
Most proposed changes should be framed against that existing model, not
around it.

**Know which kind of change you're making:**

- **A wire-format change** (a new/changed field in any `schemas/*.schema.json`,
  a new required field, a `schemaVersion` bump) — see "Design-doc expectation"
  below. This project is pre-1.0 and uses **hard breaking changes, not
  compatibility aliases** (README.md §"Namespace and versioning"). A breaking
  schema change is a legitimate kind of PR here, but it needs to be
  deliberate and documented, not incidental.
- **A semantics change** (anything in `status-function.md`, `merge.md`) that
  could change what status a conforming implementation derives for the same
  inputs — this requires a `statusFunctionVersion` bump and new/updated
  conformance vectors proving the new behavior (see "Conformance vectors are
  mandatory" below).
- **A profile change** (`assurance.md`, `interop-in-toto.md`,
  `verification-endpoint.md`) — profiles are optional extensions; changes
  here should not force a change to core record shapes or the status
  function (README.md §"Profiles").
- **A prose/docs-only change** (this file, `SECURITY.md`, typo fixes,
  clarifications that don't change normative meaning) — lighter weight, no
  design doc expected.

## Design-doc expectation for normative changes

This repository's own history (see the two prior deliveries referenced in
`.kontourai/` planning artifacts, and this delivery itself) follows a
pattern of a `plan.md`/design document preceding normative spec changes,
recording the rationale, blast radius, and acceptance criteria before code
lands. Contributors proposing a normative wire-format or semantics change are
expected to include, in the PR description at minimum:

- **What changes** — the specific schema/prose diff.
- **Why** — what problem this solves that the current format cannot express.
- **Blast radius** — which existing conformance vectors, if any, need
  updating; whether any downstream producer's data would need to change.
- **Version impact** — whether this requires a `schemaVersion` and/or
  `statusFunctionVersion` bump (see README.md §"Namespace and versioning").

A full standalone ADR is not required for every change — proportion the
writeup to the size of the change. A one-field additive change needs a
paragraph; a claim-identity or merge-semantics change needs the fuller
treatment `merge.md` itself received.

## Conformance vectors are mandatory for behavior changes

Any change to `status-function.md` or `merge.md` that could alter derived
output for some input MUST land with new or updated conformance vectors in
`conformance/` (single-bundle) or `conformance/merge/` (multi-bundle) proving
the new behavior, and MUST bump `statusFunctionVersion` if the change affects
single-claim derivation. `npm test` validates vector *shape* against the
schemas in this repo; it does not execute the derivation/merge algorithms
(that happens in `@kontourai/surface`) — a PR here is not "done" until the
reference implementation's own test run against the new vectors is either
included or explicitly called out as a follow-up.

## Schema changes

- Edit the relevant `schemas/*.schema.json` file directly. Do not
  hand-edit `$id`s inconsistently — the 8 schema files' `$id`s reference
  each other by bare filename relative to their own `$id` base
  (`https://hachure.org/schemas/`); changing one file's `$id` without
  changing all of them breaks Ajv `$ref` resolution (see the schema-migration
  history in `.kontourai/flow-agents/hachure-standalone-extraction/plan.md`
  for the empirical proof, if you need the details).
- Run `npm test` before opening a PR. `test/schemas.ajv.test.mjs` Ajv-compiles
  every schema with its siblings registered and validates every conformance
  vector against the tightened schema.

## Pull request checklist

- [ ] `npm test` passes locally.
- [ ] If you changed `status-function.md` or `merge.md`: new/updated
      conformance vectors are included, and `statusFunctionVersion` is
      bumped if single-claim derivation output could change.
- [ ] If you changed any `schemas/*.schema.json` `required` array or added a
      field: `README.md`'s "Normative schemas" / relevant record-type
      section is updated to match.
- [ ] If you added a new root-level doc file: it's added to `package.json`'s
      `files` array if it should ship in the npm tarball, and linked from
      `README.md`'s doc-index.

## Code of conduct

Not yet published as a standalone document. Until one exists, the baseline
expectation is: be direct about disagreements on technical substance, keep
discussion on the technical merits of a proposal, and assume good faith.
