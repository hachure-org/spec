# Path to 1.0

> Pre-1.0, this format makes hard breaking changes without compatibility
> aliases (README §"Namespace and versioning"). That is a deliberate freedom,
> and it is only cheap while the adopter count is low. This document states
> what must be true before that freedom is given up — so "1.0" is a checklist,
> not a mood.

## What 1.0 means

Declaring 1.0 commits the format to:

- **No hard breaks.** Wire-format changes after 1.0 are additive at the same
  `schemaVersion`, or ship under a new `schemaVersion` accepted alongside the
  old one for a published deprecation window — never a rejection of
  previously-valid bundles without one.
- **Status-function stability.** `statusFunctionVersion` bumps still happen,
  but every version's vectors remain published permanently, so any
  `InquiryRecord` can be re-evaluated under the version it recorded.
- **Semantic versioning on the `hachure` package** aligned with the above.

## Exit criteria (all required)

1. **Two independent implementations pass every conformance vector** (L1–L3),
   at least one of them not maintained by Kontour AI or hachure-org. The
   bundled implementation counts as one; it does not count as two.
2. **External producers exist.** At least three producers outside the
   founding team emit TrustBundles in real workflows (CI, scanners,
   compliance tooling — anything that isn't a demo).
3. **The signing surface is settled.** The `proof` block, Assurance L1/L2
   flows, and the verification-endpoint replay mitigation flagged in
   [SECURITY.md](SECURITY.md) have either shipped or been explicitly
   descoped with rationale. No profile document may reference a field the
   schemas reject (the pre-0.10 `proof` contradiction is the cautionary
   example).
4. **Merge order-independence holds in every listed implementation.**
   merge.md §6 is a MUST; an implementation with a known order-dependence gap
   cannot appear in the README Implementations table at 1.0.
5. **Vector coverage is adversarial, not just illustrative.** Every fold step
   in status-function.md and every merge rule in merge.md §5–§8 has at least
   one vector that fails if the rule is implemented wrong (mutation-tested or
   hand-argued in the vector's `$comment`).
6. **Governance scaffolding is ratified.** GOVERNANCE.md and CONTRIBUTING.md
   lose their draft banners, and the public change-proposal path has been
   exercised by at least one accepted external proposal.

## Non-goals for 1.0

- Neutral governance (steering group, neutral repo home) is *not* an exit
  criterion — GOVERNANCE.md ties it to adoption, which 1.0 precedes. 1.0 is a
  wire-format promise, not an organizational one.
- A registry of producers, id reservation, or any coordination
  infrastructure (merge.md §8 rules this out by design).

## Near-term (0.x) candidates

Ordered — the SCITT profile is deliberately first. Landscape research
(2026-07) confirmed the niche: every adjacent standard delegates status
decisions to unstandardized "local policy," and SCITT explicitly dropped its
standardized registration-policy mechanism. Hachure's versioned status
function is a natural candidate to fill that vacated niche rather than
compete with the registry layer.

1. **SCITT profile** — registering bundles/envelopes as SCITT signed
   statements, carrying receipts as `transparency_log` proof anchors
   (README §"Relationship to IETF SCITT"), and — the strategic half —
   expressing the status function as a reusable registration/appraisal
   policy a transparency service or relying party can adopt. Open design
   question to resolve in the profile: can a bundle be losslessly
   round-tripped to/from a SCITT statement sequence about the same subject?
2. **Verification-endpoint replay mitigation** — the honest gap named in
   SECURITY.md; likely a nonce/freshness token in the endpoint profile.
3. **VC envelope profile** — mapping records into a W3C VC envelope for
   VC-native ecosystems (README §"Relationship to W3C Verifiable
   Credentials").
4. **Producer tooling** — grow the CI action
   ([hachure-org/hachure-action](https://github.com/hachure-org/hachure-action))
   and ingestion tooling for the formats in
   [evidence-ingestion.md](evidence-ingestion.md), lowering the cost of
   criterion 2.

Shipped from this list: evidence-ingestion profile (in-toto/EAT/SCITT/VC →
Evidence) and the AR4SI tier projection (status-function.md §"Interop
mapping") — both landed 0.10.x.
