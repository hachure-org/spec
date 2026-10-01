# Status Derivation — Specification

**Function:** `status = f(claim, evidence, events, policy, authorityTrace, now)`
**Version constant:** `statusFunctionVersion` (currently `"4"`; versions `"3"`
and `"2"` remain defined in [§Version 3](#version-3) and [§Version 2](#version-2))
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
From version `"3"` an implementation MUST refuse to evaluate with a `now` that
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

**Omission fails closed (from version `"3"`).** A derived `verified` means every input
the applicable policy depends on was present and evaluated. Leaving an input
out — the policy, a requirement, a check result, a validity-rule parameter, a
derivation input — can only weaken the derived status, never strengthen it.
Where this document says an input is *unevaluable*, the step treats it as
failing, not as satisfied or skipped.

**Unevaluable times fail closed (version `"4"`).** Version `"4"` defines what a
timestamp is ([§Timestamps](#timestamps)) and says, at every place the fold
reads one, what happens when the value is not a timestamp. In Step 1 the rule
is that authority which cannot be evaluated is not exercised: a resolution
whose time, or whose resolver's authority window, cannot be evaluated is not
honoured. That is not the same as "can only weaken". A refused resolution
leaves the claim to the rest of the fold, which can produce a stronger status
than the resolution carried: refusing a resolution to `rejected` lets a later
`verified` event stand. What fails closed is the resolver's authority, not
the claim's status.

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
  partition, in every version. (The steps are named by
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
validation.

A caller that cannot run a JSON Schema validator MUST at least check the two
constraints the exclusion depends on: every evidence item with `inconclusive`
has `supportStrength: "cited"` and no `passing`, and a bundle carrying
`inconclusive` or `collectedByKind` declares `schemaVersion` `9` or later. The
`hachure` package exports this as `checkBasisInvariants(bundle)`, which needs
no validator. It is a check a caller runs before the function, not a step of
the function.

The `hachure derive` and `hachure diff` commands are such callers. Each always
runs `checkBasisInvariants` and refuses a bundle that fails it. Each also runs
full schema validation when `ajv` can be loaded, and refuses an invalid
bundle; the package does not depend on `ajv`, and when it cannot be loaded the
commands derive after the built-in check and warn on stderr that full
validation was skipped. `--no-validate` skips both checks, with a warning.

The `sf-inconclusive-evidence` vector covers the exclusion of inconclusive
evidence at each place the fold reads evidence: the requirement check,
corroboration, the `commit` anchor, and Steps 6 and 7. The
`sf-basis-fields-inert` vector carries `collectedByKind` and the two profile
`metadata` keys on claims of four different statuses, and the package's suite
re-derives it with the fields removed. No vector covers `execution`,
`conclusionConfidence`, or `confidenceBasis`.

---

## Timestamps

A *timestamp* is a string that is an RFC 3339 `date-time`
(`full-date "T" full-time`), the same definition the schemas name with
`format: date-time`. Under version `"4"`:

- The `T` separator and a `Z` offset may be written in lower case.
- Fractional seconds may have any number of digits.
- The offset is `Z` or `±hh:mm`, and is required.
- The date must exist in the calendar (`2027-02-30` does not), the hour is
  `00`–`23`, and the minute and offset minute are `00`–`59`.
- Second `60` is a timestamp only where the time, converted to UTC, is
  `23:59:60`: the one place a leap second can occur. It is read as the
  instant that follows it, `00:00:00` of the next day.

Nothing else is a timestamp. In particular a date with no time
(`2027-04-01`), a time with no offset (`2027-04-01T00:00:00`), hour `24`, a
space in place of `T`, an offset with no colon, prose such as
`April 1, 2027`, and any value that is not a string are not timestamps.

Timestamps are compared as instants, never as strings:
`2026-05-02T00:00:00Z`, `2026-05-02T00:00:00.000Z` and
`2026-05-02T02:00:00+02:00` are the same instant.

The comparison is exact. Every fractional digit counts, however many there
are, and nothing is rounded or truncated: `00:00:00.0009Z` is later than
`00:00:00.0001Z`, `00:00:00.00000000002Z` is later than
`00:00:00.00000000001Z`, `00:00:00.9999999999Z` is earlier than `00:00:01Z`,
and `00:00:00.5Z` equals `00:00:00.500000Z`. An implementation therefore
cannot hold an instant in a binary floating-point number of milliseconds.
The bundled `parseTimestamp(value)` returns
`{ epochMilliseconds, subMillisecond }` (whole milliseconds since the epoch,
and the remaining fractional digits as a string with trailing zeros removed),
or `undefined` when the value is not a timestamp, and
`compareTimestamps(a, b)` orders two of them.

`now` is supplied by the caller and is not parsed from the bundle. Given as a
native date value it is an instant of whole milliseconds. Given as a string it
MUST be a timestamp as defined here and is read exactly, fractional digits
included; an implementation MUST refuse any other string, and any other kind
of value, rather than evaluate. `hachure derive --now` follows the same rule.

A validity window (Step 4a) is exact too. Its length is the decimal product
`ttlSeconds × 1000` or `durationDays × 86 400 000` milliseconds, and "`now` is
later than `verifiedTime` plus the window" is evaluated without rounding
anything: not the product, not the sum, not either instant. `durationDays:
0.7` is exactly 60 480 000 ms, so a claim verified exactly that long before
`now` is not yet stale, and one millisecond later it is.

The decimal value of `ttlSeconds` or `durationDays` is the shortest decimal
numeral that reads back as the same IEEE 754 double the JSON number parses to.
For a number written with at most 15 significant digits that is the number as
written. It is what ECMAScript `String(n)`, Python `repr(float)`, Java
`Double.toString` (JDK 19 or later), Rust `{}` and Go `strconv.FormatFloat(n, 'g', -1, 64)`
produce (up to exponent notation), so an implementation that parses JSON
numbers to doubles formats the double that way and multiplies in integer or
decimal arithmetic; an implementation that keeps the JSON numeral as a decimal
uses it directly. Neither multiplies in binary floating point: `0.7 ×
86 400 000` there is `60479999.99999999`.

A time the fold reads that is absent or is not a timestamp is *unevaluable*.
Each step says what follows: an event sorts before every event with an
evaluable time (Step 2), a resolution is not honoured (Step 1), a blocking
failure is not set aside by a resolution (Step 1), a validity window is stale
(Step 4a). A trace bound that is absent is simply no bound; a trace bound
that is present but is not a timestamp is unevaluable.

JSON Schema validation does not remove these values. `format` is an annotation
by default in JSON Schema 2020-12 and `hachure validate` does not assert it,
so a bundle carrying `"revokedAt": "not-a-timestamp"` is schema-valid as this
package validates and reaches the fold. A validator configured to assert
`format` rejects such a bundle before derivation.

Versions `"3"` and `"2"` do not define a timestamp; see
[§Version 3](#version-3).

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
that satisfies all of these conditions:

- `event.resolvesDispute === true`
- `event.createdAt` is a [timestamp](#timestamps). An event whose time is
  unevaluable (absent, or not a timestamp) is not a resolution, whatever
  traces its actor has: neither the authority window nor "newer than the
  resolution" below can be evaluated against it. The event still takes part
  in Step 2 as an ordinary event, read for its `status` like any other. So a
  claim whose only event is a `verified` resolution with an unevaluable time
  can still derive `verified` through Step 4 when the validity rule needs no
  time (`historical`, `manual`, `commit`); what it loses is the authority to
  override a dispute.
- The event's `actor` has an active `AuthorityTrace` at the time of the decision

An `AuthorityTrace` is active at a given `eventCreatedAt` if all of the following hold:

- `trace.actorRef === event.actor`
- `trace.revokedAt` is absent, or `trace.revokedAt > eventCreatedAt`
- `trace.validFrom` is absent, or `trace.validFrom <= eventCreatedAt`
- `trace.validUntil` is absent, or `trace.validUntil >= eventCreatedAt`
- If `event.authorityRef` is set, `trace.authorityRef === event.authorityRef`

The three time conditions compare instants. A bound that is present must be a
timestamp for its condition to hold: a trace whose `revokedAt`, `validFrom` or
`validUntil` is present but unevaluable is not active.

Traces are considered one at a time, and one active trace is enough. A trace
that is not active, including one with an unevaluable bound, neither
authorises the resolution nor vetoes it: if another trace for the same actor
is active, the resolution is honoured.

If such a resolution event is found:

- Check whether any entailing evidence item satisfies **all** of:
  - `evidence.passing === false`
  - `evidence.blocking !== false`
  - `evidence.observedAt` is later than `resolutionEvent.createdAt`, or
    `evidence.observedAt` is unevaluable (absent, or not a timestamp). A
    blocking failure whose time cannot be evaluated cannot be shown to
    predate the resolution, so it is not set aside by it. This applies to
    blocking failures only; other evidence with an unevaluable `observedAt`
    has no effect here.

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
Let `latestEvent` be the first (most recent) event. Events are ordered by
exact instant. An event whose `createdAt` is unevaluable sorts before every
event whose `createdAt` is a timestamp, however early that timestamp is, so
it is `latestEvent` only when the claim has no event with an evaluable
`createdAt`. This ordering applies wherever the fold sorts events, including
Step 1. (Versions `"3"` and `"2"` read an unparseable `createdAt` as the
epoch instead; see [§Version 3](#version-3).)

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
present. Let `verifiedTime` be `latestEvent.verifiedAt`, or
`latestEvent.createdAt` when `verifiedAt` is absent, read as a
[timestamp](#timestamps).

- If `claim.expiresAt` is set, the claim is stale when `now` is later than
  `claim.expiresAt`, or when `claim.expiresAt` is not a timestamp.
- Else if `claim.ttlSeconds` is set, the claim is stale when `now` is later
  than `verifiedTime` plus `claim.ttlSeconds` seconds, or when `verifiedTime`
  is unevaluable or `ttlSeconds` is not a finite non-negative number.
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
- **`"duration"`** — stale if `now` is later than `verifiedTime` plus
  `policy.validityRule.durationDays` days (`× 86 400 000` ms). Also stale if
  `durationDays` is absent, is not a finite non-negative number, or
  `verifiedTime` is unevaluable.
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

## Version 3

`statusFunctionVersion` `"3"` remains defined so that records resolved under
it can be re-derived. It is this document with the following differences, and
no others:

1. **Timestamps.** Version `"3"` does not define what a timestamp is. The
   bundled implementation reads every time with ECMAScript `Date.parse`, which
   accepts more and less than RFC 3339: a date with no time, a time with no
   offset (read in the evaluator's local time zone, so the result depends on
   where it runs), hour `24`, an impossible day such as `02-30`, and some
   prose dates are accepted; a leap second is not. Where this document says
   "is a timestamp", read "`Date.parse` returns a number"; where it says
   "unevaluable", read "`Date.parse` returns `NaN`" (which it also does for
   an absent value).
2. **Precision.** `Date.parse` keeps whole milliseconds and discards further
   fractional digits, so two times in the same millisecond are equal. Events
   that are equal keep their order in the `events` array. A validity window's
   end is computed in binary floating point (`verifiedTime + ttlSeconds *
   1000`, `verifiedTime + durationDays * 86400000`, in milliseconds).
3. **Event order.** An event whose `createdAt` is unparseable is ordered as if
   at the epoch (`1970-01-01T00:00:00Z`): after an event dated before 1970,
   tied with one dated exactly at the epoch (so the two keep their order in
   the `events` array), and before any dated later.
4. **`now`.** A `now` given as a string is read with `Date.parse`.
5. **Step 1, authority window.** A bound that is present but unparseable
   excludes nothing: the trace stays active. So does every bound when the
   event's `createdAt` is unparseable.
6. **Step 1, resolution time.** A `resolvesDispute` event with an unparseable
   or absent `createdAt` is a resolution like any other, provided its actor
   has a matching trace. No blocking failure is ever newer than it.
7. **Step 1, blocking failure time.** A blocking failure whose `observedAt` is
   unparseable or absent is not newer than the resolution, so the resolution
   stands.

### Migrating from version 3

A bundle derives a different status under version `"4"` only when one of the
following rows applies to a claim, or to a claim it is derived from. A status
can become stronger as well as weaker: the rows marked *either way* depend on
what the rest of the fold derives.

| Bundle shape | v3 | v4 | Why |
|---|---|---|---|
| *Resolution:* every trace matching the resolver has a `revokedAt`, `validFrom` or `validUntil` that is present but not a timestamp (and none of its evaluable bounds already excluded it) | resolution status | as if there were no resolution (*either way*) | Authority that cannot be evaluated is not exercised. |
| *Resolution:* the resolution event's `createdAt` is absent or not a timestamp | resolution status | as if there were no resolution (*either way*) | Neither the authority window nor "newer than the resolution" can be evaluated. |
| *Resolution:* a blocking failure's `observedAt` is absent or not a timestamp | resolution status | `disputed` | A failure that cannot be shown to predate the resolution is not set aside by it. |
| Any time the fold reads is accepted by `Date.parse` but is not an RFC 3339 `date-time` (date only, no offset, hour `24`, impossible day, space separator, prose, a number) | read as `Date.parse` reads it | unevaluable: the event sorts first, the validity window is stale, the bound does not hold | Version `"4"` defines a timestamp. |
| Any time the fold reads is a leap second (`23:59:60` UTC) | unevaluable | the instant that follows it | RFC 3339 permits it. |
| Two times the fold compares with each other (event `createdAt` values, a trace bound and the resolution's `createdAt`, a blocking failure's `observedAt` and the resolution's `createdAt`) differ by less than a millisecond | equal | ordered by their full value (*either way*) | Instants are compared exactly. |
| An event's `createdAt` is unevaluable and the claim has an event dated at or before the epoch (`1970-01-01T00:00:00Z`) | the unevaluable event is the later one (or, at the epoch exactly, tied with it and ordered by position in `events`) | the unevaluable event is the earlier one (*either way*) | An unevaluable time sorts before every timestamp. |
| An event's `createdAt` changes reading under one of the rows above, and the claim has other events | ordered as `Date.parse` reads it | ordered by the version `"4"` reading (*either way*) | `latestEvent` can change. |
| *Verified path:* a validity window whose end the binary floating-point sum does not hit exactly: `verifiedTime` has digits below the millisecond, or the window is not a whole number of milliseconds, or it is longer than 2^53 ms | `now` compared with the rounded sum | `now` compared with the exact end | Windows are exact. Differs only when `now` is within a millisecond of the window's end. |
| `now` given as a string that is not a timestamp, or that has digits below the millisecond or is a leap second | read with `Date.parse` | refused, or read exactly | `now` is a timestamp. |

The `sf-v4-*` conformance vectors cover each row except the last, which a
vector cannot express (a vector's `now` is passed as a date value). A
producer is unaffected if every time it writes is an RFC 3339 `date-time`
with an offset, with at most three fractional digits and no leap second, and
every `ttlSeconds × 1000` and `durationDays × 86 400 000` is a whole number
of milliseconds below 2^53.

## Version 2

`statusFunctionVersion` `"2"` remains defined so that records resolved under
it (`InquiryRecord.statusFunctionVersion`) can be re-derived. It is version
`"3"` (this document with the [Version 3](#version-3) differences) with the
following further differences, and no others:

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
| No events and no entailing evidence; resolved policy has empty `requiredEvidence` and no `requiredMethods` | `proposed` | `unknown` | A policy that requires nothing is no policy, so Step 6 applies and there is no evidence. (Step 7 passed vacuously under version `"2"`.) |
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
implement. Implementations claiming version `"4"` must satisfy every conformance
case in `conformance/` that applies to it: a vector with a
`statusFunctionVersions` array applies only to the versions it lists, and a
vector without one applies to every version. Implementations that still claim
version `"3"` or `"2"` run the vectors that apply to that version.
