// Degenerate-environment fixture kit (BI-927D64C0, mechanism M4).
//
// Class B is the dominant late-defect escape class (~30%): a module probes its
// environment, and every unit-test fixture models the HEALTHY world — complete
// tree, one install, small payload, first attempt succeeds, rows fully
// populated. Production is partial, stale, absent, empty, and plural. Each
// builder here is named after a real incident so the shape it models cannot
// quietly drift back to "healthy":
//
//   - partialSourceTree      — BI-EE2B243D: an image-synced install root passed
//                              the availability probe (package.json present)
//                              while carrying no .git and only part of the
//                              tree; true citations were "refuted".
//   - twoInstallIdentities   — federation 8dde5854e (BI-AF675A20): the
//                              link-mismatch guard "only ever passed because
//                              unit tests reused one linkId fixture"; two real
//                              installs mint INDEPENDENT ids.
//   - oversizedPayload       — BI-DC6BE37C: a >1MB diff crashed exec maxBuffer.
//   - flakySucceedsOnAttempt — BI-2B9E16CC: a transient failure was collapsed
//                              to a terminal state; retry paths were untested.
//   - emptyAndNullRows       — SQL three-valued logic: NULL bodies/fields
//                              behave differently from absent rows and from
//                              empty strings (see e.g. Prisma NOT-contains
//                              dropping NULL rows).
//
// Dependency-free by contract: node builtins only, importable from any vitest
// suite as `@/lib/testing/degenerate-env`.

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// (a) partialSourceTree — the image-synced install root (BI-EE2B243D)
// ---------------------------------------------------------------------------

export interface PartialSourceTreeOptions {
  /** Plant a `.git` directory (an ANCHORED tree). Default false — the degenerate shape. */
  withGit?: boolean;
  /** Plant the cited file. Default false — the citation resolves to nothing. */
  withFile?: boolean;
  /** Repo-relative path of the cited file. */
  citedFilePath?: string;
  /** Contents written when `withFile` is true. */
  citedFileContent?: string;
}

export interface PartialSourceTree {
  /** Absolute path of the temp root. `package.json` is always present, so a coarse availability probe says "available". */
  root: string;
  /** Repo-relative path the caller should cite (present iff `withFile`). */
  citedFilePath: string;
}

/**
 * A temp dir shaped like the live install root that defeated the
 * source-availability probe: `package.json` at the root (so "available"),
 * no `.git` (revision unknown), and the cited file absent (partial tree).
 * Both defects are opt-out so the same builder also produces the healthy
 * control shape (`{ withGit: true, withFile: true }`).
 */
export function partialSourceTree(options: PartialSourceTreeOptions = {}): PartialSourceTree {
  const {
    withGit = false,
    withFile = false,
    citedFilePath = "apps/web/lib/cited.ts",
    citedFileContent = 'export function cited() {\n  return "grounded value";\n}\n',
  } = options;
  const root = mkdtempSync(join(tmpdir(), "dpf-degenerate-env-"));
  writeFileSync(join(root, "package.json"), "{}\n", "utf8");
  if (withGit) mkdirSync(join(root, ".git"), { recursive: true });
  if (withFile) {
    const abs = join(root, ...citedFilePath.split("/"));
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, citedFileContent, "utf8");
  }
  return { root, citedFilePath };
}

// ---------------------------------------------------------------------------
// (b) twoInstallIdentities — federation mints INDEPENDENT ids per side
// ---------------------------------------------------------------------------

export interface InstallIdentity {
  installId: string;
  linkId: string;
}

export interface TwoInstallIdentities {
  /** The local side (e.g. the receiver). */
  a: InstallIdentity;
  /** The remote side (e.g. the sender). Every id differs from `a`'s. */
  b: InstallIdentity;
}

/**
 * Two id sets that are guaranteed pairwise distinct, for federation-shaped
 * tests. A test that would pass with `a` substituted for `b` is reusing one
 * identity fixture — exactly the blind spot that shipped the link:mismatch
 * 422 (8dde5854e): equality between the sides' linkIds can never hold across
 * two real installs.
 */
export function twoInstallIdentities(): TwoInstallIdentities {
  const a: InstallIdentity = { installId: randomUUID(), linkId: randomUUID() };
  let b: InstallIdentity = { installId: randomUUID(), linkId: randomUUID() };
  // randomUUID collisions are not a practical concern, but the contract is
  // "independent", so make distinctness unconditional rather than probabilistic.
  while (b.installId === a.installId || b.linkId === a.linkId) {
    b = { installId: randomUUID(), linkId: randomUUID() };
  }
  return { a, b };
}

