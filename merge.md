# Identifier & Multi-Producer Merge Semantics — Specification

**Function:** `mergeBundles(bundles: TrustBundle[]) → TrustBundle` /
`mergeBundlesDetailed(bundles: TrustBundle[]) → { bundle: TrustBundle; collisions: MergeCollision[] }`
**Normative source:** this document. The bundled implementation is
`lib/merge.mjs` (with `lib/canonicalize.mjs` for the §6 tie-break) in the
`hachure` package, checked against `conformance/merge/` under every input
permutation.
**Conformance language:** MUST/SHOULD/MAY keywords in this document are to be interpreted per RFC 2119/BCP 14, as defined in [README.md's Conformance language section](README.md#conformance-language).

---

## 1. Principle

A Trust Bundle (README §"TrustBundle") is the supply side of the ledger, from
a single producer. Multiple producers' bundles about overlapping
subjects MUST be combinable into one ledger without:

- silently overwriting one producer's claim with another's (never
  last-write-wins),
- deleting losing evidence,
- requiring a shared identifier authority, key infrastructure, or
  pre-registration between producers.

This document specifies: how a claim's identity is compared across producers
(§4), how bundles fold into one ledger (§5), the determinism guarantee that
folding MUST satisfy (§6), how agreement/conflict/dispute are represented
(§7), and how accidental id collisions between *unrelated* records are
detected (§8).

---

## 2. Producer identity

`TrustBundle.source` (`schemas/trust-bundle.schema.json`) is a free-text
string. Real producers use it inconsistently as a human-readable label, a
run-scoped value, or both (e.g. `source: 'producer-b:${run_id}'`,
`source: 'session-log'`, `source: 'filesystem-inferred'`). `source`
alone is not a stable, comparable producer identity — it changes per
run/session for the same producer.

`TrustBundle` carries one OPTIONAL field, `producerId` (string), a stable
identifier for the *system* that produced the bundle, distinct from
`source`'s run-scoped free text:

```jsonc
{
  "schemaVersion": 5,
  "source": "producer-a:run-48213",  // unchanged: free text, may vary per run
  "producerId": "producer-a",        // OPTIONAL, new: stable across runs
  "claims": [ /* ... */ ]
}
```

Rules:

- `producerId` is OPTIONAL. A bundle without it is exactly as valid as a
  bundle that predates this field (additive; `trust-bundle.schema.json`'s
  `required` array is unchanged).
- When present, `producerId` MUST be a non-empty string
  (`trust-bundle.schema.json`'s `producerId` property carries `minLength: 1`)
  — an empty string carries no identifying information, so it is
  schema-invalid rather than treated as equivalent to omitting the field.
- When present, `producerId` SHOULD be stable across every bundle the same
  system emits, and SHOULD be used (§3) as the leading segment of that
  producer's record ids.
- `producerId` carries no cryptographic weight. It is an L0
  (producer-asserted) fact in Assurance-profile terms (`assurance.md`).
  Producers wanting a verifiable producer identity SHOULD present that
  identity via the existing Assurance L1 (OIDC-backed) or L2 (held-key)
  presentation (`assurance.md` §"Identity presentation"). This document does
  not define, and MUST NOT be read to require, any DID or key-resolution
  mechanism. Cryptographic identity is Assurance-profile territory;
  `producerId` is the plain, unsigned, always-available floor underneath it.
- On merge (§5), a merged bundle represents more than one producer, so a
  merged bundle's `producerId` MUST be omitted — it MUST NOT be synthesized
  the way `source` is (`source` becomes `merged:<a>+<b>`; `producerId` has no
  analogous synthesized form). Per-record producer attribution across a merge
  is best-effort via the id convention in §3, not a schema-enforced field on
  every record; `Claim`, `Evidence`, `VerificationPolicy`, and
  `VerificationEvent` do not each carry their own `producerId` — the
  bundle-level field plus the id convention is the complete mechanism.

---

## 3. Identifier format

`id` fields (`Claim.id`, `Evidence.id`, `VerificationPolicy.id`,
`VerificationEvent.id`, etc.) remain `{ "type": "string" }` with no `pattern`
constraint. This document introduces no schema change to any `id` field.

- Producers SHOULD mint ids as dot-separated, lowercase, URL-safe segments
  (a stable helper that lowercases, collapses non-alphanumeric runs to `-`,
  and joins segments with `.` is the recommended shape).
- Producers that set `producerId` (§2) SHOULD make the id's leading segment
  equal to `producerId` (or a short slug derived from it), e.g.
  `producerId: "producer-a"` → ids like `producer-a.recommendation.upgrade-node`.
- This is a SHOULD, not a MUST, and is never schema-enforced. A conforming
  bundle with un-prefixed ids remains fully conformant.
- Rationale for SHOULD over MUST: enforcing a producer prefix would need a
  `pattern` regex, which cannot be written today without either rejecting
  real existing ids or being so permissive it adds no safety. The prefix
  convention earns its value from making *accidental* id collisions between
  unrelated producers vanishingly unlikely (§8), not from schema enforcement.

---

## 4. Claim identity across producers

Two claims from different producers are the same logical claim (candidates
for agreement/conflict comparison, §7) **if and only if:**

1. Their subjects resolve to the same canonical key under the merged bundle's
   identity index (`IdentityIndex.canonicalKeyForClaim`) — i.e. same subject,
   or subjects declared co-referent via `identityLinks`/`subjectAliases`.
2. `canonicalClaimKey({ subjectType, subjectId, fieldOrBehavior, qualifiers })`
   is equal once (1) is applied (same `fieldOrBehavior`, same `qualifiers`
   after the existing trim/lowercase/sort normalization).

**`claimType` and `facet` are explicitly excluded from the identity key —
this is a deliberate design decision, not an oversight:**

- `claimType` is excluded because the canonical claim key is defined over
  *subject, predicate, value, qualifiers* — `fieldOrBehavior` is the
  predicate; `claimType` is a taxonomy tag, not part of the matching grammar.
  Two producers describing the same subject+field under different
  `claimType` taxonomies are still the same logical claim for merge
  purposes; reusing the canonical key means merge and Inquiry matching never
  diverge on this point.
- `facet` is excluded because it is a producer-defined grouping or
  namespace for related claims, not the primary thing users evaluate. Two
  producers will pick unrelated `facet` values for logically identical
  claims — there is no shared `facet` vocabulary across producers;
  including it in the identity key would make cross-producer matches
  essentially never fire. `facet` remains meaningful *within* one
  producer's bundle (grouping, reporting `byFacet` counts) but plays no
  role in cross-producer identity.

This means: **claims are never collapsed into one record by claim identity.**
Two producers' claims about the same canonical subject+field, even when they
fully agree, remain two distinct `Claim` records with two distinct ids in the
merged bundle (§5 unions by `id`, not by claim identity) — claim identity is
used only to decide *how to interpret* the pair (§7), never to deduplicate
them into one.

---

## 5. The merge algorithm

Given `bundles: TrustBundle[]` (all sharing one `schemaVersion` —
implementations MUST reject a merge across differing `schemaVersion` values
rather than guessing a coercion):

1. **Union every collection by `id`**: `claims`, `evidence`, `policies`,
   `events` (each item has a required `id`); `claimGroups`, `authorityTrace`
   (each item has an optional `id`; items without an `id` are always kept,
   never deduped). `identityLinks` are concatenated in full (they may omit
   `id`; a union-find-based identity index dedupes them harmlessly even when
   duplicated).
2. **First-occurrence wins content, subject to the determinism rule in §6** —
   when two records share an `id`:
   - If their content is structurally identical (deep-equal), keep it; this
     is not a collision (the same fact was reported by two bundles, e.g.
     after a re-export round-trip).
   - If their content differs, this is a **collision** (§8): the
     implementation MUST record it (`MergeCollision`: `collection`, `id`, and
     enough information to identify the contributing bundles) rather than
     silently picking one. The throwing entry point (`mergeBundles`) MUST
     throw when any **claim** collision (differing content, same `Claim.id`)
     is detected — silent claim corruption is the one thing merge MUST NOT
     ever do. The non-throwing entry point (`mergeBundlesDetailed`) MUST
     return the collisions for the caller to inspect/reconcile instead of
     throwing.
3. **`source` becomes a synthesized combination** of the distinct `source`
   values across the merged bundles (`merged:<a>+<b>`); **`producerId` MUST
   be omitted** on a merged bundle (§2). The optional `proof` block
   (`schemaVersion` 6) MUST likewise be omitted from merged output — a
   producer's signature attests that producer's bundle and does not survive
   merging with other producers' records.
4. The merged bundle is not itself a new producer assertion — it MUST be
   accepted as input to the same, unmodified status derivation
   (`status-function.md`) and to the merge function again (merge MUST be
   re-appliable to an already-merged bundle, since a bundle is a bundle
   regardless of how many producers contributed to it — no special "already
   merged" flag is introduced).

---

## 6. Determinism (order independence)

**MUST:** for any fixed *set* of input bundles, the merge function's output
(both the retained record content and the `collisions[]` set, modulo list
ordering) MUST be identical regardless of the order the bundles are supplied
in. `merge([A, B, C])`, `merge([C, A, B])`, and every other permutation of the
same set MUST produce the same merged bundle.

**Normative tie-break rule:** when N ≥ 2 records share an id and are not all
content-identical, an implementation MUST:

1. Compare **every** colliding record's content against every other's (not
   just against the first-seen one), and report a collision for every
   distinct-content pair.
2. Choose the *kept* record deterministically from content alone — not from
   array position — using the record whose [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785)
   (JSON Canonicalization Scheme, JCS) serialization sorts lexicographically
   first among the distinct contents.

**Canonicalization decision (ratified):** RFC 8785/JCS is the normative
canonicalization primitive for this tie-break rule, and for `"hash"`-kind
`integrityAnchor` computation bundle-wide (`SECURITY.md` §"Integrity anchors
and canonicalization" states the identical rule for hashing — one decision,
cited from both places). This was previously a "target primitive... until
adopted bundle-wide" hedge; it is now ratified as MUST, not a future
aspiration: canonicalization MUST be RFC 8785 (JCS) — full stop, with no
sorted-key-`JSON.stringify` shortcut carve-out. Two implementations that both
claim RFC 8785 compliance and compare the same distinct contents MUST agree
on which one sorts first.

> **Note (informative, not normative):** producing byte-identical RFC 8785
> output across languages has real cross-language pitfalls implementers
> should verify against, not assume away. (a) Non-ASCII string escaping —
> RFC 8785 (via RFC 8259) requires strings to contain literal UTF-8
> characters, never `\uXXXX` escapes, but several languages' default JSON
> serializers `\u`-escape non-ASCII by default (e.g. Python's `json.dumps`'s
> `ensure_ascii=True` default) and must be reconfigured to emit literal
> UTF-8. (b) Number serialization MUST follow the ECMAScript
> `Number::toString` algorithm (RFC 8785 §3.2.2.3) — native to JavaScript
> engines, but other languages need a compliant implementation of that exact
> algorithm, not their own default float-to-string routine. (c) Property
> sort order is by UTF-16 code unit value (RFC 8785 §3.2.3), not codepoint,
> byte, or locale-collation order. RFC 8785 §3.1 also does not apply Unicode
> normalization — strings are canonicalized exactly as they already are in
> memory, so two visually-identical strings that differ only in Unicode
> normalization form produce different canonical bytes. A hand-rolled
> sorted-key `JSON.stringify` can silently diverge from RFC 8785 on any of
> these points; there is no shortcut that is safe to assume equivalent
> without verifying against a conformant JCS implementation.

This makes the merged bundle a pure, order-independent function of the *set*
of input bundles — the same guarantee `status-function.md` already gives for
`now`-parameterized status derivation, extended to the merge step that
precedes it.

---

## 7. Agreement, conflict, and dispute mechanics

Given two claims that are the same logical claim under §4:

### 7a. Agreement

If `deepEqual(a.value, b.value)`: the claims agree. They MUST NOT be
collapsed into one record (§4). Agreement is informational at the merge
layer; agreement alone does not synthesize a stronger status. A consumer that
wants "N producers agree" as an input to a decision already has the tool for
it without a new mechanism: an authored `DerivationRule`
(`derivation-rule.schema.json`) can require `acceptedStatuses` across both
claim ids explicitly. This document does not add corroboration-across-producers
as an automatic status input.

### 7b. Value conflict

If the claims are governed by a `VerificationPolicy` with `incompatibleValues`
covering the pair (`verification-policy.schema.json`) and the values match an
`incompatibleValues` pair: **both claims MUST be retained** (never
last-write-wins) and the conflict is surfaced as a `contradiction`
transparency gap. This document does not add a normative JSON Schema for
`TransparencyGap` — that remains explicitly out of scope
(`schemas/trust-report.schema.json`'s own `$comment` already documents this;
see §9). The merge-layer guarantee this document DOES make is
schema-checkable without a `TransparencyGap` schema: neither claim is
dropped, mutated, or status-overridden by the presence of the other (§5 rule
2).

### 7c. Status conflict

A cross-producer `incompatibleStatuses` policy match (like a value conflict,
§7b) produces a `contradiction` transparency gap. It does not, by itself,
flip either claim's `status`.

A claim's `status` becomes `disputed` **only** through the existing,
single-claim mechanisms already in `status-function.md`: blocking
non-passing evidence (Step 4c), a terminal event with `status: "disputed"`
(Step 2), or an authority-gated resolution that is itself overridden by newer
blocking evidence (Step 1). Nothing in the cross-producer conflict path sets
a claim's status to `disputed`; `TrustReport.summary.disputedClaims` is
populated purely by scanning `claim.status === "disputed"` from each claim's
own single-claim fold output.

### 7d. Dispute resolution — no new record type

When a human/authority needs to resolve a `disputed` status (from 7c's
existing mechanisms), the spec already has the shape: a
`VerificationEvent` with `resolvesDispute: true` and an optional
`authorityRef`, gated by an active `AuthorityTrace` at decision time
(`status-function.md` Step 1). This document does not introduce a new
"Dispute" resource. Reusing `VerificationEvent` + `AuthorityTrace` means a
cross-producer dispute is resolved exactly the same way a single-producer one
is — the resolving event just needs `claimId` pointed at whichever specific
claim the authority is ruling on (the fold is per-claim; resolving "the
subject+field disagreement" in general means issuing a resolution event on
each affected claim id, or issuing one and letting a `DerivationRule` compose
the pair — no new bulk-resolution primitive is added by this document).

---

## 8. Id collision handling for records that are NOT the same logical claim

This is the case where two producers, without coordinating, mint the
identical `id` string for two *unrelated* records (accidental collision —
distinct from §4's "same logical claim, different ids" case, and distinct
from §7's value/status conflict between claims that *are* the same logical
claim).

- **Detection:** compare content; identical content is not a problem
  (idempotent re-merge); differing content under the same id is a collision
  that MUST be surfaced (`mergeBundles` throws for claims;
  `mergeBundlesDetailed` reports for every collection).
- **Mitigation is the id convention (§3), not a new mechanism.** A collision
  between two truly unrelated records is only possible if both producers
  independently chose the same opaque string. The producer-prefixed dotted
  convention (e.g. `producer-a.recommendation.upgrade-node` vs.
  `producer-b.candidate.upgrade-node`) makes this vanishingly unlikely
  without any schema enforcement. This document does not add a registry,
  reservation scheme, or uniqueness authority — that would introduce the
  kind of cross-producer coordination infrastructure the "stand-alone,
  vendor-neutral format" goal explicitly rules out.

---

## 9. Explicitly out of scope

- **`TransparencyGap` / `EvidenceRequirement` normative JSON Schemas.**
  Referenced descriptively in §7b/§7c (the `contradiction` gap type already
  exists informally, per `schemas/trust-report.schema.json`'s own
  `$comment`), but this document does not add a schema for them.
- **A cross-language canonicalization *library*.** RFC 8785/JCS is ratified
  (§6) as the normative canonicalization primitive for both the §6 tie-break
  rule and `"hash"`-kind `integrityAnchor` computation (`SECURITY.md`) — that
  decision is settled, not deferred. The `hachure` package ships a JavaScript
  JCS implementation (`lib/canonicalize.mjs`) as part of its bundled
  implementation; implementations in other languages are responsible for
  their own RFC 8785 conformance (see the informative note in §6 for the
  cross-language pitfalls).
- **Cryptographic producer identity (DIDs, keys, transparency-log-anchored
  identity).** `producerId` (§2) is deliberately unsigned and unverified.
  Where verifiable producer identity is needed, use Assurance L1/L2
  (`assurance.md`) — this document adds no new identity/signing mechanism.
- **Survey chains, Veritas standards, Flow gates** — unchanged; still
  extension-profile territory per README's existing "Out of scope" section.

---

## Prior art

- **W3C Verifiable Credentials.** VC issuer identity is built on DIDs — a
  resolvable, typically key-based identifier scheme. Requiring DIDs for
  `producerId` would collapse the existing layered design (Assurance
  L0/producer-asserted is the default; L1/L2 signing is opt-in) into "every
  producer needs key infrastructure just to be namespaced for merge," a
  strictly higher bar than merge needs. `producerId` is deliberately at the
  same trust level as the existing `source` field (L0, free-text, unsigned).
- **in-toto.** `interop-in-toto.md` already wraps a whole `TrustBundle` as one
  in-toto `Statement`'s `predicate` — in-toto's subject/predicate model is
  single-attestation by design and defines no multi-producer merge algorithm
  at the claim level. This document is compatible with that profile
  unchanged: merge happens on `TrustBundle`s *before* DSSE wrapping, or a
  verifier can independently wrap several signed Statements' predicates and
  merge them after unwrapping — either order works because merge is a pure
  function over `TrustBundle` values, not over signed envelopes.

---

## Implementation notes (informative)

The bundled implementation (`lib/merge.mjs` in the `hachure` package)
satisfies §5, §6 (order independence and the JCS tie-break, exercised under
every input permutation by `test/merge.conformance.test.mjs`), and §8. The
notes below track one *other* known implementation, `@kontourai/surface`
(v2.1+), and are informative only:

| Normative rule (this document) | Where it lands in `@kontourai/surface` `src/` | Status |
|---|---|---|
| §2 `producerId` field | `src/types.ts` `TrustBundle` interface; validated in `src/validate.ts` | Implemented |
| §3 id convention | Prose-only; no code change (SHOULD, unenforced) | N/A |
| §4 claim identity across producers | `src/canonical.ts` `canonicalClaimKey` + `src/identity.ts` `buildIdentityIndex` | Reused unchanged |
| §5 rule 1–2 (union by id, first-occurrence-wins-if-identical, collision on differing content) | `src/merge.ts` `unionById` / `unionOptionalById` | Implemented |
| §5 rule 3 (`producerId` and `proof` omitted on merge) | `src/merge.ts` `mergeBundlesDetailed` | Implemented (locked by test) |
| §6 determinism / order-independence | `src/merge.ts` `unionById` groups every record sharing an id across all bundles and compares each against every other | Implemented |
| §6 tie-break (canonical-serialization ordering) | `src/merge.ts` `resolveGroup` — kept content chosen by canonical-serialization ordering, never array position | Implemented |
| §7b value conflict → `contradiction` gap | `src/conflict-derivation.ts` `deriveConflictTransparencyGaps` | Implemented |
| §7c status conflict | `src/conflict-derivation.ts` (no code change needed — the code already matches this document's narrower rule) | Implemented |
| §7d dispute resolution | `src/dispute.ts` `buildDisputeResolutionEvent`; `status-function.md` Step 1 | Implemented |
| §8 collision detection | `src/merge.ts` `MergeCollision` (a TS type; not currently a normative wire schema, and stays that way per §9) | Implemented |
| Conformance vectors | `conformance/merge/*.json` (this repo) | Run in both suites: this repo's `test/merge.conformance.test.mjs` (bundled implementation, every permutation) and `@kontourai/surface`'s own tests |

---

## Versioning

This document introduces no change to `statusFunctionVersion` (stays `"2"`).
`schemaVersion` itself has moved since this document's `producerId` addition
first shipped: it is now `5` (README.md's Namespace and versioning section is
the single source of truth for the current value), reflecting the unrelated
`surface` → `facet` rename described in §4 — not anything this document
introduces. Nothing in this document depends on that hard break: the
`producerId` field (§2) is optional and ignored by the unchanged
status-derivation fold, and remains schema-valid at `schemaVersion` `5`
exactly as it was when it shipped. A bundle merged under this document and fed
to the unchanged fold produces identical per-claim results to a bundle that
was never merged.
