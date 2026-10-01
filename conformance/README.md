# Spec Conformance Test vectors

This directory contains input bundles and expected per-claim statuses that make
the [Status Derivation specification](../status-function.md) executable.

**Machine-readable conformance manifest:** [`manifest.json`](manifest.json)
(also exported as `conformanceManifest` from the package root) is a
structured index of what an implementation must pass to claim conformance at
each level (L1 schema-valid records, L2 status-derivation vectors, L3 merge
vectors) — distinct from, and more structured than, the raw vector inventory
below. Read it, or run:

```js
import { conformanceManifest } from 'hachure';
console.log(conformanceManifest.levels);
```

Each test vector is a JSON file with an `input` (a valid TrustBundle) and an `expect`
object listing expected per-claim statuses at a fixed `now` timestamp. The package's own
suite runs every vector against the bundled implementation
(`test/derive.conformance.test.mjs`, `test/merge.conformance.test.mjs`) — the
spec passes its own vectors in-repo; independent implementations run the same
vectors via the `testVectors` export or `npx hachure vectors`.

## Test vector inventory

| File | Scenario | Now |
|---|---|---|
| `sf-verified-commit.json` | Commit-scoped policy — verified when integrity ref matches | 2026-06-10T00:00:00.000Z |
| `sf-stale-duration.json` | Duration policy — stale when window expired | 2026-06-10T00:00:00.000Z |
| `sf-disputed-blocking.json` | Verified event + blocking contradicting evidence → disputed | 2026-06-10T00:00:00.000Z |
| `sf-authority-resolved.json` | Disputed claim resolved by authority-gated event | 2026-06-10T00:00:00.000Z |
| `sf-reference-bundle-snapshot.json` | Full multi-claim reference bundle at fixed now — four claims | 2026-06-10T00:00:00.000Z |
| `sf-expired-window.json` | Claim-intrinsic validity window — stale past `expiresAt` and past `ttlSeconds` (schema 4) | 2026-06-10T00:00:00.000Z |
| `sf-revoked-event.json` | Explicit invalidation event (`status: revoked`, `type: invalidation`) → stale (schema 4) | 2026-06-10T00:00:00.000Z |
| `sf-no-freshness-fields.json` | No freshness fields present → derives unchanged from `statusFunctionVersion` `1` | 2026-06-10T00:00:00.000Z |
| `sf-runtime-observation-required.json` | Runtime-observation policy — test output alone leaves the requirement unmet; live observation satisfies it | 2026-06-10T00:00:00.000Z |
| `sf-v3-no-policy.json` | v3: no resolvable policy — a verified event, and an authority-gated resolution to verified, derive `proposed` | 2026-06-10T00:00:00.000Z |
| `sf-v3-dangling-policy-id.json` | v3: `verificationPolicyId` names no policy — no fallback to a matching `claimType` policy → `proposed` | 2026-06-10T00:00:00.000Z |
| `sf-v3-empty-requirement.json` | v3: a policy with no `requiredEvidence` and no `requiredMethods` is no policy → `proposed`; with no events and no evidence → `unknown` | 2026-06-10T00:00:00.000Z |
| `sf-v3-check-evidence-result.json` | v3: check evidence with `passing` absent, or a non-blocking `passing: false`, satisfies no requirement and does not corroborate → `proposed` | 2026-06-10T00:00:00.000Z |
| `sf-v3-unevaluable-validity.json` | v3: `commit` rule with no `currentIntegrityRef` → `stale`; `duration` rule with no `durationDays` → `stale`; an unparseable `expiresAt` → `stale`; `ttlSeconds` or a `duration` rule against an unparseable `verifiedAt` → `stale`; `historical` stays `verified` | 2026-06-10T00:00:00.000Z |
| `sf-v3-blocking-before-requirements.json` | v3: a blocking failure that also leaves a requirement unmet → `disputed`, not `proposed` | 2026-06-10T00:00:00.000Z |
| `sf-v3-invalidation-nonterminal.json` | v3: a `type: "invalidation"` event whose status is not terminal (`verified`, `assumed`) → `stale`; a terminal status (`rejected`) passes through | 2026-06-10T00:00:00.000Z |
| `sf-authority-window-instants.json` | Step 1 authority window compares instants: `revokedAt`, `validFrom` and `validUntil` written with a UTC offset or without milliseconds, each in a case a string comparison accepts wrongly and a case it refuses wrongly | 2026-06-10T00:00:00.000Z |
| `sf-unparseable-event-time.json` | An event whose `createdAt` is not a parseable timestamp sorts as the oldest event, whatever its position in the `events` array | 2026-06-10T00:00:00.000Z |
| `sf-inconclusive-evidence.json` | Inconclusive evidence (schema 9): a verified claim stays `verified`; an attempt alone, with or without a policy, derives `unknown` (Steps 6 and 7 read entailing evidence only); an attempt of the required type leaves the requirement unmet → `proposed`; an attempt does not corroborate → `proposed`; an attempt carrying the current `integrityRef` anchors no `commit` rule → `stale` | 2026-06-10T00:00:00.000Z |
| `sf-basis-fields-inert.json` | `inconclusive`, `collectedByKind`, `metadata.sourceOfRecord` and `metadata.estimate` present on claims deriving `verified`, `disputed`, `proposed` and `unknown`; the package's suite re-derives with the fields stripped and asserts identical statuses | 2026-06-10T00:00:00.000Z |
| `sf-v3-unparseable-authority-bound.json` | v3: an authority trace whose `revokedAt`, `validFrom` or `validUntil` is not a parseable timestamp, or a bounded trace against a resolution event whose `createdAt` is not one, is not active → the resolution is not honoured | 2026-06-10T00:00:00.000Z |
| `sf-v3-derivation-ceiling.json` | v3: derivation ceiling and status ordering — rejected below unknown, disputed below superseded, stale below unknown, missing input → `unknown`, transitive through `derivationEdges` | 2026-06-10T00:00:00.000Z |

