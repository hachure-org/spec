# Status Derivation — Specification

**Function:** `status = f(claim, evidence, events, policy, authorityTrace, now)`
**Version constant:** `statusFunctionVersion` (currently `"3"`; version `"2"`
remains defined in [§Version 2](#version-2))
**Normative source:** this document. The bundled implementation is
`lib/derive.mjs` in the `hachure` package; it and every other conforming
implementation are checked against the same `conformance/` vectors.
**Conformance language:** MUST/SHOULD/MAY keywords in this document are to be interpreted per RFC 2119/BCP 14, as defined in [README.md's Conformance language section](README.md#conformance-language).

---

## Principle

Claim status is a pure, versioned, deterministic function. Given the
same inputs and the same status function version, any conforming implementation
must derive the same status. There is no stored status field that overrides
computation; the derived status is always recomputed from the input bundle at
evaluation time.

`now` is an explicit input so that time-based staleness checks are reproducible.
Under version `"3"` an implementation MUST refuse to evaluate with a `now` that
is not a valid instant, rather than let every freshness comparison fail open.
A caller that wants a point-in-time view fixes `now` before evaluating; there are
no clock-tick events and no background expiry.

This treatment of freshness has standards lineage: RATS (RFC 9334 §10) defines
freshness/epoch mechanisms precisely because a signed attestation result is
fixed at signing time and decays afterward. Hachure resolves the same concern
structurally — rather than attaching freshness handshakes to a frozen
artifact, staleness is part of the derivation itself, parameterised by `now`.

Reproducibility guarantee: if two independent implementations receive the same
`(claim, evidence, events, policies, authorityTrace, now)` and the same
status function version, they must return the same `TrustStatus`.

**Omission fails closed (version `"3"`).** A derived `verified` means every input
the applicable policy depends on was present and evaluated. Leaving an input
out — the policy, a requirement, a check result, a validity-rule parameter, a
derivation input — can only weaken the derived status, never strengthen it.
Where this document says an input is *unevaluable*, the step treats it as
failing, not as satisfied or skipped.

---

## Inputs

| Input | Type | Required | Description |
|---|---|---|---|
| `claim` | `Claim` | yes | The claim being evaluated. |
| `evidence` | `Evidence[]` | yes | All evidence items whose `claimId` matches the claim. |
| `events` | `VerificationEvent[]` | yes | All verification events for the entire bundle; the function filters by `claimId`. |
| `policies` | `VerificationPolicy[]` | yes | All policies in the bundle; the function resolves the applicable policy internally. |
| `now` | `Date` | no (defaults to wall clock) | The evaluation timestamp for freshness checks. |
| `authorityTrace` | `AuthorityTrace[]` | no (defaults to `[]`) | Active authority records enabling dispute resolution. |

`deriveClaimStatus` (the public versioned entry point) resolves the policy and
partitions evidence before calling the internal `deriveTrustStatus` function.

---

## Evidence partitioning

Before the fold, evidence is partitioned by `supportStrength`:

- **`"entails"`** (default when `supportStrength` is absent) — fully entails the
  claim; satisfies policy requirement checks and corroboration counts.
- **`"cited"`** — contextual support only; does not satisfy required-evidence
  policy checks and does not count toward corroboration.

Only entailing evidence is passed to `deriveTrustStatus`. Cited evidence is
available to callers but does not influence status derivation. Every step of
the fold that mentions evidence, including Steps 6 and 7, sees entailing
evidence only.

### Fields that are not inputs

The function reads no field that describes how evidence was collected or how a
value was arrived at. In particular it does not read:

- `evidence.inconclusive` — an attempt that could not run. The Evidence schema
  requires such an item to be `supportStrength: "cited"` with no `passing`, so
  the partition above removes it before the fold. It satisfies no requirement
  (Step 4's policy requirement check, and Step 7), is not counted as evidence
  in Step 6, does not corroborate, anchors no `commit` rule (Step 4's
  staleness check), and is never a blocking failure (Step 1, and Step 4's
  blocking failure check). A claim derives the same status with the item as
  without it. No step tests for `inconclusive`; the exclusion follows from the
  partition, in version `"2"` and version `"3"` alike. (The steps are named by
  role here because the two versions letter Step 4's sub-steps differently.)
- `evidence.collectedByKind` — the kind of collector. Evidence collected by a
  model counts exactly as evidence collected any other way.
- `evidence.execution`, including `execution.isError`. A failed check affects
  status only through `passing: false`.
- `metadata` on any record, including the
  [basis-annotations profile](basis-annotations.md)'s
  `evidence.metadata.sourceOfRecord` and `claim.metadata.estimate`.
- `claim.conclusionConfidence` and `claim.confidenceBasis`.

The exclusion of inconclusive evidence holds only for a schema-valid bundle.
An item that carries `inconclusive` but is entailing is not schema-valid, and
the fold, which does not look at `inconclusive`, would count it. Version
`"3"`'s fail-closed handling of unevaluable inputs does not reach this case,
because no fold step reads the field. The function does not validate its
input, and neither do the bundled `deriveClaimStatus` and `deriveStatuses`. The
caller therefore MUST validate a bundle against the schemas before deriving
status from it, and MUST NOT rely on a status derived from a bundle that fails
validation. The `hachure derive` and `hachure diff` commands are such callers:
each validates first and refuses an invalid bundle. Validation needs `ajv`,
which the `hachure` package does not depend on; when it cannot be loaded the
commands refuse to derive unless `--no-validate` is given, and with that flag
they derive unvalidated and say so on stderr.

The `sf-inconclusive-evidence` vector covers the exclusion of inconclusive
evidence at each place the fold reads evidence: the requirement check,
corroboration, the `commit` anchor, and Steps 6 and 7. The
`sf-basis-fields-inert` vector carries `collectedByKind` and the two profile
`metadata` keys on claims of four different statuses, and the package's suite
re-derives it with the fields removed. No vector covers `execution`,
`conclusionConfidence`, or `confidenceBasis`.

---

## Policy resolution

Before the fold, the applicable `VerificationPolicy` is resolved from the policies
array using this priority order:

1. If `claim.verificationPolicyId` is set, the policy with that `id` is the
   resolved policy. If no policy has that `id`, no policy is resolved: the
   claim named a policy that is not in the bundle, and resolution MUST NOT fall
   back to steps 2–3.
2. Otherwise, find a policy whose `claimType` exactly matches `claim.claimType`.
3. Otherwise, walk the `parentType` chain declared by policies (most-specific first)
   and pick the first match.
4. If no policy is found, `policy` is `undefined` and the fold proceeds without one.

The first policy declared for a given `claimType` wins; later declarations do not
silently override.

### Effective policy

A resolved policy whose `requiredEvidence` is empty and whose `requiredMethods`
is empty or absent requires nothing, so it cannot tell a verified claim from an
unverified one. The fold treats such a policy exactly as if no policy had been
resolved ("no effective policy"). Everywhere below, "a policy is present" means
an effective policy is present. The output `policyId` still reports the
resolved policy's `id`.

### Qualifying evidence

Evidence types that record the result of a pass/fail check — `test_output`,
`calculation_trace`, and `runtime_observation` — are *check evidence*. An
entailing evidence item *qualifies* unless it is check evidence whose `passing`
is not `true`. Check evidence with `passing` absent has no result to evaluate;
check evidence with `passing: false` records a failed check. Neither satisfies a
requirement. Other evidence types qualify whenever they entail.

---

## The fold

The fold is an ordered sequence of checks. The first matching branch terminates
the evaluation and returns its status. No subsequent checks are applied.

### Step 1: Authority-gated dispute resolution

Check for the most recent verification event (sorted most-recent-first by `createdAt`)
that satisfies both of these conditions:

- `event.resolvesDispute === true`
- The event's `actor` has an active `AuthorityTrace` at the time of the decision

An `AuthorityTrace` is active at a given `eventCreatedAt` if all of the following hold:

- `trace.actorRef === event.actor`
- `trace.revokedAt` is absent, or `trace.revokedAt > eventCreatedAt`
- `trace.validFrom` is absent, or `trace.validFrom <= eventCreatedAt`
- `trace.validUntil` is absent, or `trace.validUntil >= eventCreatedAt`
- If `event.authorityRef` is set, `trace.authorityRef === event.authorityRef`

If such a resolution event is found:

- Check whether any evidence item satisfies **all** of:
  - `evidence.passing === false`
  - `evidence.blocking !== false`
  - `Date.parse(evidence.observedAt) > Date.parse(resolutionEvent.createdAt)`

  If such a "newer blocking failure" exists, return **`disputed`** (the resolution
  is overridden by fresh contradicting evidence).

- Otherwise, if `resolutionEvent.status` is `"verified"` and no policy is
  present, return **`proposed`**. Without a policy nothing defines what
  `verified` requires, so a resolution cannot establish it.

- Otherwise, return `resolutionEvent.status` directly. This is the authority-gated
  resolution outcome.

> In this version Step 1 still returns the resolution outcome without applying
> Step 2's terminal events or Step 4's checks, and no step reads
> `policy.reviewAuthority`. Both are candidates for a later version.

### Step 2: Terminal event statuses

Filter all events to those matching `claim.id`, sort most-recent-first by `createdAt`.
Let `latestEvent` be the first (most recent) event.

If `latestEvent` exists and its `status` is one of `"rejected"`, `"disputed"`,
`"superseded"`, `"stale"`, or `"revoked"` — return that status. These are
terminal: they are not overridden by evidence inspection. An event with
`type: "invalidation"` is always terminal in this step regardless of its
`status` (it asserts the claim is no longer good): it returns its `status` when
that status is one of the terminal statuses above, and **`stale`** otherwise
(an invalidation carrying `verified`, `assumed`, `proposed`, or `unknown`
cannot make the claim good). `"revoked"` derives `stale` (treated as an
explicit, event-driven staleness) unless a later verification event re-asserts
the claim.

> **Schema-version note (`statusFunctionVersion` `"2"`, `schemaVersion` `4`):**
> the `"revoked"` event status and `type: "invalidation"` classifier are new.
> Bundles that never use them derive identically to `statusFunctionVersion`
> `"1"`.

### Step 3: Assumed from event

If `latestEvent` exists and `latestEvent.status === "assumed"` — return **`assumed`**.

### Step 4: Verified event path

If `latestEvent` exists and `latestEvent.status === "verified"`:

#### 4a. Staleness check

**Claim-intrinsic validity window.** Before consulting the policy validity
rule, check the claim's own validity window, which overrides policy timing when
present. Let `verifiedTime = Date.parse(latestEvent.verifiedAt ?? latestEvent.createdAt)`.

- If `claim.expiresAt` is set, the claim is stale when `now > Date.parse(claim.expiresAt)`,
  or when `claim.expiresAt` cannot be parsed.
- Else if `claim.ttlSeconds` is set, the claim is stale when
  `now > verifiedTime + claim.ttlSeconds * 1000`, or when `verifiedTime` cannot
  be parsed or `ttlSeconds` is not a finite non-negative number.
- **Precedence:** `expiresAt` wins over `ttlSeconds` when both are present.
  When neither is present, fall through to the policy validity rule below.

If the claim-intrinsic window marks the claim stale: return **`stale`**.

Otherwise, if a policy is present, check whether the verification is stale based on
`policy.validityRule.kind`:

- **`"commit"`** — stale if `claim.currentIntegrityRef` is absent, or if none of
  the entailing evidence items linked by `latestEvent.evidenceIds` carries an
  `integrityRef` equal to `claim.currentIntegrityRef`. Without a current
  integrity reference there is nothing to compare the verified evidence
  against.
- **`"duration"`** — stale if `now > verifiedTime + (policy.validityRule.durationDays × 86400000 ms)`.
  Also stale if `durationDays` is absent, is not a finite non-negative number,
  or `verifiedTime` cannot be parsed.
- **`"historical"` or `"manual"`** — never stale by time or commit change.
- Any other `kind`, or a policy with no `validityRule.kind` — stale (the rule
  cannot be evaluated).

If no policy is present, this sub-step does not mark the claim stale; 4c caps
the result at `proposed`.

If stale: return **`stale`**.

#### 4b. Blocking failure check

Check whether any entailing evidence item satisfies both:
- `evidence.passing === false`
- `evidence.blocking !== false` (i.e., `blocking` is `true` or absent/`undefined`)

If such evidence exists: return **`disputed`**.

This check runs before the requirement check (4c) so that a failed check which
also leaves a requirement unmet derives the weaker `disputed`, not `proposed`.

#### 4c. Policy requirement check

If no policy is present: return **`proposed`**. Without a policy nothing
defines what `verified` requires.

Otherwise, check whether all required evidence types and methods are present
among **qualifying** evidence items:

- Build the set of `evidenceType` values from qualifying evidence.
- Build the set of `method` values from qualifying evidence.
- Compute `missingTypes = policy.requiredEvidence` items not in the type set.
- Compute `missingMethods = (policy.requiredMethods ?? [])` items not in the method set.
- Corroboration gap: `policy.requiresCorroboration === true` and fewer than two
  qualifying evidence items.

If any gap exists: return **`proposed`** (the event says verified but policy
requirements are not met — the claim is effectively a proposed state).

#### 4d. Verified

Return **`verified`**.

### Step 5: Claim-level status baseline

If there is no verification event (or `latestEvent.status` was not one of the above):

- If `claim.status === "proposed"` — return **`proposed`**.
- If `claim.status === "assumed"` — return **`assumed`**.

### Step 6: No policy

If no policy is present (none resolved, or the resolved policy requires nothing):

- Return **`proposed`** if `evidence.length > 0` (there is evidence but no policy to
  evaluate it against).
- Return **`unknown`** if `evidence.length === 0`.

### Step 7: Policy evidence presence

If a policy is present but no verification event exists:

- Build the set of `evidenceType` values from the entailing evidence. Cited
  evidence is not included, here or in Step 6.
- If `policy.requiredEvidence` is a subset of the evidence type set: return **`proposed`**.
- Otherwise: return **`unknown`**.

---

## Derivation ceiling

For derived claims (claims built from other claims via `derivationEdges` or
`derivedFrom`), the status of the derived claim cannot exceed the weakest input
claim status. The ceiling is applied after the fold, over the whole bundle:

1. Derive every claim's own status with the fold above.
2. For each claim, collect the claims reachable from it through `derivedFrom`
   ids and `derivationEdges[].inputClaimId`, transitively. Visit each claim at
   most once, so a cycle terminates.
3. The claim's status is the weakest (per [§Status ordering](#status-ordering-for-ceiling-purposes))
   of its own status and the own status of every reachable claim. An input id
   that names no claim in the bundle contributes `unknown`.

A missing input weakens the derived claim instead of being skipped. The
ceiling is reflected in `DerivationChangeRecord` entries in the report.

---

## Status ordering (for ceiling purposes)

From weakest to strongest: `revoked` < `rejected` < `disputed` < `superseded` <
`stale` < `unknown` < `assumed` < `proposed` < `verified`.

Negative findings rank below the absence of evidence: a derivation that rests
on a rejected, disputed, superseded, or lapsed input reports that input's
status rather than `unknown`, because "something is known to be wrong" is the
more adverse and more actionable fact. `disputed` ranks below `superseded`
because a dispute is contradicting evidence against the claim, while
supersession only says a newer claim replaced it. (Version `"2"` used a
different order; see [§Version 2](#version-2).)

`revoked` appears here as a raw status for ceiling and rollup purposes (see
README §"Status semantics"); single-claim derivation folds it to `stale` in
Step 2 unless a later verification event re-asserts the claim.

---

## Output

`deriveClaimStatus` returns `{ status: TrustStatus; policyId: string | undefined }`.
`policyId` is the `id` of the resolved policy, or `undefined` if none was found.

---

## Interop mapping: AR4SI trustworthiness tiers (informative)

RATS Attestation Results for Secure Interactions
([draft-ietf-rats-ar4si](https://datatracker.ietf.org/doc/draft-ietf-rats-ar4si/))
is the closest standardized artifact to a trust-status vocabulary: verifier-
assigned *trustworthiness tiers* — None, Affirming, Warning, Contraindicated.
Its tiers are assigned by a Verifier at appraisal time; Hachure statuses are
recomputed by any consumer. For consumers that speak AR4SI, the recommended
projection of a derived Hachure status is:

| Hachure status | AR4SI tier | Rationale |
|---|---|---|
| `verified` | Affirming | Policy-satisfying, fresh, affirmed by events. |
| `assumed`, `proposed` | None (no verdict) | Operationally present but not appraised to affirmation. |
| `unknown` | None (no claim) | Nothing to appraise. |
| `stale` | Warning | Previously affirmed; freshness lapsed. |
| `disputed` | Warning | Contradicting testimony present; not yet terminal. |
| `superseded`, `rejected`, `revoked` | Contraindicated | Terminal negative standing. |

The projection is lossy by design (nine states → four tiers) and one-way:
an AR4SI tier MUST NOT be imported as a Hachure status (see
[evidence-ingestion.md](evidence-ingestion.md) §"What ingestion is not") —
it arrives as evidence content, and derivation produces the status.

---

## Version 2

`statusFunctionVersion` `"2"` remains defined so that records resolved under
it (`InquiryRecord.statusFunctionVersion`) can be re-derived. It is this
document with the following differences, and no others:

1. **Policy resolution.** A `verificationPolicyId` that names no policy falls
   back to claim-type resolution (steps 2–3).
2. **No effective-policy rule.** A policy that requires nothing is still a
   policy: Step 4's requirement check passes vacuously.
3. **Step 1.** A resolution event returns its status directly even when no
   policy is present.
4. **Step 4a.** A `commit` rule with no `claim.currentIntegrityRef` is not
   stale. No policy means not stale. The spec text does not define the result
   for an unparseable timestamp, a missing, negative or non-finite
   `durationDays` or `ttlSeconds`, or a missing or unknown `kind`. The bundled
   implementation derives stale for a missing `durationDays`, compares a
   negative window numerically, and treats an unparseable or non-finite
   value, or an unknown `kind`, as not stale.
5. **Step 4 order.** The requirement check runs before the blocking failure
   check (`proposed` is returned before `disputed` is considered), and when no
   policy is present the requirement check is skipped, so a verified event
   with no policy and no blocking failure derives `verified`.
6. **Evidence for requirements.** All entailing evidence satisfies the
   requirement check, including check evidence with `passing` absent or
   `false`; corroboration counts all entailing evidence.
7. **Derivation ceiling.** Described as applied "by the derivation layer
   before the fold"; the ordering is `revoked` < `unknown` < `rejected` <
   `superseded` < `disputed` < `stale` < `assumed` < `proposed` < `verified`.
   The bundled implementation does not apply the ceiling under version `"2"`.
8. **Step 2 and `now`.** An invalidation event returns its own `status`
   whatever it is, so an invalidation carrying `verified` derives `verified`.
   An invalid `now` is not refused.

### Migrating from version 2

A bundle derives a different status under version `"3"` exactly when one of
the following rows applies to a claim. Rows marked *verified path* apply when
the claim's latest event is `verified` (or, where stated, an authority-gated
resolution to `verified`).

| Bundle shape | v2 | v3 | Why |
|---|---|---|---|
| *Verified path or resolution:* no policy resolves for the claim | `verified` | `proposed` | Nothing defines what verified requires. |
| *Verified path:* `verificationPolicyId` names a policy not in the bundle | policy by `claimType` | `proposed` | A named policy that is absent is an omission, not a hint to look elsewhere. |
| *Verified path or resolution:* resolved policy has empty `requiredEvidence` and no `requiredMethods` | `verified` | `proposed` | A policy that requires nothing is no policy. |
| *Verified path:* required check evidence has `passing` absent, or `passing: false` with `blocking: false` | `verified` | `proposed` | A check with no passing result satisfies nothing. |
| *Verified path:* corroboration counted check evidence without `passing: true` | `verified` | `proposed` | Only qualifying evidence corroborates. |
| *Verified path:* `commit` rule, no `claim.currentIntegrityRef` | `verified` | `stale` | Nothing to compare the verified evidence against. |
| *Verified path:* `validityRule.kind` missing or not one of the four kinds | `verified` | `stale` | The rule cannot be evaluated. |
| *Verified path:* `duration` rule with `durationDays` negative or not a finite number | `verified` or `stale` (depends on `now`) | `stale` | The window cannot be evaluated. (A missing `durationDays` was already `stale` in the bundled v2 implementation.) |
| *Verified path:* `ttlSeconds` negative or not a finite number | `verified` or `stale` (depends on `now`) | `stale` | The window cannot be evaluated. |
| *Verified path:* unparseable `expiresAt`, or an unparseable verification time under `ttlSeconds` / `duration` | `verified` | `stale` | The window cannot be evaluated. |
| *Verified path:* blocking failure and an unmet requirement | `proposed` | `disputed` | The failed check is the more adverse fact. |
| Latest event is `type: "invalidation"` with a non-terminal status (`verified`, `assumed`, `proposed`, `unknown`) | that status | `stale` | An invalidation says the claim is no longer good. |
| Any claim with `derivedFrom` / `derivationEdges`, whatever its events | own status | capped by inputs | The bundled implementation now applies the ceiling, with the v3 ordering. |
| Evaluation with an invalid `now` | freshness checks pass | refused (error) | No freshness comparison is possible. |

Producers that emit check evidence SHOULD set `passing: true` on checks that
passed; that single change keeps most version `"2"` bundles `verified` under
version `"3"`. The `sf-v3-*` conformance vectors cover each row.

## Versioning

`statusFunctionVersion` is a string exported by the `hachure` package (and
declared by every conforming implementation). It is incremented when the
algorithm changes in a way that could produce different outputs for the same
inputs. `InquiryRecord.statusFunctionVersion` captures which version
was active at resolution time, enabling re-evaluation when the algorithm version
changes.

Conforming implementations must declare which status function version value they
implement. Implementations claiming version `"3"` must satisfy every conformance
case in `conformance/` that applies to it: a vector with a
`statusFunctionVersions` array applies only to the versions it lists, and a
vector without one applies to every version. Implementations that still claim
version `"2"` run the vectors that apply to `"2"`.
