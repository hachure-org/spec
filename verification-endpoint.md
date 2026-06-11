# Verification Endpoint — Extension Profile

**Profile type:** OPTIONAL extension
**Status:** draft
**Namespace:** `hachure.org/v1`
**Depends on:** core record shapes, [status-function.md](status-function.md), [interop-in-toto.md](interop-in-toto.md)

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
GET https://<producer-host>/.well-known/hachure/verify?ref=<integrityRef>[&ref=...]
```

Multiple refs may be passed as repeated `ref` query parameters. For large sets,
a POST variant is also allowed:

```
POST https://<producer-host>/.well-known/hachure/verify
Content-Type: application/json

{ "refs": ["<integrityRef>", ...] }
```

`integrityRef` is the integrity anchor value carried on a claim or bundle
(`claim.integrityRef` or a bundle-level `integrityAnchor.value`).

Producers MAY require authentication before serving a response. The response
semantics defined in this profile are unchanged by the presence or absence of
authentication; the receiver simply may not be able to reach the endpoint
without valid credentials.

---

## Response shape

The response body is a TrustBundle (see `schemas/trust-bundle.schema.json`)
scoped to the records matching the requested refs, plus a `metadata` extension
block. The bundle carries:

- **`source`** — the producer identifier, matching `source` in the original bundle.
- **`claims`** — all claims whose `integrityRef` was among the requested refs.
  Each claim is returned in its current form as the producer knows it.
- **`evidence`** and **`events`** — the delta since issuance where the producer
  can supply it: new evidence items, new verification events, revocation events,
  dispute events. Producers that do not track a delta MAY return the full current
  set for the matched claims; receivers MUST NOT assume the absence of an item
  means it was never present in the original bundle.
- **`authorityTrace`** — current authority traces relevant to the matched claims,
  including any that have been revoked since the original bundle was issued.
- **`metadata`** — a free-form object on the bundle. This profile defines four
  reserved keys within `metadata`:

  | Key | Type | Required | Meaning |
  |---|---|---|---|
  | `respondedAt` | ISO 8601 string | yes | The timestamp at which the producer assembled this response. |
  | `statusFunctionVersion` | string | yes | The status function version active at the producer at response time. |
  | `requestedRefs` | string[] | yes | The full list of refs from the request, in order. |
  | `unknownRefs` | string[] | yes | Refs from the request that the producer does not recognise. Must be present even if empty. |

Unknown refs are reported in `unknownRefs` honestly. A producer MUST NOT silently
omit a ref it does not recognise; it MUST include it in `unknownRefs` so the
receiver can distinguish "no changes" from "not found."

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
