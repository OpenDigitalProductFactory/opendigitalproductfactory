// apps/web/lib/security/safe-property.ts
//
// Guards against prototype-pollution vulnerabilities (CWE-1321 +
// CodeQL js/remote-property-injection). When user-controlled strings
// flow to a computed property write — `target[key] = value` — three
// specific key names can mutate the prototype chain:
//
//   - "__proto__"   — sets the object's prototype directly
//   - "constructor" — when followed by .prototype.x mutation, hijacks the
//                     constructor function
//   - "prototype"   — for function objects, mutates the prototype the
//                     constructor will assign to its instances
//
// A successful pollution attack lets the attacker set properties that
// suddenly appear on every object in the process (Object.prototype.isAdmin
// = true, etc.). The classic incidents (lodash, hoek, dot-prop) all
// trace to a missing guard exactly like this one.
//
// Usage:
//   import { isSafeKey, assertSafeKey } from "@/lib/security/safe-property";
//
//   for (const [key, value] of Object.entries(source)) {
//     if (!isSafeKey(key)) continue;
//     target[key] = value;
//   }
//
//   // Or when a non-skippable assignment must reject hostile input:
//   assertSafeKey(key);
//   target[key] = value;
//
// CodeQL recognition:
//   `.github/codeql/dpf-sanitizers/dpf-sanitizers.model.yml` declares
//   `isSafeKey` as a barrier guard for js/remote-property-injection, so
//   the analyser treats any control-flow branch protected by an
//   `if (isSafeKey(k))` as taint-clearing for k.

/**
 * The exact set of property names that can mutate the prototype chain
 * when used as a computed-write key on any plain object. Kept narrow
 * (these three exact strings) on purpose — a wider denylist would
 * eventually drift and create surprise rejections for legitimate keys.
 */
const DANGEROUS_KEYS: ReadonlySet<string> = new Set([
  "__proto__",
  "constructor",
  "prototype",
]);

/**
 * Returns true when `key` is safe to use as a computed-property write
 * target. Returns false for the three keys that can mutate the
 * prototype chain. Numeric or symbol keys cannot reach this function
 * (the signature requires string).
 */
export function isSafeKey(key: string): boolean {
  return !DANGEROUS_KEYS.has(key);
}

/**
 * Throws if `key` would mutate the prototype chain when used as a
 * computed-property write target. Use at boundaries where rejecting the
 * whole operation (rather than silently skipping the key) is the right
 * failure mode — e.g. when the operation is supposed to be a single
 * atomic write and a hostile key invalidates the whole call.
 */
export function assertSafeKey(key: string): void {
  if (!isSafeKey(key)) {
    throw new Error(
      `Refusing to write to potentially prototype-polluting key: ${JSON.stringify(key)}`,
    );
  }
}
