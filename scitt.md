# SCITT Profile: TrustBundles on Transparency Services

**Normative source:** this document.
**SCITT reference:** [RFC 9943](https://www.rfc-editor.org/rfc/rfc9943)
(An Architecture for Trustworthy and Transparent Digital Supply Chains),
Proposed Standard, June 2026.
**Conformance language:** MUST/SHOULD/MAY keywords in this document are to be interpreted per RFC 2119/BCP 14, as defined in [README.md's Conformance language section](README.md#conformance-language).

---

## Principle

SCITT and Hachure compose along a clean seam. SCITT answers *"who said this,
and is it immutably on the record?"* — issuers sign statements, transparency
services register them append-only, receipts prove registration. Hachure
answers *"what is the standing of this claim right now?"* — status is a
published, versioned function any consumer recomputes.

RFC 9943 deliberately leaves two things unstandardized: registration policy
("This specification leaves implementation, encoding and documentation of
Registration Policies and trust anchors to the operator of the Transparency
Service") and relying-party trust decisions. This profile occupies both
seats with machinery that already exists in this specification: bundles
register as signed statements (§2), receipts anchor in the `proof` block
(§3), and the status function serves as a *published* registration or
appraisal policy instead of a bespoke local one (§4).

Nothing in this profile is required for a valid Hachure record. SCITT
registration is an Assurance-layer dial ([assurance.md](assurance.md)):
turning it up buys transparency and non-equivocation, not validity.

---

## 2. Registering a bundle as a Signed Statement

A SCITT Signed Statement is a COSE_Sign1 message; SCITT does not constrain
the payload. Under this profile:

- The payload MUST be either a bare TrustBundle (JSON,
  `content type: application/json`) or — RECOMMENDED — the in-toto Statement
  from [interop-in-toto.md](interop-in-toto.md), whose `predicateType`
  `https://hachure.org/v1/bundle` gives receivers a typed hook. The DSSE
  envelope itself is not re-wrapped: the COSE_Sign1 signature replaces DSSE
  at the SCITT boundary, or the producer registers the in-toto *Statement*
  content directly.
- The COSE `issuer` SHOULD correspond to the bundle's `producerId` identity
  presentation under Assurance L1/L2 ([assurance.md](assurance.md)
  §"Identity presentation") — the signing identity is the authoritative
  issuer; `producerId` remains the unsigned floor beneath it.
- The COSE `subject` SHOULD identify the bundle's primary subject
  (`subjectType:subjectId` of its claims' shared subject, or the producer's
  own identifier for mixed-subject bundles), so that a transparency
  service's `iss`/`sub` grouping yields a coherent per-subject statement
  sequence.
- Registration inherently requires signing (COSE_Sign1). An L0 bundle is
  therefore never registered as-is; registering *is* the act of moving to
  L1/L2. This is consistent with "signing is a dial": the unsigned record
  stays valid; the transparency guarantee is what the signature buys.

## 3. Receipts as proof anchors

On successful registration the transparency service returns a Receipt — a
COSE-signed inclusion proof, universally verifiable offline. The producer
SHOULD store it in the bundle's `proof` block
(`trust-bundle.schema.json`, `schemaVersion` 6):

```jsonc
{
  "proof": {
    "anchors": [
      {
        "id": "anchor.scitt.receipt.2026-07-04",
        "kind": "transparency_log",
        "algorithm": "scitt-receipt",         // per RFC 9943 receipt format
        "value": "<base64url receipt or entry locator>",
        "sourceRef": "https://ts.example.com/entries/…",
        "observedAt": "2026-07-04T00:00:00Z",
        "verificationStatus": "unverified"    // until a consumer checks it
      }
    ]
  }
}
```

Rules (mirroring [evidence-ingestion.md](evidence-ingestion.md)):

- A receipt proves *registration*, not truth. It MUST NOT feed `passing`
  on any evidence, and MUST NOT alter derived status. Its effect is
  entirely at the Assurance layer.
- A consumer that verifies the receipt SHOULD record the outcome on the
  anchor's `verificationStatus`; recording `"verified"` without verifying
  is prohibited.
- The registered payload is frozen at registration; the bundle continues
  to live. A producer that re-registers a later snapshot creates a *new*
  statement in the same `iss`/`sub` sequence — see §5.

## 4. The status function as registration/appraisal policy

RFC 9943 §5.1.1 makes registration policy an operator-local concern. This
profile defines a portable way to declare one:

A transparency service or relying party MAY declare a **Hachure appraisal
policy**:

```jsonc
{
  "policy": "hachure.org/v1/status-appraisal",
  "statusFunctionVersion": "2",
  "acceptedStatuses": ["verified"],          // derived status must be in this set
  "evaluate": "payload",                     // the registered bundle is the input
  "now": "registration-time"                 // or "query-time" for relying parties
}
```

Semantics:

- The policy holder derives every claim status in the candidate bundle
  using the declared `statusFunctionVersion`
  ([status-function.md](status-function.md)) at the declared `now`.
- Registration (or acceptance, for a relying party) proceeds iff every
  claim's derived status is in `acceptedStatuses` — or, when the policy
  names `claimIds`, iff the named claims are.
- Because the function is pure and versioned, the policy decision is
  **reproducible by anyone** with the same inputs — an auditor can re-run
  the registration decision, which no bespoke local policy offers.
- This requires no schema change and no status-function change: it is a
  deployment convention over the existing derivation (satisfying the
  "expressible without modifying core schemas" constraint).

A richer gate ("these three claims verified AND that value ≥ x") is a
[DerivationRule](README.md#derivationrule); a policy MAY reference one by
id instead of `acceptedStatuses`.

## 5. Round-trip: bundle ↔ statement sequence (design note, staged)

Can a bundle be losslessly reconstructed from a SCITT statement sequence
about the same subject? Analysis:

- **Bundle → sequence: lossless.** Each registered snapshot is a complete
  bundle; the sequence is a series of frozen bundles.
- **Sequence → bundle: reconstructible via merge, with one caveat.**
  Successive snapshots from one producer share record ids; the §5/§6 merge
  ([merge.md](merge.md)) unions them deterministically, and append-only
  collections (events) accumulate correctly. The caveat is *retraction*:
  Hachure never deletes (events are append-only), so a well-formed producer
  history merges losslessly — but a producer that mutated a claim's content
  between snapshots (same id, different content) produces a merge collision
  rather than a silent latest-wins. That is the correct behavior (the
  mutation is surfaced, not laundered), but it means "lossless" holds for
  append-only histories and degrades honestly — to a reported collision —
  for rewriting producers.
- Formalizing this as a conformance vector family (snapshot sequence →
  expected merged bundle) is staged follow-up work, tracked on the
  [roadmap](ROADMAP.md).

---

## Versioning

This profile introduces no schema change and no `statusFunctionVersion`
change. It layers deployment conventions over `schemaVersion` 6's `proof`
block and the existing status function.
