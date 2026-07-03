# Hachure — an open trust format

**Namespace:** `hachure.org/v1`
**Status:** pre-1.0, hard versioning, no compatibility promises yet
**Originally developed by:** [Kontour AI](https://kontourai.io)

---

## Install

```sh
npm i hachure
```

The package ships the normative JSON schemas, conformance test vectors, the
`statusFunctionVersion` constant that ties implementations to a specific
algorithm revision, and a bundled, dependency-free implementation of status
derivation and merge — so you can produce, validate, merge, and evaluate
Hachure records with nothing but this package:

```js
import { deriveStatuses, mergeBundles, canonicalize } from 'hachure';

const merged = mergeBundles([bundleFromScanner, bundleFromCI]);
const statusByClaimId = deriveStatuses(merged, new Date());
```

Or from the command line:

```sh
npx hachure validate bundle.json     # schema-validate a TrustBundle
npx hachure derive bundle.json       # derive per-claim statuses
npx hachure merge a.json b.json      # merge producer bundles
npx hachure vectors                  # run the conformance vectors
```

The prose specification is normative; the bundled code is a conforming
implementation of it (proven in-repo by running every conformance vector),
not a privileged one.

**Claiming conformance:** run the test vectors from `testVectors` against your
implementation (`testVectors` covers the status-derivation vectors; the L3 merge
vectors ship separately under `conformance/merge/` and via the
`./conformance/*.json` export path). For each vector, call your status-derivation function with
`vector.input` and `vector.now`, then assert that the derived status for every
claim ID matches `vector.expect.statusByClaimId`. Passing all vectors for a given
status function version is the bar for a conforming implementation.

```js
import { testVectors, statusFunctionVersion } from 'hachure';

for (const { name, vector } of testVectors) {
  const results = deriveStatuses(vector.input, new Date(vector.now));
  for (const [claimId, expected] of Object.entries(vector.expect.statusByClaimId)) {
    assert.equal(results[claimId], expected, `${name} / ${claimId}`);
  }
}
```

---

## What this is

Hachure is an open format for portable trust state. It defines how claims about
real-world subjects — and the evidence, policies, verification events, authority
records, and derivation rules behind them — are represented so they can cross
product and vendor boundaries without the receiver needing access to the
producer's internals.

Hachures are the short strokes on hand-drawn maps that show the shape and
steepness of terrain. This format does the same for trust: it shows the contours
of what is supported, what is stale, what is disputed, and what is simply
asserted.

The format is deliberately not named after any company or product, and depends on
no vendor's software: the `hachure` package alone produces, validates, merges, and
evaluates records. Known conforming implementations are listed under
[Implementations](#implementations); anyone can add one by passing the conformance
vectors.

**Governance intent:** Hachure is currently developed by Kontour AI, which holds
the name to protect it. We intend to move the specification to neutral
governance as adoption warrants.

---

## Why this exists

Every system that verifies anything — CI pipelines, security scanners, compliance
reviews, data-quality checks, human sign-offs — stores its conclusion in its own
database. The moment that conclusion crosses a boundary (vendor to customer, tool
to dashboard, agent to deployment gate), it degrades into a boolean, a badge, or a
PDF: the evidence is gone, there is no expiry, and the receiver has no way to
re-check the reasoning. You either trust the summary or redo the work.

Hachure keeps the whole picture together and portable. A claim travels with its
evidence, the policy it was judged against, and the append-only event history —
and the status is not an opinion stored in a field, it is a pure, versioned
function of that data (`status = f(claim, evidence, events, policy, authority,
now)`). Any receiver can recompute it, watch it go `stale` on its own as evidence
ages, and merge bundles from producers that disagree without one silently
overwriting the other: conflicts are preserved as contradiction gaps, never
resolved by last-write-wins.

The defaults are deliberately honest about trust: an unsigned bundle is a valid
bundle (Assurance L0), because most trust state inside an organization never
needed a signature — it needed structure. Signing is a dial you turn up
([assurance.md](assurance.md)) when records cross a boundary where identity
matters.

### Where you might use it

- **AI agent gates.** An agent (or CI job) may act only when specific claims are
  `verified` and fresh: express the gate as a [DerivationRule](#derivationrule)
  ("deploy allowed if `test-suite-passes` and `security-scan-clean` are both in
  `acceptedStatuses: [verified]`"), and record every decision as an
  [InquiryRecord](#inquiryrecord) — an audit receipt that says exactly what was
  knowable, from which claims, under which `statusFunctionVersion`, at the moment
  the agent acted. This is the difference between "the agent said it checked" and
  a replayable record of what it checked.
- **Vendor assurance without the PDF.** Instead of a static compliance answer, a
  vendor publishes a TrustBundle and serves the
  [verification endpoint](verification-endpoint.md). The customer re-derives
  statuses themselves; when the pen-test evidence passes its policy's validity
  window, the claim goes `stale` on the customer's side automatically — no
  annual-questionnaire lag.
- **Release provenance with living status.** Signatures (in-toto, SLSA) freeze
  what was true at signing time. Wrap a bundle in a DSSE envelope
  ([interop-in-toto.md](interop-in-toto.md)) to anchor the release moment, then
  keep serving event deltas so a consumer can see that a claim verified at
  release has since been disputed or revoked. hachure.org's own
  [/trust](https://hachure.org/trust) page runs this pattern live.
- **Merging scanners that disagree.** Two security tools scan the same artifact
  and reach different conclusions. Merge both bundles ([merge.md](merge.md)):
  both claims survive under their producers, the disagreement surfaces as a
  `contradiction` transparency gap, and a human (or an authority-gated
  resolution event) settles it on the record instead of the louder tool winning.

---

## Namespace and versioning

All core trust-format records use the `hachure.org/v1` namespace. Producers
that define extension records outside this specification use their own
product-scoped namespaces (a domain the producer controls), never
`hachure.org/*`.

Pre-1.0: the format uses hard breaking changes rather than compatibility aliases.
No forward or backward compatibility guarantees are made across versions. Version
bumps are reflected in `schemaVersion` (an integer field in TrustBundle, currently
`6`) and in the status function version (a string exported by this package and by
every conforming implementation as `statusFunctionVersion`, currently `"2"`).

Schema version `4` adds optional claim freshness fields (`expiresAt` /
`ttlSeconds`) and an optional invalidation event vocabulary (event `status:
"revoked"` and event `type: "invalidation"`). All additions are optional, so
every bundle valid at `schemaVersion` `3` remains valid; only the deriver
(`statusFunctionVersion` `2`) folds the new fields into a status. See
`status-function.md` and the `sf-expired-window` / `sf-revoked-event` /
`sf-no-freshness-fields` conformance vectors.

Schema version `5` renames the Claim `surface` field to `facet` and makes it
optional (previously required) — the one deliberate hard break named above.
Bundles declaring `schemaVersion` `2` through `4` are no longer schema-valid
under this release: their `surface` field is rejected by `claim.schema.json`'s
`additionalProperties: false`. Producers MUST re-emit as `facet` and self-declare
`schemaVersion: 5`. See `merge.md` §4 for `facet`'s (unchanged) treatment in claim
identity.

Schema version `6` adds an optional TrustBundle `proof` block (an object holding
integrity anchors — e.g. a `transparency_log` anchor with a Rekor entry UUID),
resolving the previous contradiction where [assurance.md](assurance.md),
[interop-in-toto.md](interop-in-toto.md), and
[verification-endpoint.md](verification-endpoint.md) referenced a `proof` field
the schema rejected. The addition is optional: every bundle valid at
`schemaVersion` `5` remains valid (the schema enum accepts both `5` and `6`), and
`proof` never changes status derivation — signing remains an out-of-band
assurance concern.

---

## Conformance language

The key words **MUST**, **MUST NOT**, **REQUIRED**, **SHALL**, **SHALL NOT**,
**SHOULD**, **SHOULD NOT**, **RECOMMENDED**, **MAY**, and **OPTIONAL** in this
document and in every other normative document in this repository
(`merge.md`, `assurance.md`, `verification-endpoint.md`,
`status-function.md`, `interop-in-toto.md`, `SECURITY.md`) are to be
interpreted as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119)
and clarified by [RFC 8174](https://www.rfc-editor.org/rfc/rfc8174) (BCP 14),
only when they appear in all capitals, as shown here.

---

## Scope: core record shapes

This specification covers the following record types. Each is a first-class concept
in the format; none requires a specific producer or product to instantiate.

### TrustBundle

The central wire record. A portable, point-in-time package of trust state from a
single producer: claims, evidence, policies, verification events, and optional identity
links, claim groups, authority traces, and a `proof` block (signing anchors — see
[assurance.md](assurance.md)).

Plain-language definition:

> A Trust Bundle is a portable, point-in-time package of trust state from a single
> producer — claims, the evidence and verification events behind them, and the policies
> the producer played by — packed so it can cross a product boundary without the
> receiver needing access to the producer's internals.

The `source` field identifies the producer (free-text, may vary per run); an optional
`producerId` field carries a stable, unsigned identifier for the producing system,
consistent across every bundle it emits. When present, `producerId` MUST be a
non-empty string. Bundles from multiple producers can be merged
into one ledger without last-write-wins and without deleting losing evidence; conflicts
between claims are surfaced as `contradiction` transparency gaps, never silently
resolved or used to flip a claim's status. The full specification of identifier
conventions and the merge algorithm is in [merge.md](merge.md).

An optional `identityLinks` array declares co-referent subjects — real-world entities
known under more than one identifier.  Each link carries a stable optional `id`, a
`subjects` array (two or more `{ subjectType, subjectId }` refs), and an optional
`relation` field: `"equivalent"` (default — the subjects denote the same entity),
`"subsumes"` (the first subject is a superset of the others), or `"converts"` (the
subjects are related by a unit or scale transformation, parameterised by an optional
`conversion: { factor, offset, note }` object).  A link may additionally carry a
`mappingClaimId` pointing to the Claim that evidences the mapping assertion itself;
when set, inquiry resolution through that link is subject to a weakest-link status cap —
a disputed mapping claim cannot yield a verified answer.

### Claim

An assertion about a real-world subject. A claim has a stable `id`, a `subjectType`
and `subjectId` pair identifying what is being asserted, an optional `facet` (a
producer-defined grouping or namespace for the claim — see `merge.md` §4 for why
it's excluded from cross-producer claim identity), a `claimType`, a
`fieldOrBehavior`, and a `value`. Claims carry optional `impactLevel`, integrity
anchors, policy references, derivation edges, and confidence basis metadata.

Derived trust status is never stored on the claim itself as source of truth; it is
computed from the surrounding bundle at evaluation time.

Claims also carry two optional round-trip fields, tolerated but never producer-authored:
`producerStatus` (the producer's own declared status, present when a TrustReport's
derived claims are re-fed as bundle input) and `freshness` ({ `asOf`, `expiresAt`?,
`stale` }, a freshness stamp on derived/report claims).

### Evidence

An item of support for a claim. Evidence is linked to a claim via `claimId`. Each
item carries `evidenceType`, `method`, `sourceRef`, an excerpt or summary, and
`observedAt`. Evidence can declare a `passing` boolean and a `blocking` flag; a
non-passing, non-blocked evidence item is a soft signal; a non-passing blocking
item can cause a `disputed` status outcome.

`supportStrength` (default `"entails"`) distinguishes full entailment from citation:
only `"entails"` evidence feeds policy requirement checks. `"cited"` evidence is
contextual but does not satisfy required-evidence policies.

### VerificationPolicy

A policy declares what evidence and methods are required to reach `verified` status
for a given `claimType`, and how long verification remains valid. Core fields:
`requiredEvidence` (array of evidence types), `requiredMethods`, `requiresCorroboration`,
`validityRule` (one of `duration`, `commit`, `historical`, `manual`), and
`acceptanceCriteria`.

Policies are resolved against claims by `verificationPolicyId` first, then by
`claimType` exact match, then by walking the `parentType` chain from most-specific
to most-general. See [Status Derivation](status-function.md) for how the resolved
policy feeds the derivation.

### VerificationEvent

An append-only event representing a status decision for a claim. Events carry
`claimId`, `status`, `actor`, `method`, `evidenceIds`, and timestamps. Events are
never updated; they accumulate as a ledger. The most recent event of a given kind
shapes the derived status via the fold described in [Status Derivation](status-function.md).

A verification event may carry `resolvesDispute: true` and an `authorityRef` to
indicate it is an authority-gated dispute-resolution decision (see
[status-function.md](status-function.md) Step 1).

### AuthorityTrace

A record establishing that a named actor held a named authority over a subject during
a time window. Authority traces are the credential that makes a dispute-resolution
event binding: the fold checks that the resolution event's actor has an active trace
at the decision timestamp. Fields: `actorRef`, `authorityType`, `authorityRef`,
`validFrom`, `validUntil`, `revokedAt`, and optional integrity anchors.

### InquiryRecord

An append-only record capturing the resolution of a consumer-side question (Inquiry)
against the ledger. An InquiryRecord carries the original question, the
resolution path (matched claim or named derivation rule plus input claims), the answer
with its status at evaluation time, a frozen snapshot of input claim statuses, the
`statusFunctionVersion` used, and the `resolvedAt` timestamp.

Records never go stale because they never assert present-tense truth; they assert what
was knowable at a specific moment. The `statusFunctionVersion` field enables
re-evaluation if the derivation algorithm changes.

### DerivationRule

A named, versioned rule that derives a boolean answer from existing claims.
Rules compose claims using value predicates (`eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `exists`)
and status predicates (`acceptedStatuses`), combined with `"all"` or `"any"` — the
portable expression of gate-style checks ("proceed only if these claims hold these
statuses"). The weakest-link confidence ceiling propagates through rule evaluation
unchanged.

---

## Status semantics

Status is a pure, versioned function of the bundle data and a `now` timestamp. The
full specification of the derivation algorithm is in [status-function.md](status-function.md).

The nine possible statuses:

| Status | Meaning |
|---|---|
| `unknown` | No supporting evidence or events; the claim cannot be evaluated. |
| `proposed` | Evidence exists or a verification event indicates proposed, but policy requirements are not fully met. |
| `assumed` | The claim is treated as true for operational purposes without full verification evidence. |
| `verified` | A verification event asserts verified, required policy evidence is present, and the verification is still fresh. |
| `stale` | The most recent verified event has expired under the policy's validity rule. |
| `disputed` | A verified claim has blocking contradicting evidence, or a terminal dispute event exists. |
| `superseded` | A terminal event marks the claim as superseded. |
| `rejected` | A terminal event marks the claim as rejected. |
| `revoked` | An explicit invalidation event has revoked the claim's verification. For single-claim status derivation this folds to `stale` (see [status-function.md](status-function.md), Step 2) unless a later verification event re-asserts the claim; the reference implementation still tracks `revoked` as a distinct, weakest-ranked raw status for `Claim.status`/`VerificationEvent.status`, claim-group rollups, and weakest-link ordering. |

---

## Normative schemas

The JSON schemas at [`schemas/`](schemas/) are the normative wire contracts for
all core record shapes. The following schema files are part of this format:

| Schema file | Record type(s) |
|---|---|
| `trust-bundle.schema.json` | TrustBundle (top-level container) |
| `claim.schema.json` | Claim |
| `evidence.schema.json` | Evidence |
| `verification-policy.schema.json` | VerificationPolicy |
| `verification-event.schema.json` | VerificationEvent |
| `trust-report.schema.json` | TrustReport (derived, not emitted by producers) |
| `derivation-rule.schema.json` | DerivationRule |
| `inquiry-record.schema.json` | InquiryRecord |

Schemas are not duplicated in this directory. The reference implementation
validates TrustBundle input against these schemas via `validateTrustBundle()`.

---

## Profiles

The core specification covers record shapes and status semantics. Profiles are
optional, independently adoptable conventions for interop and transport. Adopting
a profile requires no changes to core record shapes or the status function.

| Profile | File | What it covers |
|---|---|---|
| in-toto interop | [interop-in-toto.md](interop-in-toto.md) | Wrapping a TrustBundle as a signed in-toto Statement v1 / DSSE envelope. |
| Verification endpoint | [verification-endpoint.md](verification-endpoint.md) | Producer-served HTTP endpoint for receivers to fetch post-export event deltas. |
| Assurance | [assurance.md](assurance.md) | Signing as a dial: L0/L1/L2 assurance levels, identity presentation, consumer policy, and human signing ceremony. |

---

## Relationship to W3C Verifiable Credentials

Hachure and the [W3C Verifiable Credentials](https://www.w3.org/TR/vc-data-model-2.0/)
data model both represent claims-with-evidence, and it is a fair question why
this format does not simply build on VC instead of defining its own record
shapes.

**The short answer:** DID-based issuer identity is the dominant convention
in the VC ecosystem — a resolvable, typically key-based identifier scheme —
though the VC data model itself permits any URL as an issuer identifier.
Hachure treats signing as an opt-in [Assurance](assurance.md) dial (L0
unsigned by default, L1/L2 signed on request), not a precondition for a
record to exist.
Requiring DIDs for `producerId` ([merge.md](merge.md) §2) would collapse that
layered design into "every producer needs key infrastructure just to be
namespaced for merge" — a strictly higher bar than merge, or basic claim
authorship, actually needs. `producerId` is deliberately at the same trust
level as the existing `source` field: free-text, unsigned, always available,
upgradable to a cryptographically verifiable identity only when a consumer's
policy requires it.

This is not a rejection of DIDs or VCs — an implementation that wants
DID-backed producer identity can express it today via Assurance L1/L2's OIDC-
or held-key-backed signing (`assurance.md` §"Identity presentation"), and
nothing here prevents a future profile from mapping Hachure records into a VC
envelope for interop with VC-native ecosystems. It is a statement that Hachure
does not *require* DID infrastructure just to produce a valid, useful record —
consistent with the "signing is a dial, not a gate" principle that runs
through the whole Assurance profile.

See [merge.md](merge.md) §10 "Prior art" for the fuller technical rationale,
and [assurance.md](assurance.md) for how signed identity is layered on top
when a consumer needs it.

---

## Relationship to IETF SCITT

[SCITT](https://datatracker.ietf.org/wg/scitt/about/) (Supply Chain Integrity,
Transparency, and Trust) is the closest prior art to Hachure's problem space:
issuers sign statements about artifacts (COSE-signed), register them on
append-only transparency services, and receive receipts proving registration.
It is worth being precise about the split, because the two compose rather than
compete:

- **SCITT answers "who said this, and is it on the record?"** It provides
  non-repudiable, tamper-evident registration of *frozen signed statements*.
  It deliberately does not define what a statement means, how evidence
  relates to a claim, what policy governs verification, or how a statement's
  standing changes as new facts arrive.
- **Hachure answers "what is the standing of this claim right now?"** Claims
  travel with evidence, policy, and an append-only event ledger, and status
  is recomputed — `verified` decays to `stale`, gets `disputed` by blocking
  evidence, or is `revoked` by a later event — without ever editing the
  original record.

Composition is the natural shape: a TrustBundle (or its DSSE envelope per
[interop-in-toto.md](interop-in-toto.md)) can be registered as a SCITT signed
statement, and the resulting receipt belongs in the bundle's `proof` block as
a `transparency_log` anchor. SCITT then guarantees the bundle existed and who
registered it; Hachure keeps answering what its claims are worth as time
passes. As with DIDs above, none of this is required: SCITT registration is
an Assurance-layer dial, not a precondition for a valid record.

---

## Out of scope: future extension profiles

The following producer domains are explicitly out of scope for this core specification.
Each is a candidate for a future extension profile that imports the core record shapes
and adds domain-specific vocabulary:

- **Extraction/review provenance chains** — the source → extraction → candidate →
  review → claim pipeline a producer runs *before* a claim lands in a bundle. The
  bundle is the output boundary; the review trail above it is producer-scoped.
- **Repository/codebase standards** — per-repo claim vocabularies, per-run evidence
  collection conventions, and merge-gate integration records.
- **Gate/run records** — gate-expectation vocabularies, run-scoped views, and
  gate-result record shapes built on top of `DerivationRule` and `InquiryRecord`.

Extension profiles reference this spec as their foundation and declare any additional
fields or constraints. They do not modify the core record shapes. (Kontour AI's
product suite defines profiles in each of these domains; they carry product-scoped
namespaces and no special status in this specification.)

---

## Executable conformance

[`conformance/`](conformance/) contains test vector bundles and expected per-claim
statuses at a fixed `now`. The specification is executable in-repo: this package's
suite runs every status-derivation vector against the bundled implementation
(`test/derive.conformance.test.mjs`) and every merge vector — under every
permutation of the input bundles — against the bundled merge
(`test/merge.conformance.test.mjs`). `npx hachure vectors` runs the same check
from the command line. Independent implementations prove conformance by running
the same vectors via the `testVectors` export.

See [conformance/README.md](conformance/README.md) for the test vector inventory, and
[conformance/manifest.json](conformance/manifest.json) (also exported as
`conformanceManifest`) for a machine-readable index of what an implementation
must pass to claim conformance at each level (L1 schema-valid records, L2
status-derivation vectors, L3 merge vectors).

---

## Project documents

- **[SECURITY.md](SECURITY.md)** — the format's honest trust boundaries:
  source/producerId spoofing, verification-endpoint replay risk, and
  whole-bundle substitution, and which [Assurance](assurance.md) level
  mitigates each.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — how to propose a change, when a
  design writeup is expected, and the conformance-vector requirement for
  behavior changes. *(Draft — see the banner in that file.)*
- **[GOVERNANCE.md](GOVERNANCE.md)** — who currently has decision authority,
  and what "neutral governance" is expected to mean when the project moves
  toward it. Expands the "Governance intent" paragraph above; does not
  contradict it. *(Draft — see the banner in that file.)*
- **[ROADMAP.md](ROADMAP.md)** — what "1.0" will mean and the explicit exit
  criteria for declaring it; near-term profile candidates.
- **[LICENSE](LICENSE)** — MIT, matching `package.json`'s `"license"` field.

---

## Canonical home

This repository (`hachure-org/spec`) is the canonical home of the Hachure
specification: prose, normative JSON Schemas, conformance test vectors, and the
bundled implementation. On any conflict between an implementation and this
repository, this repository wins.

## Implementations

Conformance is claimed by passing the conformance vectors
([manifest](conformance/manifest.json)), not by appearing in this list. Known
implementations:

| Implementation | Maintainer | Notes |
|---|---|---|
| `hachure` (this package, `lib/`) | hachure-org | Bundled with the spec; dependency-free; runs all vectors in-repo. |
| [`@kontourai/surface`](https://github.com/kontourai/surface) | Kontour AI | Independent implementation; runs these vectors in its own suite. |

To add an implementation, open a PR that links to your public conformance-vector
run.
