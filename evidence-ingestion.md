# Evidence Ingestion: External Attestations as Hachure Evidence

**Normative source:** this document.
**Direction:** the inverse of [interop-in-toto.md](interop-in-toto.md) — that
profile *exports* a TrustBundle as an attestation; this profile *imports*
existing attestations as Evidence on Hachure claims.
**Conformance language:** MUST/SHOULD/MAY keywords in this document are to be interpreted per RFC 2119/BCP 14, as defined in [README.md's Conformance language section](README.md#conformance-language).

---

## Principle

The attestation ecosystem already produces signed, frozen, point-in-time
statements at scale: in-toto/SLSA attestations in DSSE envelopes, EAT tokens
(RFC 9711), SCITT receipts, Verifiable Credentials. Hachure does not compete
with these records — it consumes them. Each is a high-grade item of
**Evidence** for a claim: something that was attested, by an identifiable
party, at a moment in time, with cryptographic protection that Hachure's
Assurance layer can grade.

Ingestion never re-signs, mutates, or re-interprets the source attestation.
The attestation stays what it is; Hachure adds the layer the source formats
deliberately leave out — what the attested fact is worth *now*, under a
published policy, next to every other producer's testimony.

## General mapping rules

An ingested attestation becomes one `Evidence` record (occasionally several,
when one attestation supports several distinct claims):

| Evidence field | Source |
|---|---|
| `evidenceType` | `attestation` |
| `method` | `attestation` |
| `sourceRef` | A resolvable locator for the original envelope/token (URL, OCI ref, transparency-log entry, file digest). Consumers MUST be able to fetch or identify the original. |
| `excerptOrSummary` | A human-readable digest of the attested content (predicate type + the fields that support the claim). |
| `observedAt` | The attestation's own timestamp where it carries one (see per-format rules); otherwise the ingestion time, and the ingester SHOULD note the substitution in `excerptOrSummary`. |
| `collectedBy` | The ingesting system. |
| `integrityRef` / `integrityAnchor` | The envelope's own digest or log entry — `kind: "signature"` for the DSSE/COSE signature, `kind: "transparency_log"` for a Rekor/SCITT entry. |
| `supportStrength` | `"entails"` when the attested content directly supports the claim's `fieldOrBehavior`/`value`; `"cited"` when contextual. |
| `passing` | Per-format, below. Omit when the attestation asserts no pass/fail semantics. |

Signature verification is an Assurance-layer concern: an ingester MAY verify
the envelope signature at ingestion time and SHOULD record the outcome on the
anchor's `verificationStatus`. Ingesting an attestation without verifying it
is valid (the evidence is then producer-asserted, L0, like everything else at
L0) — but an ingester MUST NOT mark `verificationStatus: "verified"` without
actually verifying.

## Per-format rules

### in-toto Statement v1 (DSSE envelope)

- One Statement → one Evidence record per supported claim. The claim's subject
  SHOULD correspond to one of the Statement's `subject` entries (name +
  digest); the digest belongs in `integrityRef` (`sha256:<hex>`).
- `sourceRef`: the envelope's storage locator; `integrityAnchor.kind:
  "signature"` with the DSSE signature's `keyid` in `sourceRef` of the anchor.
- `observedAt`: in-toto Statements carry no mandatory timestamp; use the
  envelope's transparency-log integration time when logged (Rekor
  `integratedTime`), else ingestion time.
- `passing`: derive only from predicates with explicit outcome semantics
  (e.g. a test-result predicate); SLSA provenance predicates describe *how*
  an artifact was built, not pass/fail — omit `passing` for those.
- SLSA provenance (`https://slsa.dev/provenance/v1`) supports claims of type
  `software-evidence` about build integrity (`fieldOrBehavior` like
  `"built-by-hosted-runner"`, `value` from `runDetails.builder.id`).

### EAT — Entity Attestation Token (RFC 9711, CWT/JWT)

- One token → Evidence on claims about the attested entity
  (`subjectType`: e.g. `"device"`, `"tee-instance"`; `subjectId` from `ueid`
  or `sub`).
- `observedAt`: from `iat`. A token `exp`, when present, SHOULD be mirrored
  onto the supported claim's `expiresAt` (claim-intrinsic freshness,
  [status-function.md](status-function.md) Step 4a) so expiry of the source
  token drives `stale` in derivation — this is the "living status" bridge.
- `integrityAnchor.kind: "signature"`, `algorithm` from the COSE/JOSE header.
- Individual EAT claims (e.g. `hwmodel`, `swname`, measurement results) map
  to Hachure claim `fieldOrBehavior`/`value` pairs; the token is the shared
  Evidence for all of them.

### SCITT Transparent Statement (receipt-bearing)

- The receipt is the anchor: `integrityAnchor.kind: "transparency_log"`,
  `value` the log entry identifier, `sourceRef` the transparency service.
- The inner signed statement follows its own payload's rules (commonly an
  in-toto Statement — apply the rules above to the payload).
- A receipt proves registration, not truth: `passing` MUST NOT be set from
  the mere fact of registration.

### W3C Verifiable Credential 2.0

- One credential → Evidence on claims mirroring `credentialSubject` fields;
  `subjectId` from `credentialSubject.id` where present.
- `observedAt` from `validFrom`; mirror `validUntil` onto the supported
  claim's `expiresAt` as with EAT `exp`.
- The securing mechanism (Data Integrity proof or JOSE/COSE) grades under
  Assurance exactly as a DSSE signature does.

## What ingestion is not

- **Not corroboration inflation.** N ingested attestations from one issuer
  about one fact are one producer's testimony, not N-way corroboration. Use
  the issuer identity, not the record count, when a policy sets
  `requiresCorroboration`.
- **Not status import.** If the source system expresses its own status
  vocabulary (a VC status list, a tier, a verdict field), the ingester maps it
  to *evidence content* — never directly onto a Hachure claim's derived
  status, which only the status function produces. Where the source revokes
  (a VC status-list revocation, a certificate revocation), the ingester
  SHOULD append a `type: "invalidation"` VerificationEvent so revocation
  flows through Step 2 of the fold.

---

## Versioning

This profile introduces no schema change and no `statusFunctionVersion`
change; it constrains how existing Evidence fields are populated from
external formats.