## Test vector format

```json
{
  "now": "<ISO 8601 string>",
  "statusFunctionVersions": ["3"],
  "input": { /* TrustBundle */ },
  "expect": {
    "statusByClaimId": { "<claimId>": "<TrustStatus>" }
  }
}
```

`statusFunctionVersions` is optional. When present, the vector's expectations
hold only for the listed status function versions, and an implementation of
another version skips it. When absent, the vector holds for every version. The
`sf-v3-*` vectors list `["3"]`; the package's own suite also checks that each of
them derives differently under version `"2"`, so each one exercises a rule that
changed.

### Vectors with timestamps that are not date-times

`sf-unparseable-event-time`, `sf-v3-unparseable-authority-bound` and
`sf-v3-unevaluable-validity` carry values such as `"not-a-timestamp"` in
`date-time` fields, because the status function defines what happens to them.
JSON Schema 2020-12 treats `format` as an annotation by default, and these
inputs validate under that default (as this package's own suite checks). A
validator configured to assert `format` rejects them; run these vectors with
format assertion off. A negative `ttlSeconds` and an unknown validity-rule
`kind` are rejected by the schemas regardless, so they cannot appear in a
vector; the status function still defines them (both derive `stale` under
version `"3"`) and this package's unit tests cover them.

## Merge conformance vectors

`conformance/merge/` contains a second, distinct family of vectors that make
the [Identifier & Multi-Producer Merge Semantics specification](../merge.md)
executable. Each vector merges two or more input `TrustBundle`s and asserts
the merged claim-id set, any id collisions, and the per-claim status derived
independently on the merged bundle. This repo's `npm test` covers both layers: `test/merge.test.mjs`
validates vector *shape* and Ajv-validates every `inputs[]` entry against
`trust-bundle.schema.json`, and `test/merge.conformance.test.mjs` executes the
bundled `mergeBundlesDetailed`/`deriveStatuses` against every vector under
every permutation of the input bundles (merge.md §6).

### Merge test vector inventory

| File | Scenario | Now |
|---|---|---|
| `merge-agree-values.json` | Two producers' claims agree on the same canonical subject+field; both retained as distinct records, both derive their own status independently | 2026-06-10T00:00:00.000Z |
| `merge-conflict-value.json` | Two producers' claims disagree on value, governed by a shared `incompatibleValues` policy; both retained, statuses computed independently | 2026-06-10T00:00:00.000Z |
| `merge-conflict-status.json` | Producer A's claim reaches `disputed` via its own blocking evidence; producer B's claim independently reaches `verified` — merge does not let one overwrite or suppress the other | 2026-06-10T00:00:00.000Z |
| `merge-collision-order-independence.json` | Three bundles; one `Claim.id` shared by two with genuinely different content (accidental collision) plus one unrelated bundle; asserts the merge result (kept content + collisions) is identical for every permutation of `inputs` | 2026-06-10T00:00:00.000Z |

### Merge test vector format

```json
{
  "now": "<ISO 8601 string>",
  "inputs": [ /* TrustBundle, TrustBundle, ... */ ],
  "expect": {
    "mergedClaimIds": ["<id>", "..."],
    "collisions": [{ "collection": "claims", "id": "<id>" }],
    "statusByClaimId": { "<claimId>": "<TrustStatus>" }
  }
}
```
