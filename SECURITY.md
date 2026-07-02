# Security Considerations

This document describes the trust boundaries of the Hachure core format and
its optional profiles, and points at the mechanism each risk is mitigated by.
It is a description of the format's own honest limits, not a claim that these
risks are solved by default — most of them are solved only when a consumer
opts into a higher [Assurance](assurance.md) level.

Reporting a vulnerability in the schemas, conformance vectors, or prose in
this repository: open an issue at
[hachure-org/spec](https://github.com/hachure-org/spec/issues). This repo
ships specification artifacts (JSON Schemas, test vectors, markdown), not
runtime code; there is no server or service to report an exploit against
here. Vulnerabilities in the reference implementation (`@kontourai/surface`)
should be reported in that repository.

---

## Threat model summary

The core format (schemas, `merge.md`, `status-function.md`) makes **no
cryptographic guarantee by default.** Every TrustBundle is valid — and fully
conformant — with zero signatures. This is a deliberate design choice
(`assurance.md` §"Principle: signing is a dial, not a gate"), not an
oversight, but it means a receiver's default trust posture for an unsigned
bundle is "as trustworthy as the channel it arrived over," never higher.

The three risk classes below are the direct, honest consequences of that
default. All three share the same mitigation dial: [assurance.md](assurance.md)'s
L0/L1/L2 levels. **Signing is opt-in, not a precondition for validity** — a
consumer that needs a mitigation below must pull the dial itself, by
requiring L1/L2 in its `VerificationPolicy`; the format does not do it for
them.

### 1. Source / producerId spoofing (L0)

`TrustBundle.source` (`schemas/trust-bundle.schema.json`) is free text, and
the optional `TrustBundle.producerId` (`merge.md` §2) is an unsigned string.
Both are **self-asserted**: nothing in the core format cryptographically
binds either field to the system that actually produced the bundle. A
receiver of an unsigned bundle has no guarantee that the `source`/`producerId`
values are accurate — only that they are what the sender chose to write down.
Below Assurance L1, this is trust-on-first-use: the receiver's confidence in
producer identity comes entirely from the trustworthiness of the transport
channel (e.g. an authenticated HTTPS connection to a known host), not from
anything inside the bundle itself.

`producerId` was introduced (`merge.md` §2) specifically to give merge a
stable, comparable identity across runs — it is explicitly documented there
as carrying "no cryptographic weight," an L0 fact in Assurance-profile terms.
Reusing it as an authorization or access-control signal without an L1/L2
signature over it is a misuse of the field, not a supported use case.

**Mitigation:** [assurance.md](assurance.md) L1 (OIDC-backed identity-signed)
or L2 (org-held-key-signed) records bind a verifiable identity to the record
via a DSSE envelope. A consumer that needs verified producer identity should
require L1 or L2 in its `VerificationPolicy`'s acceptance criteria and treat
a below-threshold bundle as a transparency gap (`assurance.md` §"Consumer
policy"), not silently accept the self-asserted `source`/`producerId` values
as authoritative.

### 2. Replay in the verification-endpoint profile

[verification-endpoint.md](verification-endpoint.md) defines a pull-based
delta-fetch channel (`GET/POST .well-known/hachure/verify`) for a receiver to
ask a producer "what has changed since this bundle was issued?" As of this
writing, that profile defines no nonce, freshness token, or monotonic cursor
in either the request or the response. A response is authenticated only by
whatever transport-level authentication the producer chooses to require
(profile text: "Producers MAY require authentication before serving a
response") and, optionally, by a DSSE signature over the response bundle
(`verification-endpoint.md` §"Assurance levels").

This means: an unsigned verification-endpoint response carries no
cryptographic freshness guarantee. A response captured and replayed later by
a party sitting on the transport path (or by a compromised intermediate
cache) is not distinguishable, at the profile level, from a fresh response —
the profile's own `respondedAt` metadata field is producer-asserted, not
verified. This is named here as an explicit, currently-unmitigated gap in the
profile, not as a solved problem being restated: no existing
freshness-handling language exists in `verification-endpoint.md` today, and
this document does not silently invent one.

**Mitigation:** treat every verification-endpoint response — signed or not —
as advisory testimony, per the profile's own framing ("It is testimony with a
timestamp... It is never a verdict the receiver is expected to obey,"
`verification-endpoint.md` §"Problem"). Receivers that need replay resistance
should (a) require a signed response (Assurance L1/L2) *and* (b) layer their
own freshness handling on top — for example, rejecting a response whose
`respondedAt` is older than a receiver-chosen staleness bound, or pinning
expected `respondedAt` monotonicity per producer host — since the core
profile does not provide either mechanism itself.

### 3. Whole-bundle substitution

A TrustBundle transmitted without a DSSE envelope (Assurance L0, the default)
has no integrity protection against wholesale substitution in transit or at
rest. An attacker or compromised intermediary who can replace the bytes of an
unsigned bundle — swap it for a different bundle, an older bundle, or a
bundle from a different producer — is undetectable by the receiver using
only the core format's own mechanisms. Nothing in `schemas/*.schema.json` or
`status-function.md` provides tamper-evidence; those layers assume the bytes
they operate on are already the intended bytes.

**Mitigation:** Assurance L1/L2 DSSE signing
([interop-in-toto.md](interop-in-toto.md)) wraps the serialized bundle in a
signed envelope; a receiver that verifies the signature before parsing the
bundle detects substitution (the signature will not verify over substituted
bytes). This is the same mechanism item 1's mitigation depends on — signing
the bundle simultaneously binds its producer identity and its content
integrity. A receiver that only checks `source`/`producerId` (item 1) without
also verifying the envelope (item 3) has closed neither gap: an attacker who
can substitute the bundle can substitute the self-asserted `source` field
along with it.

---

## Integrity anchors and canonicalization

Bundle and claim records carry optional `integrityAnchor` objects
(`schemas/claim.schema.json` `$defs/integrityAnchor`,
`schemas/trust-bundle.schema.json` `$defs/integrityAnchor`) with a `kind`
enum that includes `"hash"`. When an implementation computes a `"hash"`-kind
integrity anchor over a bundle or record — or independently verifies one — it
**MUST** canonicalize the JSON with [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785)
(the JSON Canonicalization Scheme, JCS) before hashing. This is the same
canonicalization primitive `merge.md` §6 now ratifies as normative for its
deterministic tie-break rule (see `merge.md` §6/§9) — one canonicalization
decision for the whole format, not two independently-evolving ones.
Canonicalization MUST be RFC 8785 (JCS) — full stop, with no
sorted-key-`JSON.stringify` shortcut carve-out. Two implementations that both
claim RFC 8785 compliance and hash the same logical content MUST produce the
same digest.

> **Note (informative, not normative):** producing byte-identical RFC 8785
> output across languages has real cross-language pitfalls implementers
> should verify against, not assume away. (a) Non-ASCII string escaping —
> RFC 8785 (via RFC 8259) requires strings to contain literal UTF-8
> characters, never `\uXXXX` escapes, but several languages' default JSON
> serializers `\u`-escape non-ASCII by default (e.g. Python's `json.dumps`'s
> `ensure_ascii=True` default) and must be reconfigured to emit literal
> UTF-8. (b) Number serialization MUST follow the ECMAScript
> `Number::toString` algorithm (RFC 8785 §3.2.2.3) — native to JavaScript
> engines, but other languages need a compliant implementation of that exact
> algorithm, not their own default float-to-string routine. (c) Property
> sort order is by UTF-16 code unit value (RFC 8785 §3.2.3), not codepoint,
> byte, or locale-collation order. RFC 8785 §3.1 also does not apply Unicode
> normalization — strings are canonicalized exactly as they already are in
> memory, so two visually-identical strings that differ only in Unicode
> normalization form produce different canonical bytes. A hand-rolled
> sorted-key `JSON.stringify` can silently diverge from RFC 8785 on any of
> these points; there is no shortcut that is safe to assume equivalent
> without verifying against a conformant JCS implementation.

An integrity anchor is only as trustworthy as the channel it arrived over
unless it is itself covered by an Assurance L1/L2 signature (item 3 above) —
a `"hash"` anchor on an otherwise-unsigned L0 bundle is a self-asserted
checksum, useful for detecting accidental corruption, not for detecting a
deliberate adversary who can also recompute the hash over substituted
content.

---

## Summary: the mitigation is one dial, not three

All three risk classes above, and the integrity-anchor guidance, resolve to
the same answer: **[assurance.md](assurance.md)'s L0/L1/L2 levels are the
dial a consumer pulls when any of this matters.** L0 (the default, unsigned)
carries none of these guarantees and is not pretending to. L1/L2 (DSSE
signing, per [interop-in-toto.md](interop-in-toto.md)) closes the producer-identity
and bundle-substitution gaps together, because they are the same mechanism.
The verification-endpoint replay gap additionally needs receiver-side
freshness handling that the format does not currently specify — named here
explicitly rather than left implicit.

A consumer that needs any of these properties expresses that need as a
`VerificationPolicy` acceptance criterion requiring a minimum assurance
level; a bundle that falls short is a transparency gap for a human or policy
layer to act on (`assurance.md` §"Consumer policy"), never a silent
downgrade.
