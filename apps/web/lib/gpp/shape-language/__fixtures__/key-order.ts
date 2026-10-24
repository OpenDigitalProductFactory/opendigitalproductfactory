// Test-only key-order helpers for the GPP shape compiler's determinism tests
// (registry-roundtrip.test.ts, PR-3a-4; determinism.test.ts, PR-3b-5;
// BI-6DA17863). No property-testing package is a dependency (plan
// "Constraints"), so shuffles use a small seeded PRNG and are reproducible
// from their seed. Imported only by tests.

type JsonObject = Record<string, unknown>;

/** mulberry32: a small seeded PRNG, so a shuffle is reproducible from its seed. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A deep copy whose object keys are re-inserted in the order `orderKeys` returns. Arrays keep their order. */
export function withKeyOrder<T>(value: T, orderKeys: (keys: string[]) => string[]): T {
  if (Array.isArray(value)) return value.map((item) => withKeyOrder(item, orderKeys)) as T;
  if (value && typeof value === "object") {
    const copy: JsonObject = {};
    for (const key of orderKeys(Object.keys(value))) copy[key] = withKeyOrder((value as JsonObject)[key], orderKeys);
    return copy as T;
  }
  return value;
}

export function reversedKeys<T>(value: T): T {
  return withKeyOrder(value, (keys) => [...keys].reverse());
}

export function shuffledKeys<T>(value: T, seed: number): T {
  const random = seededRandom(seed);
  return withKeyOrder(value, (keys) => {
    const shuffled = [...keys];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
    }
    return shuffled;
  });
}

/** A per-definition seed from its id, so each shape gets a different but fixed shuffle. */
export function seedFor(id: string, salt: number): number {
  let hash = 2166136261 ^ salt;
  for (let index = 0; index < id.length; index += 1) hash = Math.imul(hash ^ id.charCodeAt(index), 16777619);
  return hash >>> 0;
}

export const SHUFFLE_SALTS = [1, 2, 3] as const;
