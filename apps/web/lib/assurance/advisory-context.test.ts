import { describe, expect, it } from "vitest";
import {
  buildReconcileContext,
  parseAcceptedAdvisoryIds,
  parseResolvedVersions,
} from "./advisory-context";

const SAMPLE_LOCK = `importers:

  apps/web:
    dependencies:
      hono:
        specifier: ^4.12.25
        version: 4.12.25

packages:

  hono@4.12.25:
    resolution: {integrity: sha512-aaa}

  '@babel/core@7.29.7':
    resolution: {integrity: sha512-bbb}

  undici@7.28.0:
    resolution: {integrity: sha512-ccc}

  undici@8.5.0:
    resolution: {integrity: sha512-ddd}

snapshots:

  '@auth/core@0.41.2(nodemailer@9.0.1)':
    dependencies: {}

  hono@4.12.25: {}
`;

describe("parseResolvedVersions", () => {
  it("collects every resolved version per package, scoped and unscoped", () => {
    const map = parseResolvedVersions(SAMPLE_LOCK);
    expect(map.get("hono")).toEqual(new Set(["4.12.25"]));
    expect(map.get("@babel/core")).toEqual(new Set(["7.29.7"]));
    expect(map.get("undici")).toEqual(new Set(["7.28.0", "8.5.0"]));
  });

  it("skips peer-suffixed snapshot keys and importer paths", () => {
    const map = parseResolvedVersions(SAMPLE_LOCK);
    expect(map.has("@auth/core")).toBe(false);
    expect(map.has("apps/web")).toBe(false);
  });

  it("handles CRLF line endings", () => {
    const map = parseResolvedVersions(SAMPLE_LOCK.replace(/\n/g, "\r\n"));
    expect(map.get("hono")).toEqual(new Set(["4.12.25"]));
  });
});

const SAMPLE_BASELINE = JSON.stringify({
  accepted: [
    { id: "GHSA-h67p-54hq-rp68", aliases: ["CVE-2026-53550"], expires: "2026-12-31" },
    { id: "GHSA-expired", aliases: ["CVE-OLD"], expires: "2020-01-01" },
    { id: "GHSA-noexpiry" },
  ],
});

describe("parseAcceptedAdvisoryIds", () => {
  it("includes unexpired ids and their aliases", () => {
    const ids = parseAcceptedAdvisoryIds(SAMPLE_BASELINE, "2026-06-22");
    expect(ids.has("GHSA-h67p-54hq-rp68")).toBe(true);
    expect(ids.has("CVE-2026-53550")).toBe(true);
    expect(ids.has("GHSA-noexpiry")).toBe(true);
  });

  it("excludes advisories past their expiry (they re-surface)", () => {
    const ids = parseAcceptedAdvisoryIds(SAMPLE_BASELINE, "2026-06-22");
    expect(ids.has("GHSA-expired")).toBe(false);
    expect(ids.has("CVE-OLD")).toBe(false);
  });

  it("returns an empty set on malformed JSON", () => {
    expect(parseAcceptedAdvisoryIds("{not json", "2026-06-22").size).toBe(0);
  });
});

describe("buildReconcileContext", () => {
  it("is available with accepted ids + resolved versions when both sources load", () => {
    const ctx = buildReconcileContext({
      readLock: () => SAMPLE_LOCK,
      readBaseline: () => SAMPLE_BASELINE,
      today: "2026-06-22",
    });
    expect(ctx.available).toBe(true);
    expect(ctx.acceptedAdvisoryIds.has("CVE-2026-53550")).toBe(true);
    expect(ctx.resolvedVersionsByPackage.get("hono")).toEqual(new Set(["4.12.25"]));
  });

  it("fails closed (available=false) when the lockfile cannot be read", () => {
    const ctx = buildReconcileContext({
      readLock: () => null,
      readBaseline: () => SAMPLE_BASELINE,
      today: "2026-06-22",
    });
    expect(ctx.available).toBe(false);
  });

  it("tolerates a missing baseline (lock present → still available, no accepts)", () => {
    const ctx = buildReconcileContext({
      readLock: () => SAMPLE_LOCK,
      readBaseline: () => null,
      today: "2026-06-22",
    });
    expect(ctx.available).toBe(true);
    expect(ctx.acceptedAdvisoryIds.size).toBe(0);
  });

  it("fails closed when a reader throws", () => {
    const ctx = buildReconcileContext({
      readLock: () => {
        throw new Error("boom");
      },
      readBaseline: () => SAMPLE_BASELINE,
      today: "2026-06-22",
    });
    expect(ctx.available).toBe(false);
  });
});
