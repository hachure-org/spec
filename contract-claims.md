# Contract-Claims Profile: End-to-End Component Contracts

**Normative source:** this document.
**Depends on:** core record shapes, [status-function.md](status-function.md),
and the `runtime_observation` evidence type in schemaVersion 7.
**Conformance language:** MUST/MUST NOT/SHOULD/MAY keywords in this document
are to be interpreted per RFC 2119/BCP 14, as defined in
[README.md's Conformance language section](README.md#conformance-language).

---

## Principle

A component can be correct in isolation while the system is broken at its
boundary: a deploy configuration can declare a secret that never reaches the
process, an external service can return a payload the parser does not accept,
or application code can expect a migration that was not applied. Unit and
component tests establish facts about each side independently; they do not
establish that the contract between the sides was exercised in a running
system.

This profile gives that integration claim a conventional shape using existing
Hachure records. It introduces no relational subject, schema field, schema
version, or status-function change. The relation is carried as a `contract`
Claim with string-valued `qualifiers`, and a policy requires a live exercise
receipt before the claim can derive `verified`.

## Claim convention

A contract claim MUST use `claimType: "contract"`. Its `qualifiers` MUST contain
all three of these keys:

| Qualifier | Meaning |
|---|---|
| `provider` | The component or boundary that supplies the value, shape, state, or behavior. |
| `consumer` | The component that relies on what the provider supplies. |
| `contract` | A concise, testable statement of what must cross or hold at the boundary. |

The Claim's ordinary `subjectType` and `subjectId` identify the deployment,
workflow, integration, or other system scope in which the relation is asserted.
They do not pretend that either endpoint alone is the relational subject.
`fieldOrBehavior` SHOULD name a stable contract category, while `value` carries
the asserted outcome.

Recommended shapes include:

| Case | `subjectType` / `subjectId` | `qualifiers` | `fieldOrBehavior` / `value` |
|---|---|---|---|
| Environment/config passthrough | `deployment` / `oauth-service:production` | `{ "provider": "compose.env", "consumer": "app.oauth", "contract": "GOOGLE_CLIENT_ID reaches process env" }` | `env-passthrough` / `true` |
| External payload shape | `integration` / `billing-provider:production` | `{ "provider": "billing-api.charge-response", "consumer": "app.billing-parser", "contract": "charge response matches parser expectation" }` | `payload-shape` / `true` |
| Schema/migration availability | `deployment` / `orders-service:staging` | `{ "provider": "database.migrations", "consumer": "app.orders-repository", "contract": "orders_v3 columns exist before repository startup" }` | `migration-availability` / `true` |

Qualifier values are producer-owned identifiers. Producers SHOULD keep them
stable across runs so consumers can compare and merge repeated observations of
the same scoped contract. Qualifiers participate in canonical claim identity
under [merge.md §4](merge.md#4-claim-identity-across-producers), so rewording a
`contract` qualifier forks cross-producer and merge identity rather than merely
changing display text.

## Policy template: require a live exercise

A policy for this profile MUST require `runtime_observation` evidence. It SHOULD
also require the `observation` method as an additional live-exercise signal.
Status-function Step 4b checks required evidence types and methods as independent
sets across all entailing evidence; it does not guarantee that one evidence item
pairs `runtime_observation` with `observation`.

```json
{
  "id": "policy.contract.live-exercise",
  "claimType": "contract",
  "requiredEvidence": ["runtime_observation"],
  "requiredMethods": ["observation"],
  "requiresCorroboration": false,
  "acceptanceCriteria": [
    "the provider-to-consumer path is exercised in a running target environment",
    "the observed result directly entails the stated contract"
  ],
  "reviewAuthority": "deployment-verifier",
  "validityRule": { "kind": "duration", "durationDays": 7 },
  "stalenessTriggers": [
    "provider configuration changes",
    "consumer version changes",
    "target environment is redeployed"
  ],
  "conflictRules": ["a blocking failed live exercise disputes the claim"],
  "impactLevel": "critical"
}
```

The seven-day window is a starting convention, not a universal lifetime.
Producers SHOULD choose a duration short enough that the receipt is renewed
after material provider, consumer, or deployment changes. A deployment-bound
producer MAY use a commit validity rule instead when the evidence and current
integrity reference reliably bind both endpoints and their deployment config.

Under the status function, a verification event backed only by `test_output`
has a policy evidence gap and derives `proposed`; adding entailing
`runtime_observation` evidence with method `observation` allows the same claim
to derive `verified` (subject to freshness, conflicts, and the other fold
rules). The normative example of this transition is the
[`sf-runtime-observation-required`](conformance/sf-runtime-observation-required.json)
conformance vector; this profile does not duplicate that status rule.

## Recommended evidence convention

The live receipt SHOULD record the path that was exercised end to end, not
merely restate unit-test output. A `runtime_observation` for a contract claim
SHOULD:

- name or locate the target run in `sourceRef` and describe the provider,
  boundary, consumer, and observed outcome in `excerptOrSummary`;
- use `method: "observation"`, `supportStrength: "entails"`, and an explicit
  `passing` result when the exercise is pass/fail;
- carry an `execution` block with the required `runner` and `label`, plus the
  target `environment` and `exitCode` for command-backed receipts; and
- avoid recording secret values or sensitive payloads. Record presence,
  fingerprints, redacted shapes, or other non-secret outcomes sufficient to
  establish the contract.

An execution environment is descriptive, not automatically live: a producer
MUST NOT label a unit test `production` and treat that label alone as an
end-to-end exercise. The receipt's content and collection path must establish
that the provider-to-consumer boundary was actually traversed.

Command-backed `runtime_observation` evidence with an integer
`execution.exitCode` also meets the command-backed definition in
[waivers.md](waivers.md#consumer-derived-verdicts-informative). A consumer can
therefore distinguish an accepted non-runnable gap from bypassing an available,
repeatable contract check.

## Worked example

[`examples/contract-claim-env-passthrough.json`](examples/contract-claim-env-passthrough.json)
is a schemaVersion 7 bundle for the environment/config case. It includes a
green pre-deployment test and a production `runtime_observation` showing that
the consuming OAuth process received `GOOGLE_CLIENT_ID` without exposing the
identifier itself. The contract policy requires the live receipt, and the
verification event cites it, so the example derives `verified` within its
validity window.

## Graduation trigger

Contracts SHOULD graduate to a schema-level relational subject only when a
conforming derivation or merge rule must understand the endpoints as structured
relations—for example, to propagate a broken provider contract to dependent
consumers, query transitive contract impact, or apply endpoint-specific policy.
Until such an observable interoperability need exists, producers MUST represent
the relation with this profile's free-form qualifiers and MUST NOT invent
`hachure.org/*` extension namespaces for contract subjects, qualifiers, or
claims.

## Adoption and status

CI and deployment tools that emit contract-claim bundles after exercising real
provider-to-consumer paths are a concrete adoption wedge for ROADMAP.md's 1.0
external-producer criterion. They turn a successful deployment probe into a
portable receipt whose standing another implementation can re-derive.

Draft profile. It introduces no schema change, package-version change, or
`statusFunctionVersion` change.
