# AI Evaluation Profile: Eval Results, Model Claims, and Agent Outputs as Recomputable Trust

**Normative source:** this document.
**Depends on:** core record shapes, [status-function.md](status-function.md); composes with [assurance.md](assurance.md), [interop-in-toto.md](interop-in-toto.md), [evidence-ingestion.md](evidence-ingestion.md).
**Conformance language:** MUST/MUST NOT/SHOULD/MAY keywords in this document are to be interpreted per RFC 2119/BCP 14, as defined in [README.md's Conformance language section](README.md#conformance-language).

---

## Principle

An evaluation result — a benchmark score, a red-team finding, a safety assessment,
"the agent verified X" — is produced with rich context (which model version, which
dataset revision, which harness, which threshold, which samples) and then, the
moment it crosses an organizational boundary, collapses to a **bare number, a
badge, or a PDF**. The evidence is gone, there is no expiry, and the receiver
cannot re-check the reasoning or re-apply their own threshold. The same bare score
is not even comparable across harnesses, let alone re-verifiable.

Every adopted attestation and inventory format in this space *seals a statement*:
it proves an identity signed a set of bytes, or inventories components, at a point
in time. Verification means "re-check a signature," never "re-derive whether this
conclusion still holds under *my* policy at *my* current time." That is the gap
this profile fills — not by inventing a new signing scheme, but by carrying the
evaluation **conclusion** together with its evidence, the policy it was judged
against, and an append-only event history, so any consumer recomputes
`status = f(evidence, policy, now)` and watches a once-good result go `stale` or
`disputed` as the model, the benchmark, or the policy moves — without editing the
original record.

Nothing in this profile is required for a valid Hachure record. It is a set of
conventions over the existing core shapes plus the optional `conclusionConfidence`
field; it introduces no schema change and no `statusFunctionVersion` change.

## The shape: evaluation trust in core records

### The claim is the conclusion

An evaluation conclusion is an ordinary Claim. The `value` is the conclusion
itself (a pass/fail, a score, "meets threshold T", "safe under policy P"); the
`claimType` names the kind of conclusion (`eval-result`, `model-claim`,
`agent-outcome` are RECOMMENDED conventions). It carries `derivedFrom` /
`derivationEdges` when the conclusion is computed from sub-claims (e.g. an overall
release-readiness conclusion derived from individual eval claims), so the
[derivation ceiling](status-function.md#derivation-ceiling) — a derived claim's
status cannot exceed its weakest input — applies unchanged.

### Evidence binds the score to its computation

The Evidence records carry what makes an eval result re-checkable, so it survives
the boundary instead of degrading to a number. RECOMMENDED evidence context
(carried in `metadata`, using existing `evidenceType` values such as
`test_output` or `calculation_trace`): model identifier **and version**, dataset
identifier **and revision**, harness/tool **and version**, decoding parameters
(temperature, max tokens, seed), the threshold applied, and references to the
sample-level trace. Field names SHOULD align with prevailing eval-log
conventions for interop. Each evidence item MAY carry an `integrityAnchor`
(assurance.md) referencing a signed model, a signed eval run, or a content
credential.

### Policy travels with the verdict

The VerificationPolicy carries *what makes this evaluation trustworthy* so a
downstream consumer can re-apply it — or apply a stricter one. RECOMMENDED policy
inputs: a **freshness window** (how long the result is trustworthy absent new
events), **corroboration** (whether an independent second evaluator is required),
**required method** (e.g. held-out, adversarial), and a **contamination
tolerance**. Because the status function is pure and versioned, a consumer with a
different threshold or freshness window re-derives a *different* verdict from the
*same* evidence — which sealed attestations cannot express.

### Events are how a conclusion goes stale

The append-only VerificationEvent ledger is where an evaluation conclusion loses
standing over time without the record being edited: a new model version ships, a
dataset is revised, benchmark contamination is detected, or an adversarial finding
lands. Each is an event that the status function folds — a prior `verified` eval
decays to `stale` or is `disputed` — so "this result is valid until the weights,
the benchmark, or the policy change" is expressed structurally, not asserted in
prose.

### Calibrated conclusion confidence (lead with this)

The optional `conclusionConfidence` field (README `Claim`) carries a **calibrated
probability the conclusion is correct** (`value`), how it was calibrated
(`method`, free-form), and a **comfort-zone** signal (`comfortZone: { within,
reason }`) stating whether the conclusion is in or out of the evaluator's
competence / distribution. This is the sharpest thing this profile carries that
no inventory or attestation format does: a calibrated confidence and an
in/out-of-distribution signal *on the conclusion itself*, portable across the
boundary. `method` and `comfortZone.reason` are free-form, producer-owned
vocabulary — never enumerated here.

### Merge composes evaluators

Multiple evaluators — a benchmark run, an independent red-team, a human review, an
agent-action record — merge into one derived standing. Disagreements are preserved
as contradiction gaps ([merge.md]), never resolved by last-write-wins, which is
exactly what multi-evaluator assurance needs.

## Conclusion freshness vs signature freshness

This profile means **conclusion freshness**: whether the *appraisal* still holds
as inputs change. This is distinct from the **key/signature freshness** of the
attestation world (certificate validity windows, key rotation, timestamp proofs),
which the [Assurance](assurance.md) profile handles. A signature can be perfectly
fresh while the conclusion it covers is stale (the model changed); a conclusion
can stay fresh long after the signing key rotated. Implementations MUST NOT
conflate the two: a valid signature is evidence *about* a record, not a statement
that its conclusion still holds.

## Composition: cite, do not replace

This profile deliberately does not re-invent identity, signing, or inventory. Each
of the following attaches as **Evidence** (optionally integrity-anchored) inside a
claim, and is cited rather than competed with:

- **Signed models / signed eval runs** (e.g. OpenSSF Model Signing, Sigstore,
  in-toto/DSSE Statements) — integrity/authenticity of the artifact evaluated.
- **AI/ML bills of materials** (e.g. CycloneDX ML-BOM, SPDX AI Profile) — the
  component inventory the evaluation ran against.
- **Content provenance** (e.g. C2PA) — for media artifacts under evaluation.
- **Agent and issuer identity** (W3C DID/Verifiable Credentials, and agent-identity
  work in that ecosystem) — *who* produced the evaluation or acted. This profile
  covers agent **outcomes** ("did the agent verifiably accomplish X, and is that
  still trustworthy"), not agent **identity or authorization**, which those
  standards own; cite them as evidence.

## Non-goals

- **Re-running the evaluation is not required.** "Recomputable" here means a
  consumer re-derives the *status* under their own policy at their own `now` over
  the carried evidence and event history. Re-executing the eval may be infeasible
  (cost, data access, non-determinism); this profile makes the conclusion,
  evidence, and policy portable and re-appraisable, which is the achievable and
  useful guarantee.
- **No agent identity or authorization scheme.** See composition above.
- **No new signing or transparency mechanism.** Signing is the [Assurance](assurance.md)
  dial; transparency-log registration is [SCITT](scitt.md).
- **No core-format change.** This profile is conventions over existing records
  plus the optional `conclusionConfidence` field.

## Status

Draft profile. It introduces no schema change and no `statusFunctionVersion`
change; it layers naming conventions and evidence/policy guidance over the core
records and the `conclusionConfidence` field. A worked example bundle accompanies
this profile in `examples/ai-evaluation-bundle.json` — two eval conclusions on
one model (one `verified` and corroborated with an in-comfort-zone calibrated
confidence, one `disputed` by a later red-team finding and flagged out of
distribution), demonstrating eval evidence that survives the boundary,
`conclusionConfidence`, a corroboration policy, and dispute by later evidence.

[merge.md]: merge.md
