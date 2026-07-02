# Assurance — Extension Profile

**Profile type:** OPTIONAL extension
**Status:** draft
**Namespace:** `hachure.org/v1`
**Depends on:** core record shapes, [interop-in-toto.md](interop-in-toto.md), [verification-endpoint.md](verification-endpoint.md)
**Conformance language:** MUST/SHOULD/MAY keywords in this document are to be interpreted per RFC 2119/BCP 14, as defined in [README.md's Conformance language section](README.md#conformance-language).

---

## Principle: signing is a dial, not a gate

Unsigned records are valid core records.  Forever.  This profile defines how
consumers express and verify *higher* assurance, and how policies weigh the
levels against one another.  It is never a prerequisite for producing or
consuming a TrustBundle.

The assurance model exists because some environments want non-repudiation, audit
trails that survive producer outages, or cryptographic evidence that a specific
human exercised a specific authority.  Signing is the mechanism that provides
those properties — but it is layered on top of an already-valid record, not a
precondition for record validity.  A bundle with no signatures is not a
degraded bundle; it is an L0 bundle.

---

## Assurance levels

Three levels are defined.  Higher levels are a strict superset of lower levels:
an L2 record satisfies any policy that accepts L1 or L0.

### L0 — producer-asserted (default)

The record is unsigned.  Assurance derives entirely from the trustworthiness of
the transport channel and the producer identity declared in the bundle's
`source` field.  All TrustBundles that do not carry a DSSE envelope are L0.
This is the default; no annotation or flag is required.

### L1 — identity-signed (keyless / ephemeral)

The record is wrapped in a DSSE envelope (per
[interop-in-toto.md](interop-in-toto.md)).  The signing key is short-lived and
bound to an identity asserted by an OIDC provider at signing time — a CI
workflow identity (`sub: repo:org/repo:ref:refs/heads/main`) or a human account
(`sub: user@example.com`).  The certificate binds the ephemeral public key to
that OIDC identity for the lifetime of the signing event.

An L1 signature MAY be submitted to a public transparency log (Rekor or
equivalent).  When it is, the resulting log entry UUID SHOULD be stored in the
bundle's `proof` block as an `IntegrityAnchor` of kind `transparency_log`.
Transparency-log inclusion is encouraged but not required for L1 conformance.

The OIDC issuer and subject carried in the signing certificate are the
authoritative identity for the signing event.  Implementations that verify L1
signatures MUST surface a human-readable identity derived from those fields (see
[Identity presentation](#identity-presentation) below).

### L2 — held-key (org-controlled KMS/HSM)

The record is wrapped in a DSSE envelope and signed with a long-lived key held
in an org-controlled key-management system (a KMS or HSM).  The key is not
ephemeral and is not tied to a per-operation OIDC token.  Key rotation and
revocation are producer policy; this profile imposes no rotation schedule or
revocation mechanism.

L2 is appropriate for environments that cannot use public OIDC issuers or
public transparency logs — air-gapped deployments, highly regulated environments
with internal PKI requirements, or organisations that maintain their own CA.

Because L2 keys are long-lived, verifiers must obtain the producer's public key
through an out-of-band channel (internal PKI, a published key-distribution
endpoint, a previously-trusted bundle).  This profile does not specify that
channel.

---

## What gets signed

Producers that adopt this profile MAY sign the following record types.  Signing
any of them does not change the record's schema; the DSSE envelope wraps the
serialised record and is carried alongside it, not embedded in it.

### TrustBundles

A full TrustBundle, including release bundles, is the primary signing target.
Signing a bundle asserts that the named producer attests to the entire contents
at the moment the envelope was created.  The in-toto Statement `subject` array
SHOULD identify the bundle's `integrityAnchor.value` so downstream verifiers can
correlate the envelope with a specific bundle revision.

### Attestations

A human's `ReviewOutcome` record carrying an `authorizing` block (ADR 0004) is
an identity-signed attestation.  When the human's OIDC identity signs that
record at the moment the authority is exercised (see
[Human signing ceremony](#human-signing-ceremony)), the result is non-repudiable
evidence that a specific identity made a specific decision.  This signed
attestation is the appropriate content for the `identityEvidence` field on a
Claim: it collapses "someone in this org approved this" into "this OIDC-verified
identity approved this, cryptographically."

### Verification-endpoint responses

A producer serving a verification-endpoint response (see
[verification-endpoint.md](verification-endpoint.md)) MAY wrap the response
bundle in a DSSE envelope before returning it.  A signed response upgrades the
assurance level of that endpoint from L0 to L1 or L2 according to the key type
used.  Receivers SHOULD apply the same identity-presentation rules to a signed
response as to any other signed record.

---

## Identity presentation

Verifiers MUST surface a human-readable identity for every signed record they
display or log.  Raw key fingerprints are not an acceptable primary display.

Derive the display identity from the DSSE envelope's signing certificate:

- For L1 (OIDC-backed): present the OIDC issuer and subject in a
  human-readable form.  Examples:
  - CI workflow: `"signed by github.com/org/repo workflow .github/workflows/release.yml"`
  - Human account: `"signed by alice@example.com (GitHub)"`
- For L2 (held key): present the key's subject DN or the KMS key alias as
  configured by the producer.  Example: `"signed by CN=kontour-release-key, O=Kontour AI"`

Displaying a fingerprint alongside the human-readable identity is permitted and
encouraged for debugging.  It is not a substitute for the identity string as the
primary display element.

---

## Consumer policy

Assurance requirements are policy, not wire format.  A consumer expresses its
requirements through a `VerificationPolicy` that declares a minimum assurance
level among its `acceptanceCriteria`.  Mismatches between a record's actual
level and the consumer's required level are **transparency gaps** — structured
annotations that feed the status function's inputs and surface as `proposed` or
`assumed` status rather than silent hard failures.

This mirrors the admissibility doctrine in ADR 0004 §4: heuristics emit issues
for human review; they do not silently decide.  A bundle whose assurance level
falls below a consumer's requirement is recorded and flagged; a human or an
automated policy layer decides whether to accept, escalate, or re-request.

Concretely:

- An L0 bundle that satisfies all policy evidence requirements reaches
  `verified` normally.  If the consumer policy also requires L1, the consumer
  annotates the gap; the status function sees the annotation as a transparency
  gap and surfaces the claim at `proposed` pending a signed replacement.
- An L1 or L2 bundle that satisfies all policy evidence requirements and meets
  the assurance requirement reaches `verified` without annotation.
- A signed record with an unverifiable or expired certificate does not silently
  downgrade to L0.  The verification failure is itself a transparency gap,
  flagged for the attention queue.

---

## Human signing ceremony

When a human exercises authority — authoring a policy-change attestation,
signing off a release bundle, or countersigning a ReviewOutcome — the signing
gesture MUST be interactive and co-located in time with the authorizing act.

The ceremony is an interactive OIDC browser flow: the same gesture as
sign-in-with-Google or a Stripe payment confirmation.  The human authenticates
to the OIDC provider, the provider issues a short-lived certificate bound to
the authenticated identity, and that certificate signs the record.  The entire
flow completes in the same session as the authorizing act; signing a record
retroactively from a different session is not a conforming ceremony.

**Recommended mechanism for highest-assurance human ceremonies:** WebAuthn /
passkey with user-verification (UV=1).  A device-local authenticator satisfies
three independent assurance legs simultaneously:

- **Presence** — the passkey gesture (biometric or PIN) proves the enrolled
  device is physically present; biometric data never leaves the device.
- **Identity** — the hardware-backed assertion composes with the OIDC
  certificate: the certificate binds the ephemeral key to the OIDC subject;
  the passkey attests the device-local identity enrolled at registration time.
- **Engagement** (non-normative) — oversight metrics such as session duration
  or interaction events can accompany the record as non-normative evidence;
  they are not part of the conformance criteria.

Because the three legs are independent, losing one (e.g., no biometric sensor
on the device) does not forfeit the others.  An OIDC-only ceremony without a
passkey assertion is still a conforming L1 ceremony; the passkey upgrade is
RECOMMENDED where the platform supports it.

Design intent: friction lands only where authority is exercised.  Routine
read-only operations, status queries, and bundle consumption carry no signing
requirement.  The ceremony surfaces once, at the moment of consequence.

## Collection channels and media evidence

Any collection channel defined in the reference implementation (see ADR 0004 in
the reference implementation) MAY attach media evidence — for example,
capture-provenance imagery conforming to C2PA — as ordinary evidence entries
with integrity anchors.  Three rules govern such attachments:

1. **Channels do not replace admissible testimony kinds.**  A photo or video of
   a signing gesture is attached evidence, not a substitute for an `exchange` or
   `authorized-action` block.  The admissible testimony kinds in ADR 0004 remain
   the authoritative record; media is corroborating context.
2. **Capture provenance determines evidence grade.**  Media accompanied by a
   valid C2PA manifest (or equivalent capture-provenance credential) is treated
   as integrity-anchored evidence at the level its anchor supports.  Media
   without capture provenance is ordinary L0 evidence: present, but carrying no
   additional assurance weight beyond the transport channel.
3. **Integrity anchors are required for non-L0 media claims.**  If a consumer
   policy requires L1 or higher evidence grade for media, the media item MUST
   carry an `IntegrityAnchor` referencing the capture-provenance credential.

---

## Non-goals

- **Mandating a CA or transparency log.** This profile does not require a
  specific certificate authority, a specific OIDC issuer, or submission to any
  particular log.  L1 signing with a private OIDC issuer and no public log is
  valid L1.
- **Key custody prescriptions.** How a producer acquires, stores, rotates, or
  revokes L2 keys is producer policy.  This profile does not specify HSM vendor,
  key-rotation schedule, or revocation-distribution mechanism.
- **Core-format changes.** No core record schema is altered by this profile.
  Adopting the assurance profile requires no schema migration and no changes to
  the status derivation function.
- **Signing every record.** Signing is always optional.  Producers that sign
  nothing are fully conformant with the core specification.
