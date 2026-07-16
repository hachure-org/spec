# OSCAL Profile: Assessment Results as Derived Trust State

**Normative source:** this document.
**OSCAL reference:** [NIST OSCAL Assessment Results model](https://pages.nist.gov/OSCAL/learn/concepts/layer/assessment/assessment-results/) (assessment layer).
**Conformance language:** MUST/MUST NOT/SHOULD/MAY keywords in this document are to be interpreted per RFC 2119/BCP 14, as defined in [README.md's Conformance language section](README.md#conformance-language).

---

## Principle

OSCAL's Assessment Results (AR) model and Hachure describe the same shape of
knowledge: *observations* (what was seen, with evidence) supporting
*findings* (a determination about a control), with expiry. The structural
difference is a single word: OSCAL findings are **asserted** by an assessor
at assessment time; Hachure claims are **derived** — recomputable by anyone,
decaying to `stale` on their own as evidence ages.

This profile maps between the two so that:

- an OSCAL AR can be ingested as Hachure records (assessments become
  re-evaluable trust state), and
- a Hachure ledger can be projected into an AR document (derived,
  continuously fresh state renders as familiar, tool-compatible compliance
  evidence — the "OSCAL output, always current" shape continuous-monitoring
  regimes like FedRAMP 20x mandate).

## 2. Field mappings

### 2.1 OSCAL `observation` ↔ Hachure `Evidence`

| OSCAL observation field | Hachure Evidence field | Notes |
|---|---|---|
| `uuid` | `id` | Prefix per merge.md §3 (`<producerId>.obs.<uuid>`). |
| `title` + `description` | `excerptOrSummary` | Concatenated, title first. |
| `methods[]` | `method` | `EXAMINE`→`observation`, `INTERVIEW`→`attestation`, `TEST`→`validation`; other/unknown → `observation`. One Evidence per method when several apply. |
| `types[]` | — | Carried in `excerptOrSummary`; no Hachure analogue. **Unmapped (documented).** |
| `subjects[]` | claim linkage | Resolves which claim(s) the Evidence supports; see §2.2. |
| `relevant-evidence[].href` | `sourceRef` | First entry → `sourceRef`; remainder listed in `excerptOrSummary`. |
| `collected` | `observedAt` | Direct. |
| `expires` | supported claim's `expiresAt` | Freshness bridge — see §3. |
| `origins[]` | `collectedBy` | Actor/tool identity. |
| `props[]` / `links[]` / `remarks` | `excerptOrSummary` (selected) | **Unmapped structurally (documented)**; preserved textually where material. |

`supportStrength`: `"entails"` when the observation's subject and method
directly evidence the finding's objective; `"cited"` for contextual
observations. `evidenceType`: `human_attestation` for INTERVIEW-method,
`test_output` for TEST-method, `source_excerpt` otherwise.
OSCAL TEST-method observations from live assessments MAY map to
`runtime_observation` rather than `test_output`.

### 2.2 OSCAL `finding` ↔ Hachure `Claim`

| OSCAL finding field | Hachure Claim field | Notes |
|---|---|---|
| `uuid` | `id` | Prefixed as above. |
| `title` + `description` | — | Carried in the projection; claim identity lives in the fields below. |
| `target.type` + `target.target-id` | `subjectType` + `subjectId` | e.g. `objective-id` targeting `ac-2_obj.1` → `subjectType: "control-objective"`, `subjectId: "ac-2_obj.1"`. |
| `target.objective-status.state` (`satisfied` / `not-satisfied`) | `value` (`true` / `false`) with `fieldOrBehavior: "objective-satisfied"` | The *asserted* outcome becomes the claim's value. The claim's **status** is never imported — it derives (§4). |
| `related-observations[]` | Evidence `claimId` linkage | Each referenced observation's Evidence records point at this claim. |
| `related-risks[]` | transparency-gap semantics | See §2.3. |
| `implementation-statement-uuid` | `facet` | Producer-scoped grouping. |

`claimType`: `"control-assessment"`. Ingesters SHOULD emit one
`VerificationEvent` per finding (`status: "verified"` when the assessor
asserted `satisfied` with supporting observations; `actor` from the AR
metadata) so that derivation has an event trail, and a
`VerificationPolicy` for `control-assessment` declaring the evidence types
the assessment method used.

### 2.3 OSCAL `risk` → contradiction/transparency semantics

An open OSCAL `risk` associated with a finding maps to **blocking,
non-passing Evidence** (`passing: false`, `blocking: true`) on the
corresponding claim — so an open risk drives the claim toward `disputed`
through the ordinary fold (status-function.md Step 4c), and a closed risk
(status `closed`) is ingested with `passing: true` or omitted. Risks are
never imported as statuses directly.

### 2.4 Result-level fields

| OSCAL result field | Hachure | Notes |
|---|---|---|
| `start` / `end` | bundle context | `end` SHOULD seed ingested `observedAt` defaults. |
| `reviewed-controls` | `VerificationPolicy.acceptanceCriteria` | The control selection documents what the policy assessed. |
| `metadata` (parties, roles) | `AuthorityTrace` | Assessor party with an assessor role → an authority trace enabling dispute-resolution events on assessed claims. |
| `local-definitions`, `assessment-log`, `attestations` | — | **Unmapped (documented)**: producer-side workflow detail below the bundle boundary. |

## 3. The freshness bridge

OSCAL AR provides `expires` on observations and validity windows on
results. Mapping rule: the *earliest* applicable OSCAL expiry among a
claim's entailing evidence SHOULD be mirrored onto the claim's `expiresAt`
(claim-intrinsic window, [status-function.md](status-function.md) Step 4a).

The consequence is the point of this profile: an assessment ingested in
January whose observations expire in June derives `verified` until June and
`stale` after — *on the consumer's side, with no reassessment document*. No
new derivation behavior is introduced; the existing fold does the work.

## 4. What this profile is not

- **Not status import.** `satisfied`/`not-satisfied` is the assessor's
  asserted outcome and becomes the claim's *value*. Derived status comes
  only from the fold — an assessor's `satisfied` finding whose evidence has
  expired derives `stale`, which is precisely the divergence the format
  exists to surface.
- **Not the whole of OSCAL.** SSP, POA&M, component-definition, catalog,
  and profile models are out of scope; this profile covers Assessment
  Results only. A POA&M mapping (open items ↔ disputed/proposed claims) is
  a natural follow-up.

## 5. Projection (Hachure → OSCAL AR)

The reverse direction is a rendering, not a data model: a producer projects
claims of `claimType: "control-assessment"` into `findings` (derived status
`verified` → `objective-status.state: "satisfied"`; `stale`, `disputed`,
`rejected`, `revoked` → `"not-satisfied"` with the derived status and its
inputs in `description`; `proposed`/`assumed`/`unknown` → finding omitted
or annotated as not-yet-determined), their entailing Evidence into
`observations` (field mapping of §2.1 reversed, claim `expiresAt` →
observation `expires`), and open contradiction gaps into `risks`. The
projection MUST embed the `statusFunctionVersion` and evaluation `now` in
the result's `remarks` so the rendered document records what was knowable
when.

---

## Versioning

This profile introduces no schema change and no `statusFunctionVersion`
change; it constrains how existing fields are populated from and projected
into the OSCAL Assessment Results model.
