/**
 * Multi-producer merge — merge.md §5 (algorithm), §6 (order independence),
 * §8 (collision detection).
 *
 * A direct, dependency-free implementation of the normative merge semantics.
 * Order independence holds by construction: records are grouped by id across
 * the whole input set, every colliding pair is compared, the kept content is
 * chosen by RFC 8785 canonical ordering (never array position), and output
 * collections are sorted deterministically.
 */

import { canonicalize } from './canonicalize.mjs';

const ID_COLLECTIONS = ['claims', 'evidence', 'policies', 'events'];
const OPTIONAL_ID_COLLECTIONS = ['claimGroups', 'authorityTrace'];

/**
 * Merge bundles, reporting collisions instead of throwing.
 *
 * @param {object[]} bundles
 * @returns {{ bundle: object, collisions: Array<{collection: string, id: string, distinctContents: number, sources: string[]}> }}
 */
export function mergeBundlesDetailed(bundles) {
  if (!Array.isArray(bundles) || bundles.length === 0) {
    throw new Error('mergeBundlesDetailed requires a non-empty array of bundles');
  }

  // §5: implementations MUST reject a merge across differing schemaVersion values.
  const versions = new Set(bundles.map((b) => b.schemaVersion));
  if (versions.size > 1) {
    throw new Error(
      `cannot merge bundles with differing schemaVersion values: ${[...versions].join(', ')}`
    );
  }

  const collisions = [];
  const merged = { schemaVersion: bundles[0].schemaVersion };

  // §5 rule 1-2 + §6: union by id, kept content chosen by canonical ordering.
  for (const collection of [...ID_COLLECTIONS, ...OPTIONAL_ID_COLLECTIONS]) {
    const optionalId = OPTIONAL_ID_COLLECTIONS.includes(collection);
    const byId = new Map(); // id → Map<canonical, {record, sources:Set}>
    const withoutId = [];
    let present = false;

    for (const bundle of bundles) {
      const records = bundle[collection];
      if (records === undefined) continue;
      present = true;
      for (const record of records) {
        if (optionalId && record.id === undefined) {
          withoutId.push(record); // items without an id are always kept, never deduped
          continue;
        }
        const canonical = canonicalize(record);
        if (!byId.has(record.id)) byId.set(record.id, new Map());
        const variants = byId.get(record.id);
        if (!variants.has(canonical)) {
          variants.set(canonical, { record, sources: new Set() });
        }
        if (bundle.source !== undefined) variants.get(canonical).sources.add(bundle.source);
      }
    }

    if (!present && !ID_COLLECTIONS.includes(collection)) continue;

    const kept = [];
    for (const [id, variants] of byId) {
      if (variants.size > 1) {
        // §8: differing content under one id is a collision, surfaced per id
        // with enough information to identify the contributing bundles.
        collisions.push({
          collection,
          id,
          distinctContents: variants.size,
          sources: [...new Set([...variants.values()].flatMap((v) => [...v.sources]))].sort(),
        });
      }
      // §6 tie-break: keep the content whose RFC 8785 serialization sorts first.
      const first = [...variants.keys()].sort()[0];
      kept.push(variants.get(first).record);
    }

    // Deterministic output ordering (the §6 guarantee is modulo list ordering;
    // sorting makes the output byte-identical across permutations).
    kept.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const withoutIdSorted = withoutId
      .map((r) => [canonicalize(r), r])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([, r]) => r);

    merged[collection] = [...kept, ...withoutIdSorted];
  }

  // §5 rule 1: identityLinks are concatenated in full.
  const identityLinks = bundles.flatMap((b) => b.identityLinks || []);
  if (identityLinks.length > 0) merged.identityLinks = identityLinks;

  // §5 rule 3: source synthesis; producerId and proof MUST be omitted on a
  // merged bundle (a producer's signature does not survive merging) — neither
  // is copied onto the literal above.
  const sources = [...new Set(bundles.map((b) => b.source).filter((s) => s !== undefined))].sort();
  merged.source = sources.length === 1 ? sources[0] : `merged:${sources.join('+')}`;

  collisions.sort((a, b) =>
    a.collection === b.collection
      ? a.id < b.id ? -1 : a.id > b.id ? 1 : 0
      : a.collection < b.collection ? -1 : 1
  );

  return { bundle: merged, collisions };
}

/**
 * Merge bundles; throws on any claim collision (§5 rule 2 — silent claim
 * corruption is the one thing merge MUST NOT ever do).
 *
 * @param {object[]} bundles
 * @returns {object} the merged TrustBundle
 */
export function mergeBundles(bundles) {
  const { bundle, collisions } = mergeBundlesDetailed(bundles);
  const claimCollisions = collisions.filter((c) => c.collection === 'claims');
  if (claimCollisions.length > 0) {
    const ids = claimCollisions.map((c) => c.id).join(', ');
    throw new Error(
      `claim id collision(s) with differing content: ${ids} — use mergeBundlesDetailed to inspect`
    );
  }
  return bundle;
}
