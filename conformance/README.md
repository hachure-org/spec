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

## Test vector format

```json
{
  "now": "<ISO 8601 string>",
  "input": { /* TrustBundle */ },
  "expect": {
    "statusByClaimId": { "<claimId>": "<TrustStatus>" }
  }
}
```

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
