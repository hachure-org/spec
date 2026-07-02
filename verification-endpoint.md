# Verification Endpoint — Extension Profile

**Profile type:** OPTIONAL extension
**Status:** draft
**Namespace:** `hachure.org/v1`
**Depends on:** core record shapes, [status-function.md](status-function.md), [interop-in-toto.md](interop-in-toto.md)
**Conformance language:** MUST/SHOULD/MAY keywords in this document are to be interpreted per RFC 2119/BCP 14, as defined in [README.md's Conformance language section](README.md#conformance-language).

---

## Problem

A TrustBundle is a point-in-time snapshot. Once exported, it carries no channel
back to the producer. A receiver holding a bundle from last week has no way to
learn that an authority trace was revoked yesterday, that a blocking evidence item
was added the day after export, or that a claim has since been superseded. The
receiver can re-run the status function as many times as it likes, but can only
produce the same answer from the same stale inputs.

This profile defines a lightweight channel for receivers to ask a producer: *what
has changed since this bundle was issued?* The response delivers fresh inputs for
the receiver's own status recomputation. It is testimony with a timestamp — a
record of what the producer asserted at the moment of response. It is never a
verdict the receiver is expected to obey.

---

## Discovery

Producers supporting this profile expose a verification endpoint at a well-known
path on the same host that issued the bundle:

```
GET https://<producer-host>/.well-known/hachure/verify?ref=<ref>[&ref=...]
```

Multiple refs may be passed as repeated `ref` query parameters. For large sets,
a POST variant is also allowed:

```
POST https://<producer-host>/.well-known/hachure/verify
Content-Type: application/json

{ "refs": ["<ref>", ...] }
```

Producers MAY require authentication before serving a response. The response
semantics defined in this profile are unchanged by the presence or absence of
authentication; the receiver simply may not be able to reach the endpoint
without valid credentials.

### Ref resolution semantics

A `ref` value in the request MAY be any of the following:

- **(a) A claim `id`** — the stable identifier on a claim object (`claim.id`).
- **(b) A claim's current integrity ref** — the `currentIntegrityRef` string field
  on a claim (`claim.currentIntegrityRef`, per `schemas/claim.schema.json`).
  Note: the analogous full anchor object is `claim.currentIntegrityAnchor`; when
  resolving by integrity value, match against `currentIntegrityRef` or
  `currentIntegrityAnchor.value`.
- **(c) A bundle-level integrity anchor value** — the `.value` field of an
  `integrityAnchor` object carried on an `authorityTrace` or `evidence` record
  within a bundle (`schemas/trust-bundle.schema.json` `$defs/integrityAnchor`
  → `value`).

Producers MUST support lookup by (a) and (b). Producers MAY support lookup by (c).
Receivers SHOULD prefer (a) for stability; (b) and (c) are useful when only an
integrity value is available from a prior bundle snapshot.

**Multi-match:** a single ref value MAY match more than one claim (for example,
two claims that share the same `currentIntegrityRef`). When a ref matches multiple
claims, the response includes ALL matching claims. A ref is reported as unknown
(in `unknownRefs`) only when it matches nothing — zero claims, evidence records,
or authority traces.

---

## Response shape

The response body is a TrustBundle (see `schemas/trust-bundle.schema.json`)
scoped to the records matching the requested refs, plus a `metadata` extension
block. The bundle carries:

- **`source`** — the producer identifier, matching `source` in the original bundle.
- **`claims`** — all claims that matched the requested refs (by id, currentIntegrityRef,
  or anchor value as described above). When a ref matched multiple claims, all are
  included. Each claim is returned in its current form as the producer knows it.
- **`evidence`** and **`events`** — the delta since issuance where the producer
  can supply it: new evidence items, new verification events, revocation events,
  dispute events. Producers that do not track a delta MAY return the full current
  set for the matched claims; receivers MUST NOT assume the absence of an item
  means it was never present in the original bundle.
- **`authorityTrace`** — current authority traces relevant to the matched claims,
  including any that have been revoked since the original bundle was issued.
- **`metadata`** — a free-form object on the bundle. This profile defines five
  reserved keys within `metadata`:

  | Key | Type | Required | Meaning |
  |---|---|---|---|
  | `respondedAt` | ISO 8601 string | yes | The timestamp at which the producer assembled this response. |
  | `statusFunctionVersion` | string | yes | The status function version the producer's current evaluation pipeline uses — i.e. the value the implementation exports (e.g. `statusFunctionVersion` from the reference implementation), independent of any version values stored inside served bundles. |
  | `requestedRefs` | string[] | yes | The full list of refs from the request, in order. |
  | `unknownRefs` | string[] | yes | Refs from the request that matched nothing. Must be present even if empty. |
  | `evaluatedAt` | `"response"` \| `"generation"` | no | When omitted or `"response"`, the producer evaluated claims dynamically at response time. `"generation"` indicates the producer cannot evaluate dynamically (e.g. static file serving) and the `statusFunctionVersion` reflects the version recorded when the bundle was originally generated. |

Unknown refs are reported in `unknownRefs` honestly. A producer MUST NOT silently
omit a ref it does not recognise; it MUST include it in `unknownRefs` so the
receiver can distinguish "no changes" from "not found."

**`statusFunctionVersion` source:** producers report the version their current
evaluation pipeline uses — the value their implementation exports at response time.
This is independent of any `statusFunctionVersion` fields stored inside the claims
or events within served bundles. Producers that serve static bundles without
dynamic evaluation MUST report the version that was active at generation time and
MUST set `evaluatedAt: "generation"` in metadata.

**`integrityAnchor` shape:** integrity anchor objects in responses follow the
`integrityAnchor` definition in `schemas/claim.schema.json` (`$defs/integrityAnchor`)
and `schemas/trust-bundle.schema.json` (`$defs/integrityAnchor`). Required fields
are `id`, `kind`, `algorithm`, `value`, and `sourceRef`. On claims the anchor is
carried as `currentIntegrityAnchor`; on authority-trace and evidence records it
is carried as `integrityAnchor`.

---

## Assurance levels

A response may be signed or unsigned. The two carry different weight.

**Signed response.** A producer that wraps the response bundle in a DSSE envelope
(per [interop-in-toto.md](interop-in-toto.md)) or attaches a `proof` block provides
independently verifiable testimony. The receiver can verify the signature using the
producer's public key before trusting any of the returned data. A signed response is
as trustworthy as the key and the in-toto statement it protects.

**Unsigned response.** A response delivered without a signature is producer-asserted
only. Receivers SHOULD treat an unsigned response exactly as they would treat an
unsigned TrustBundle received over a trusted channel: the transport provides some
assurance, but the content itself is not independently verifiable. Do not give an
unsigned response higher trust than the connection that delivered it.

Key distribution and rotation are out of scope for this profile. The same backlog
item that defers cryptographic signing for testimony records (ADR 0004, §Backlog)
applies here: until key-management infrastructure exists, signing is OPTIONAL and
unsigned responses are valid.

---

## Receiver rules

1. **Re-run the status function.** Merge the response bundle's events and evidence
   with the records in the held bundle, then call the status function over the
   combined input at your own `now`. Do not treat any status value in the response
   as a pre-computed verdict.

2. **Fix `now` before evaluating.** The status function is `f(claim, evidence,
   events, policy, authorityTrace, now)`. The response supplies updated inputs; the
   receiver controls `now`. Two receivers evaluating the same response at different
   instants may derive different statuses — that is expected and correct.

3. **Cache by `respondedAt`; honour `max-age`.** A receiver MAY cache a response
   keyed on the set of requested refs and the `respondedAt` timestamp. Producers MAY
   include a standard HTTP `Cache-Control: max-age=<seconds>` header as a hint for
   how long the response is expected to remain fresh. The hint is advisory; the
   receiver decides its own staleness policy.

4. **Retain the response as a record.** A verification response is itself a record
   worth keeping. It is testimony: evidence of what the producer asserted at
   `respondedAt`. A receiver that retains responses can reconstruct the history of
   its knowledge — when it learned of a revocation, when a dispute event appeared —
   which is useful for audit and for re-evaluating past InquiryRecords.

5. **Treat signed and unsigned responses differently.** Apply the assurance-level
   rules above before deciding how to weight the response in a combined evaluation.

---

## Non-goals

- **Transport beyond HTTPS.** This profile specifies only the HTTP/HTTPS request
  and response shape. Other transport mechanisms (gRPC, message queues, file
  exchange) are not covered.
- **Push and webhooks.** This profile is pull-only. Producers notify receivers
  only when asked. Push notification channels are a separate concern.
- **Transparency-log inclusion.** Including verification responses in a public
  transparency log (Rekor or equivalent) is complementary and encouraged for
  high-assurance scenarios, but it is not required by this profile and is not
  specified here.
- **Key management.** Public-key distribution, rotation, and revocation are out
  of scope. See the ADR 0004 backlog note above.

---

## Changelog

**Amended after first independent implementation — hachure.org site function.**
Five ambiguities resolved: (1) corrected claim integrity field names to schema
truth (`currentIntegrityRef`, `currentIntegrityAnchor`) and noted authority-trace
and evidence fields (`integrityRef`, `integrityAnchor`); (2) defined ref resolution
semantics — producers MUST support id and currentIntegrityRef lookups, MAY support
anchor-value lookups; (3) clarified multi-match: a ref matching multiple claims
returns all of them, unknown only when nothing matches; (4) clarified
`statusFunctionVersion` source as the producer's current pipeline export, added
optional `evaluatedAt` metadata key (`"response"` | `"generation"`) for static
producers; (5) added normative cross-reference to `integrityAnchor` schema
definition in `schemas/claim.schema.json` and `schemas/trust-bundle.schema.json`.