// ---------------------------------------------------------------------------
// (c) oversizedPayload — bigger than the buffer the code silently assumes
// ---------------------------------------------------------------------------

/**
 * A deterministic filler string of exactly `bytes` bytes (ASCII, so bytes ===
 * chars). Line-structured (80-char lines) so diff/exec paths treat it like
 * real text. `oversizedPayload(2 * 1024 * 1024)` reproduces the >1MB diff
 * that crashed the default `execFile` maxBuffer (BI-DC6BE37C).
 */
export function oversizedPayload(bytes: number): string {
  if (!Number.isInteger(bytes) || bytes < 0) {
    throw new Error(`oversizedPayload: bytes must be a non-negative integer, got ${bytes}`);
  }
  const LINE_WIDTH = 80; // 79 payload chars + "\n"
  const stamp = "degenerate-payload-";
  let out = "";
  let line = 0;
  while (out.length + LINE_WIDTH <= bytes) {
    const head = `${stamp}${line.toString(36)}-`;
    out += head + "x".repeat(LINE_WIDTH - 1 - head.length) + "\n";
    line += 1;
  }
  if (out.length < bytes) out += "y".repeat(bytes - out.length);
  return out;
}

// ---------------------------------------------------------------------------
// (d) flakySucceedsOnAttempt — transient failure is not terminal failure
// ---------------------------------------------------------------------------

export interface FlakyFn<T> {
  (): Promise<T>;
  /** How many times the fn has been invoked so far. */
  readonly attempts: number;
}

/**
 * An async fn that rejects (transiently) on the first `n - 1` calls and
 * resolves `value` on attempt `n`. For retry-path tests: a caller that
 * collapses the first rejection to a terminal state (BI-2B9E16CC) fails
 * against `flakySucceedsOnAttempt(2)`; a correct retry loop succeeds and
 * `fn.attempts` proves how many tries it took.
 */
export function flakySucceedsOnAttempt<T = "ok">(
  n: number,
  options: { value?: T; error?: (attempt: number) => Error } = {},
): FlakyFn<T> {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`flakySucceedsOnAttempt: n must be a positive integer, got ${n}`);
  }
  const { value = "ok" as T, error } = options;
  let attempts = 0;
  const fn = async (): Promise<T> => {
    attempts += 1;
    if (attempts < n) {
      throw error
        ? error(attempts)
        : new Error(`transient failure (attempt ${attempts} of ${n - 1} that fail)`);
    }
    return value;
  };
  Object.defineProperty(fn, "attempts", { get: () => attempts });
  return fn as FlakyFn<T>;
}

// ---------------------------------------------------------------------------
// (e) emptyAndNullRows — SQL three-valued logic shapes
// ---------------------------------------------------------------------------

export interface DegenerateRows<S extends Record<string, unknown>> {
  /** The healthy control: the shape exactly as given. */
  populated: S;
  /** Every field null — the DB row that exists but says nothing. */
  allNull: { [K in keyof S]: null };
  /** String fields emptied, everything else null — "" is not NULL and matches `contains`. */
  emptyStrings: { [K in keyof S]: S[K] extends string ? "" : null };
  /** One row per field with ONLY that field null — isolates which null breaks the path. */
  eachFieldNull: Array<{ [K in keyof S]: S[K] | null }>;
  /** All shapes above, for table-driven tests. */
  rows: Array<Record<keyof S, unknown>>;
}

/**
 * Degenerate row variants of `shape` for SQL three-valued-logic paths.
 * NULL, "", and absent are three different worlds (a negated `contains`
 * silently drops NULL rows; an empty string happily matches it). Feed
 * `rows` through the query path under test and assert each variant lands
 * where the contract says — not where the happy fixture happened to.
 */
export function emptyAndNullRows<S extends Record<string, unknown>>(shape: S): DegenerateRows<S> {
  const keys = Object.keys(shape) as Array<keyof S>;
  const allNull = Object.fromEntries(keys.map((k) => [k, null])) as DegenerateRows<S>["allNull"];
  const emptyStrings = Object.fromEntries(
    keys.map((k) => [k, typeof shape[k] === "string" ? "" : null]),
  ) as DegenerateRows<S>["emptyStrings"];
  const eachFieldNull = keys.map(
    (nullKey) =>
      Object.fromEntries(keys.map((k) => [k, k === nullKey ? null : shape[k]])) as {
        [K in keyof S]: S[K] | null;
      },
  );
  return {
    populated: shape,
    allNull,
    emptyStrings,
    eachFieldNull,
    rows: [shape, allNull, emptyStrings, ...eachFieldNull],
  };
}
