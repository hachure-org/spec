# Waivers — Extension Profile

**Profile type:** OPTIONAL extension
**Status:** draft
**Namespace:** `hachure.org/v1`
**Depends on:** core record shapes, [status-function.md](status-function.md)
**Conformance language:** MUST/SHOULD/MAY keywords in this document are to be interpreted per RFC 2119/BCP 14, as defined in [README.md's Conformance language section](README.md#conformance-language).

---

## Principle: a waiver documents an accepted gap; it does not change the status

An `assumed` claim is, per [status-function.md](status-function.md), a claim
that is operationally present but not appraised to affirmation — a real,
honestly-recorded gap between "asserted" and "verified." Producers and
policies sometimes need to accept that gap deliberately: a check that could
not be re-run, a control that is genuinely out of scope for this cycle, a
finding that a human has reviewed and decided not to block on. This profile
defines a typed, consistent vocabulary for recording *why* a gap was accepted
and *who* accepted it, so that "assumed" and "assumed, and a human signed off
on that" are distinguishable without inventing a new status value.

A waiver is documentation attached to an already-derived status, not an input
that manufactures a better one. It never turns `assumed` into `verified`,
never turns `disputed` or `rejected` into anything else, and is inert on
every status other than `assumed` (or `stale`/`revoked`, per
[Relationship to stale and revoked](#relationship-to-stale-and-revoked)
below). The doctrine is the same one [assurance.md](assurance.md) states for
signing: the mechanism is layered on top of an already-valid record, not a
precondition for record validity, and not a lever that upgrades a record's
derived state.

---

## The typed waiver shape

Producers that adopt this profile MAY populate a `waiver` object inside the
*existing* free-form `claim.metadata` field (`claim.schema.json` defines
`metadata` as `{"type": "object"}` — an open extension point, not a fork):

```json
{
  "metadata": {
    "waiver": {
      "reason": "string, non-empty",
      "approved_by": "string, non-empty",
      "approved_at": "string, RFC 3339 date-time"
    }
  }
}
```

| Field | Type | Requirement |
|---|---|---|
| `reason` | `string` | Non-empty. Why the gap is being accepted rather than closed. |
| `approved_by` | `string` | Non-empty. Free text naming the approver (see [Residuals](#residuals) — this is not a verified identity). |
| `approved_at` | `string` | Non-empty, matching the RFC 3339 `date-time` production (`YYYY-MM-DDThh:mm:ss[.sss](Z|±hh:mm)`) with a real calendar date. When the waiver was granted. |

All three fields are REQUIRED for a waiver to be complete; a partially-filled
`waiver` object (missing a field, an empty string, or an unparseable
`approved_at`) is a malformed waiver, not a smaller waiver. Consumers SHOULD
treat an incomplete waiver as distinguishable from both "no waiver" and "a
complete waiver" rather than silently coercing it to either (see
[Consumer-derived verdicts](#consumer-derived-verdicts-informative))..
A conformant `approved_at` validator MUST reject any value that does not
match the RFC 3339 `date-time` grammar and MUST reject an impossible calendar
date (e.g. `2026-02-30`), but this profile does not require validators to
additionally enforce leap-second *placement* — RFC 3339's grammar permits a
`:60` seconds value at any minute, and a validator MAY accept it anywhere in
the grammar rather than restricting it to an actual leap-second instant
(`23:59:60Z`); consumers that need stricter leap-second placement enforcement
MAY layer that check on top.

This is the shape a real-world producer already stamps: `kontourai/flow-agents`
ADR 0020 §3 ("Waivers reuse the existing `accepted_gap` status") documents a
trust-reconcile pipeline that sets `claim.metadata.waiver = {reason,
approved_by, approved_at}` on every session-local claim it accepts as a gap,
justified by exactly this reasoning — "`claim.metadata` is free-form per
`claim.schema.json` — no schema fork." This profile formalizes that producer
convention as a named, documented extension so other producers and consumers
can interoperate on it without re-deriving the same shape independently. The
motivating consumer need — a shared vocabulary a downstream tool like
`kontourai/surface` can project into a verdict — is tracked in
`kontourai/surface#123` and `kontourai/flow-agents#511`.

---

## Relationship to the status function

Adopting this profile requires **no schema migration** and **no
`statusFunctionVersion` change**. `status-function.md`'s Step 3 ("Assumed
from event") returns `assumed` from the fold whenever `latestEvent.status ===
"assumed"`, independent of anything in `claim.metadata`. An `assumed` claim
with a complete waiver, an incomplete waiver, or no waiver at all folds to
the identical `assumed` status — the fold never inspects `metadata.waiver`.

This mirrors [assurance.md](assurance.md)'s own "Core-format changes"
non-goal: waiver *validity* — whether a waiver is present, complete, well-
formed, or (looking ahead) cryptographically attributable — is a downstream
consumer concern, evaluated by a policy layer or a projection built on top of
the derived status. It is not a status-derivation input, and this profile
does not propose making it one. A bundle with no waiver vocabulary in use at
all is fully conformant with the core specification; adopting this profile
changes nothing about how any existing conforming implementation derives
status.

### Relationship to stale and revoked

The same `claim.metadata.waiver` shape MAY also be attached to a claim whose
derived status is `stale` or `revoked` — for example, to document that a
human reviewed an expired or invalidated claim and accepted it as-is pending
renewal. This profile does not define distinct semantics for that case beyond
noting it is representable with the same shape; the fold, again, does not
consult `metadata.waiver` when deriving `stale` or `revoked`, so the meaning
of "reviewed and accepted, but not fixed" is left to consumer policy exactly
as it is for `assumed`.

---

## Residuals

**Unauthenticated `approved_by` (honest).** `approved_by` is free text. This
profile does not require it to resolve to a verified identity, a signing
key, or an OIDC subject — a producer can stamp any string into that field,
and nothing in the core specification or this profile catches a
fabricated or mistaken value. A waiver's accountability, absent further
adoption, rests on the same footing as any other unsigned producer claim:
the trustworthiness of the transport channel and the producer's declared
identity in the bundle's `source` field, plus whatever out-of-band review
process (a required job's visible log line, a CODEOWNERS review) the
producer layers on top.

**The closing mechanism already exists; this profile does not invent one.**
Binding `approved_by` to a verifiable identity is exactly what
[assurance.md](assurance.md) already defines: an L1 (OIDC-backed,
keyless/ephemeral) or L2 (held-key) signature over the record carrying the
waiver, with the resulting human-readable identity presented per that
profile's [Identity presentation](assurance.md#identity-presentation)
section. A producer that wants an authenticated `approved_by` adopts the
Assurance profile on top of this one — signs the claim, the evidence, or an
attestation record that references the waiver — rather than this profile
defining a second, parallel identity mechanism. Until a producer does that,
`approved_by` remains, honestly, a self-asserted string.

---

## Consumer-derived verdicts (informative)

The following is guidance for consumers projecting the typed waiver shape
into an application-level verdict; it is non-normative and does not add
requirements to producers or to the status function.

A consumer that derives a per-claim verdict typically distinguishes at least
these outcomes (the vocabulary the optional
[report extension schema](#report-extension-schema-optional) encodes):

- `not-applicable` — the claim is not `assumed` and not a waiver-bearing
  `stale`/`revoked` claim, so waiver validity is not a meaningful question.
- `bare-assumed` — `assumed` with no `metadata.waiver` at all; never defaults
  to an acceptable verdict.
- `complete-waiver` — `assumed` with a `metadata.waiver` whose `reason`,
  `approved_by`, and `approved_at` are all well-formed.
- `incomplete-waiver` — a `metadata.waiver` is present but at least one of the
  three fields is missing or malformed.
- `stale-or-revoked-waiver` — the claim's derived status is `stale`/`revoked`
  and a `metadata.waiver` is (still) attached.
- `command-backed-waiver-rejection` — see below.

A command-backed check — evidence whose `evidenceType` is `test_output`
(`evidence.schema.json`) — is, by construction, re-runnable: its truth is
established (or refuted) by executing the command again, not by human
judgment. A waiver documents an accepted gap in something that was *not*
re-runnably verified; attaching one to a claim that a command already could
have verified does not accept a gap, it bypasses a check that was available.
Consumers MAY treat `assumed` status + `evidence.some(e => e.evidenceType ===
"test_output")` + a present `metadata.waiver` as a distinct rejection
verdict rather than folding it into an ordinary "waived" outcome — Surface's
`deriveWaiverValidity` projection does exactly this, returning
`command-backed-waiver-rejection` for that combination. This is a consumer-
side policy choice this profile documents as a recommended pattern, not a
rule the status function enforces; a producer-side control aiming for the
same effect (refusing to accept `--accepted-gap-reason`/`--waived-by` on a
command-backed check in the first place, as `kontourai/flow-agents` ADR 0020
§3 also documents) achieves it earlier, before the waiver ever reaches a
bundle.

## Report extension schema (optional)

A consumer that projects waiver validity onto a `TrustReport` — attaching a
per-claim verdict map — has an optional strict validation surface:
[`schemas/trust-report-waivers.schema.json`](schemas/trust-report-waivers.schema.json).
It references the neutral core report field set
([`trust-report.schema.json#/$defs/core`](schemas/trust-report.schema.json))
and adds exactly two fields — `waiverValidityByClaimId` (a map of claim id to
`{ verdict, approverAuthenticated, waiver?, incompleteFields? }`, where
`verdict` is one of the [consumer-derived verdicts](#consumer-derived-verdicts-informative)
above) and `waiverValidityFunctionVersion` (the derivation-algorithm version,
mirroring `statusFunctionVersion`). A report that carries these fields
validates against the extension schema; the core `trust-report.schema.json`
rejects them as unknown, so a consumer chooses the surface matching what it
expects.

This is additive and optional. The core `trust-report.schema.json` was
restructured to expose its field set as an open `$defs/core` building block so
that extension profiles can reference and extend it; validating a report
against the core schema alone remains exactly as strict as before (any field
outside the core set is still rejected). `approverAuthenticated` is typed as a
boolean rather than a constant `false` so that a future identity-binding
profile (see [Residuals](#residuals)) can set it true without a breaking
schema change, even though the waivers profile as defined here always leaves
it `false`.

---

## Non-goals

- **Core-format changes.** No core record schema (claim, evidence, event,
  policy, bundle) is altered by this profile, and the `TrustReport` core field
  set and its strictness are unchanged — `trust-report.schema.json` was
  refactored to expose that field set as a referenceable `$defs/core` block for
  extension, a behaviour-preserving change, not a new or altered core field.
  Adopting the waivers profile requires no schema migration and no changes
  to the status derivation function. `claim.metadata.waiver` is one
  convention living inside an already-free-form field; the report extension
  fields live only in the optional extension schema.
- **A new identity or signing mechanism.** This profile does not define how
  to authenticate `approved_by`. That closing mechanism is
  [assurance.md](assurance.md), adopted on top of this profile, not a new
  scheme invented here.
- **A new status value.** Waivers do not add a status value, a new
  `TrustStatus` member, or a new event type. `assumed` (and, where used,
  `stale`/`revoked`) remain the only statuses a waived claim can carry.
- **Producer-side enforcement rules.** Whether a producer refuses to let a
  command-backed check be waived, requires both `reason` and `approved_by`
  together, or enforces any other authoring-time policy is producer choice.
  This profile documents the typed shape and its relationship to the status
  function; it does not mandate a specific producer-side authoring workflow.
