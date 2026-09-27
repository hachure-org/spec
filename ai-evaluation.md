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
field (whose `calibration` reference was added at `schemaVersion` 8); it
introduces no `statusFunctionVersion` change.

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
probability the conclusion is correct** (`value`), the calibration table that
produced it (`calibration`), how it was calibrated (`method`, free-form), an
optional `interval`, and a **comfort-zone** signal (`comfortZone: { within,
reason }`) stating whether the conclusion is in or out of the evaluator's
competence / distribution. This is the sharpest thing this profile carries that
no inventory or attestation format does: a calibrated confidence and an
in/out-of-distribution signal *on the conclusion itself*, portable across the
boundary. `method` and `comfortZone.reason` are free-form, producer-owned
vocabulary — never enumerated here.

**What "calibrated" means.** A confidence value is *calibrated* when, over the
population of conclusions it is applied to, conclusions assigned value *p* turn
out to be correct with frequency *p* (within the table's stated bounds). That
is a property of a mapping measured against outcomes, not of a single number:
it can only be established by comparing assigned values with **labelled
outcomes** — conclusions whose correctness was later determined independently
of the score.

- A **calibration table** is a versioned mapping from a producer's score (or
  score bins) to such a probability, fit on labelled outcomes. It is
  identified by a `tableRef` and a `tableVersion`; any refit is a new
  `tableVersion`.
- A **calibrator** is the step that applies a calibration table to a
  producer's score for one conclusion and writes the result.

Rules:

- `conclusionConfidence.value` MUST be written only by a calibrator applying a
  calibration table, and the record MUST identify that table in
  `conclusionConfidence.calibration` (`tableRef`, `tableVersion`; optionally
  `method`, `sampleSize` — the number of labelled outcomes the table was fit
  on — and `boundMethod`, how `interval` was computed). From `schemaVersion` 8
  the schema requires `calibration` whenever `value` is present; for bundles at
  earlier schema versions it is a SHOULD.
- A producer's raw or self-reported score — a model's stated confidence, a
  classifier logit or softmax, an agreement or affirmation rate over a group —
  MUST NOT be written to `value`. It belongs in the claim's `confidenceBasis`
  or in evidence `metadata`, where a calibrator can read it.
- When present, `interval` MUST satisfy `0 <= low <= high <= 1`, and
  `low <= value <= high` when both `interval` and `value` are present. The
  schema enforces the `[0, 1]` range; the ordering constraints cannot be
  expressed in JSON Schema and are the producer's obligation.
- `comfortZone` MAY be populated by the producer directly; it is a
  within/outside-of-distribution judgement, not a probability, and needs no
  calibration table.
- A consumer SHOULD treat a `value` with no `calibration` reference as
  uncalibrated.

### Merge composes evaluators

Multiple evaluators — a benchmark run, an independent red-team, a human review, an
agent-action record — merge into one derived standing. Disagreements are preserved
as contradiction gaps ([merge.md]), never resolved by last-write-wins, which is
exactly what multi-evaluator assurance needs.

## Recommended evidence convention

To keep eval evidence interoperable across producers — so two evaluators' results
are comparable and mergeable rather than degrading to incomparable numbers — the
evidence that binds a conclusion to its computation SHOULD use consistent field
names. This convention is **recommended, not normative**: it is guidance carried
in evidence `metadata` (no schema change), and it deliberately aligns with
prevailing eval-log field names rather than minting a competing vocabulary. Harden
it toward normative only when a concrete integration demonstrates the shape.

Two evaluation kinds recur; both bind a conclusion to *what produced it*:

**Model / benchmark evaluations** — the conclusion is a score against a threshold.
Recommended evidence `metadata`:

- `model`, `modelVersion` — the evaluated model and its version.
- `dataset`, `datasetRevision` — the eval set and its revision.
- `harness`, `harnessVersion` — the eval tool and version (align field names with
  prevailing eval-log formats, e.g. an Inspect-style `.eval` log's task/model/
  package fields, so an existing eval run maps in rather than being re-modelled).
- `decoding` — `{ temperature, maxTokens, seed }` and any other generation params.
- `threshold` — the pass/fail boundary applied.
- `sampleTraceRef` — a reference to the sample-level trace, so a consumer can drill
  from the aggregate to the transcript.

**Review / extraction evaluations** — the conclusion is an extracted value or a
reviewed judgement. Recommended evidence `metadata`:

- `sourceRef` + `integrityRef` — the source and its content hash.
- a verbatim `excerpt` — the exact span the value was drawn from.
- `inferenceType` — whether the value was `explicit` in the source or `inferred`.
- the reviewer identity and review outcome (as an `attestation`/event).
- the gated confidence value the producer decided against.

### Where a producer's confidence goes

A producer that already computes a numeric confidence records it as a raw
signal — in `confidenceBasis` or evidence `metadata` — not in
`conclusionConfidence.value`. That number becomes a `conclusionConfidence.value`
only when a calibrator maps it through a versioned calibration table
(§"Calibrated conclusion confidence" above), and the record names that table.
A within/outside-of-distribution judgement the producer already makes MAY go
straight into `comfortZone { within, reason }`.

### Contamination as a policy input

For benchmark evaluations, benchmark contamination (train/test overlap) is a
first-class trust input, not a footnote: a policy MAY require a contamination
tolerance in its `acceptanceCriteria`, and a detected contamination effect is a
`comfortZone.reason` or a staleness event that moves the conclusion — because "how
much of this score survives decontamination?" is exactly the kind of question a
bare number cannot answer.

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
- **No core-format change beyond `conclusionConfidence`.** This profile is
  conventions over existing records plus the optional `conclusionConfidence`
  field and its `calibration` reference.

## Status

Draft profile. It introduces no `statusFunctionVersion` change; its only schema
addition is the `conclusionConfidence.calibration` reference (`schemaVersion` 8).
It layers naming conventions and evidence/policy guidance over the core
records and the `conclusionConfidence` field. A worked example bundle accompanies
this profile in `examples/ai-evaluation-bundle.json` — two eval conclusions on
one model (one `verified` and corroborated with an in-comfort-zone calibrated
confidence, one `disputed` by a later red-team finding and flagged out of
distribution), demonstrating eval evidence that survives the boundary,
`conclusionConfidence`, a corroboration policy, and dispute by later evidence.

[merge.md]: merge.md
