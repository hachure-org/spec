# Basis Annotations — Extension Profile

**Profile type:** OPTIONAL extension
**Status:** draft
**Namespace:** `hachure.org/v1`
**Depends on:** core record shapes, [status-function.md](status-function.md)
**Conformance language:** MUST/SHOULD/MAY keywords in this document are to be interpreted per RFC 2119/BCP 14, as defined in [README.md's Conformance language section](README.md#conformance-language).

---

## Principle: say how a status was established, without changing it

A consumer that shows a claim's status is often asked how that status came
about. Was the value read from the system that is authoritative for the
subject? Is the value an estimate? Did a model or a parser collect the
evidence? Was a check attempted that could not run?

Two of those four facts are core Evidence fields from `schemaVersion` `9`:
`inconclusive` and `collectedByKind` (see
[README.md §Evidence](README.md#evidence)). This profile defines the other two
as typed shapes inside the existing free-form `metadata` object:

| Key | On | Says |
|---|---|---|
| `metadata.sourceOfRecord` | Evidence | The observation came from the system that is authoritative for the claim's subject, as backed by a named `AuthorityTrace`. |
| `metadata.estimate` | Claim | `claim.value` is an estimate, with its basis and optional bounds. |

None of the four is a status-function input. They are provenance for display:
a consumer reads them to explain a status and never to derive one.

Both keys are optional and set by the producer. Absence means "not declared"
and never the opposite: a consumer MUST NOT show "Exact", "Measured", or "Not
from the system of record" because a key is missing.

---

## `evidence.metadata.sourceOfRecord`

```json
{
  "id": "evidence.w2.box1",
  "claimId": "claim.w2.wages",
  "evidenceType": "source_excerpt",
  "method": "extraction",
  "sourceRef": "https://employer.example/payroll/w2/2025/123",
  "excerptOrSummary": "Box 1: 84,210.00",
  "observedAt": "2026-02-01T00:00:00.000Z",
  "collectedBy": "payroll-connector",
  "metadata": { "sourceOfRecord": { "authorityTraceId": "trace.payroll.system-of-record" } }
}
```

| Field | Type | Requirement |
|---|---|---|
| `authorityTraceId` | `string` | REQUIRED, non-empty. The `id` of an `AuthorityTrace` in the same bundle (or in the merged bundle the evidence is read from). |

`sourceOfRecord` MUST NOT carry any other key. There is deliberately no boolean
form: a source-of-record assertion is always a reference to an inspectable,
time-bounded, revocable record, and `AuthorityTrace` already is that record.
`confidenceBasis.sourceQuality` is not a substitute; it is a producer's quality
rating, not an authority assertion.

### Resolution rules

A reference is *backed* when all of the following hold. This is a consumer
check; it has no effect on status.

1. An `AuthorityTrace` whose `id` equals `authorityTraceId` exists in the
   bundle.
2. That trace's `authorityType` is `system` or `organization`.
3. The trace's `subject` is the subject of the claim the evidence supports:
   the claim's own `subjectType`/`subjectId`, one of its `subjectAliases`, or a
   subject joined to either by `identityLinks` whose `relation` is
   `equivalent` (the default). `subsumes` and `converts` links do not count.
4. The trace is active at `evidence.observedAt`: `validFrom` is absent or not
   later, `validUntil` is absent or not earlier, and `revokedAt` is absent or
   later. A bound or an `observedAt` that cannot be parsed makes the trace not
   active.

In addition, the trace's `authorityRef` SHOULD start with `system-of-record:`
(for example `system-of-record:w2-wages`), and the evidence's `method` SHOULD
be `observation` or `extraction`. Neither is required for a reference to be
backed.

The trace that backs the example above:

```json
{
  "id": "trace.payroll.system-of-record",
  "subject": { "subjectType": "tax-form", "subjectId": "w2:2025:employee-123" },
  "actorRef": "employer.example/payroll",
  "authorityType": "system",
  "authorityRef": "system-of-record:w2-wages",
  "sourceRef": "https://employer.example/payroll/about",
  "observedAt": "2026-01-01T00:00:00.000Z",
  "validFrom": "2026-01-01T00:00:00.000Z",
  "validUntil": "2027-01-01T00:00:00.000Z"
}
```

### Display rule

- When the reference is backed, a consumer MAY show a neutral statement naming
  whose record it is, for example "From the system of record ·
  `employer.example/payroll`" (the trace's `actorRef`), with the trace's
  `sourceRef` and validity window available on inspection.
- When `sourceOfRecord` is present but not backed, a consumer MUST NOT show an
  authoritative label. It SHOULD show the caveat "Source-of-record label not
  backed".

---

## `claim.metadata.estimate`

```json
{
  "id": "claim.fleet.co2-2025",
  "value": 1240,
  "metadata": {
    "estimate": { "basis": "fuel spend × regional emission factor", "low": 1100, "high": 1400 }
  }
}
```

| Field | Type | Requirement |
|---|---|---|
| `basis` | `string` | REQUIRED, non-empty. How the estimate was produced. |
| `low` | `number` | OPTIONAL lower bound on `claim.value`. |
| `high` | `number` | OPTIONAL upper bound on `claim.value`. |

Presence of `estimate` means `claim.value` is an estimate. The shape matches
`derivationEdges[].sensitivity`, except that the bounds are optional.

- `low` and `high` MUST appear together or not at all, and `low <= high`.
- When bounds are present, `claim.value` MUST be a number and
  `low <= value <= high` MUST hold. Bounds on a non-numeric `value` are
  malformed.
- `estimate` MUST NOT carry any other key.

`estimate` bounds the *value*. `conclusionConfidence.interval` bounds the
probability that the conclusion is correct; the two are unrelated.

A malformed `estimate` is not a smaller estimate. A consumer SHOULD treat it as
distinct from both "no estimate" and a well-formed one, and MUST NOT display
bounds taken from it.

Suggested display: the caveat "Estimated", or "Estimated · 1,100–1,400" when
bounds are present, with `basis` available on inspection.

---

## Checking the profile shapes

`metadata` is an open object in the core schemas, so validating a bundle
against `trust-bundle.schema.json` accepts any shape under these keys. The
`hachure` package exports two functions that implement the rules above:

```js
import { validateBasisAnnotations, resolveSourceOfRecord } from 'hachure';

validateBasisAnnotations(bundle);
// → [] when every estimate and sourceOfRecord is well-formed, otherwise
//   [{ instancePath: '/claims/1/metadata/estimate', message: '…' }, …]

resolveSourceOfRecord(bundle, evidence);
// → { backed: true, trace } or { backed: false, reason }
//   reason: not-declared | malformed | claim-not-found | trace-not-found |
//           authority-type | subject-mismatch | not-active
```

Neither is called by status derivation or by `hachure validate`. A consumer
that adopts the profile calls them, or implements the same rules.

---

## Relationship to the status function

Adopting this profile requires **no schema migration** and **no
`statusFunctionVersion` change**. The status function reads no `metadata` on
any record ([status-function.md §Fields that are not inputs](status-function.md#fields-that-are-not-inputs)),
so a bundle derives the same statuses with these keys, with malformed values
under them, or without them. The `sf-basis-fields-inert` conformance vector
carries both keys and the package's suite re-derives it with the keys removed.

A consumer that has not adopted the profile sees nothing, and so never shows
an authority label it has not checked.

---

## Worked example

[`examples/basis-annotations-bundle.json`](examples/basis-annotations-bundle.json)
is a `schemaVersion` `9` bundle with two claims:

- `claim.w2.wages` derives `verified`. Its evidence was extracted by a
  deterministic connector and carries a backed `sourceOfRecord`.
- `claim.fleet.co2-2025` derives `unknown`. Its value is an estimate with
  bounds. The fuel ledger was read by a model (`collectedByKind: "model"`,
  with `metadata.collectorModel`), and the telematics check the policy also
  requires could not run (`inconclusive`), so that requirement is unmet.

---

## Residuals

**A source-of-record trace is still producer-asserted.** At assurance level L0
nothing stops a producer from writing an `AuthorityTrace` that names itself
authoritative. [assurance.md](assurance.md) is how a consumer raises that bar.
Because nothing here feeds status, a mislabel can change what a display says
but not what a gate decides.

**A source-of-record trace can also enable dispute resolution.** Step 1 of the
status function accepts any active trace whose `actorRef` equals a
`resolvesDispute` event's actor, and compares `authorityRef` only when the
event sets one. The `system-of-record:` prefix makes these traces
identifiable. A consumer SHOULD warn when the actor of a source-of-record
trace also resolves disputes.

---

## Key names and promotion to core

**Key names.** The keys are bare (`metadata.sourceOfRecord`,
`metadata.estimate`), like [waivers.md](waivers.md)'s `metadata.waiver`. This
repository has not yet settled a namespacing convention for metadata profile
keys. If one is adopted, these keys follow it, and this document will say how
both spellings are read during the change.

**Promotion.** These shapes start as a profile so that a real producer
exercises them before they are fixed in the schemas. Each is a candidate for a
core field (`evidence.sourceOfRecord`, `claim.estimate`) once one producer
emits it in a real workflow and, for `sourceOfRecord`, a consumer has
exercised every not-backed path in [Resolution rules](#resolution-rules). At
promotion a consumer reads both locations; the core field wins when both are
present and disagree, and the disagreement SHOULD be surfaced.

---

## Non-goals

- **A status input.** No key here changes a derived status, satisfies a
  policy requirement, or disputes a claim.
- **A policy on collector kind.** Excluding or down-weighting evidence because
  a model collected it would change status derivation. It is not defined here
  or in the core specification.
- **Authenticating the authority.** Whether the named system really is the
  system of record is established by the consumer's assurance policy, not by
  this profile.
- **A value-uncertainty model.** `estimate` carries a basis and a range. It
  does not define distributions, units, or how ranges combine across
  derivations (`derivationEdges[].sensitivity` covers per-edge ranges).
