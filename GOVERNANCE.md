# Governance

> **DRAFT — pending owner review.** This document is a first-pass expansion
> of README's existing "Governance intent" paragraph, drafted as part of the
> 0.8.0 standalone-credibility delivery. It has not yet been reviewed or
> ratified by the project owner. Treat it as a proposal for how governance
> currently works and is intended to evolve, not as a settled charter.

---

## Current state

Hachure is currently developed by [Kontour AI](https://kontourai.io), which
holds the name to protect it (README.md §"Governance intent"). In practice
today, this means:

- **`hachure-org/spec` is the canonical home** of the specification: prose,
  normative JSON Schemas, and conformance test vectors. All normative changes
  land here first.
- **`@kontourai/surface` is an independent implementation maintained by Kontour AI.** It runs this
  repo's conformance vectors in its own test suite and is expected to track
  this repo's schema and semantics changes.
- **This repo wins on conflict.** Where `hachure-org/spec`'s prose/schemas
  and `kontourai/surface`'s implementation disagree, this repo's normative
  text is authoritative (README.md §"Canonical home"). A disagreement is a
  bug in the implementation (or a gap in this repo's documentation), not an
  invitation to pick whichever is more convenient.
- **Decision authority currently rests with Kontour AI.** There is no
  independent steering committee, working group, or public RFC process yet.
  Proposals are reviewed and merged at Kontour AI's discretion.

This is an honest description of a single-vendor-stewarded project, not a
claim of neutral governance. The format's design goal — wire artifacts usable
by any producer without adopting Kontour's product names into their format
(see README.md §"What this is") — is independent of who currently maintains
the specification text. Vendor-neutral *wire format* and neutral *governance*
are two different axes; this delivery (0.8.0) addresses the first. This
document exists to be honest about the second, not to pretend it is already
solved.

## What "neutral governance" would concretely mean, when triggered

README's existing text says: "We intend to move the specification to neutral
governance as adoption warrants." This section makes that concrete enough to
hold the project accountable to later, without committing to a specific
timeline (the trigger is adoption, which cannot be scheduled in advance).

When triggered, "neutral governance" is expected to mean, at minimum:

1. **A published, public process for proposing normative changes** — not
   necessarily a formal RFC process, but at minimum a documented path (issue
   template, discussion venue) that does not require being a Kontour AI
   employee to initiate.
2. **Decision authority distributed beyond a single company.** This could
   take the form of a steering group with seats held by independent
   adopters/implementers, not just Kontour AI staff — the exact shape is not
   prescribed here and should be decided when there is a real second
   independent implementation or adopter to include.
3. **A neutral home for the repository**, if adoption and independent
   maintainer involvement justify moving `hachure-org` out from under
   Kontour AI's direct control (e.g. a dedicated GitHub organization with a
   documented, non-Kontour-controlled ownership/access model). Not committed
   to a specific legal or organizational vehicle (foundation, working group,
   etc.) in this document — that decision is deferred to when it is actually
   relevant.
4. **A track record before the promise is made good on.** Concretely: this
   delivery (0.8.0) is the *first* time this project has shipped
   `CONTRIBUTING.md`, `GOVERNANCE.md`, or a `LICENSE` file at all. A single
   delivery adding these documents is not itself "neutral governance" — it is
   the prerequisite scaffolding a future transition would build on.

## Who can propose changes today

Anyone. Open an issue or a pull request against
[hachure-org/spec](https://github.com/hachure-org/spec). See
[CONTRIBUTING.md](CONTRIBUTING.md) for the process. Whether a proposal is
accepted is, today, a Kontour AI maintainer decision — this document does not
change that; it documents it.

## Versioning authority

Version bumps (`package.json` `version`, `schemaVersion`, `statusFunctionVersion`)
are declared in this repo and are the authoritative source; implementations
(including `@kontourai/surface`) are expected to track them, not the
reverse. See README.md §"Namespace and versioning" for the pre-1.0
hard-breaking-changes policy this implies.

## Relationship to the `surface` product name

The format is deliberately not named after any Kontour product (README.md
§"What this is"). Governance of the *specification* (this document) is
distinct from ownership of any *implementation package name*
(`@kontourai/surface` carries a Kontour-scoped npm namespace by design —
implementations are allowed to be vendor-branded even when the format they
implement is not).
