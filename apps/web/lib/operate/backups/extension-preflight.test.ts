/**
 * Unit tests for the Postgres extension-availability preflight (BI-A35347E4).
 * Pure logic with an injected `ContainerPsql`; no docker, no DB.
 */
import { describe, expect, it, vi } from "vitest";

import {
  DB_EXTENSION_AVAILABILITY_SQL,
  buildMissingExtensionMessage,
  detectMissingExtensions,
  postgresExtensionPreflight,
  type ContainerPsql,
} from "./extension-preflight";

const psqlReturning = (stdout: string, exitCode = 0): ContainerPsql =>
  vi.fn(async () => ({ stdout, exitCode }));

describe("detectMissingExtensions", () => {
  it("passes (ok) when every installed extension is provided by the image", async () => {
    const result = await detectMissingExtensions(psqlReturning("\n"));
    expect(result).toEqual({ ok: true });
  });

  it("fails with an actionable remedy when an extension is unprovided", async () => {
    const result = await detectMissingExtensions(psqlReturning("vector\n"));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toContain("vector");
    expect(result.error).toContain("docker compose up -d --no-deps postgres");
  });

  it("handles multiple unprovided extensions (comma-joined string_agg)", async () => {
    const result = await detectMissingExtensions(psqlReturning("ltree,vector"));
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toContain("ltree");
    expect(result.error).toContain("vector");
    expect(result.error).toContain("extensions"); // plural wording
  });

  it("FAILS OPEN on a non-zero psql exit (inconclusive, never a new failure)", async () => {
    const result = await detectMissingExtensions(psqlReturning("garbage", 1));
    expect(result).toEqual({ ok: true });
  });

  it("FAILS OPEN when the psql invocation throws (DB unreachable / no docker)", async () => {
    const throwing: ContainerPsql = vi.fn(async () => {
      throw new Error("docker: command not found");
    });
    const result = await detectMissingExtensions(throwing);
    expect(result).toEqual({ ok: true });
  });

  it("ignores whitespace-only output (string_agg NULL renders empty)", async () => {
    const result = await detectMissingExtensions(psqlReturning("   \n  "));
    expect(result).toEqual({ ok: true });
  });
});

describe("buildMissingExtensionMessage", () => {
  it("names a single extension and uses singular phrasing", () => {
    const msg = buildMissingExtensionMessage(["vector"]);
    expect(msg).toContain("the extension the database requires: vector");
    expect(msg).toContain("pgvector");
    expect(msg).toContain("docker compose up -d --no-deps postgres");
  });

  it("uses plural phrasing for multiple extensions", () => {
    const msg = buildMissingExtensionMessage(["ltree", "vector"]);
    expect(msg).toContain("extensions the database requires: ltree, vector");
  });
});

describe("DB_EXTENSION_AVAILABILITY_SQL", () => {
  it("joins the catalog against image-provided extensions", () => {
    // Guard the detection contract: catalog (pg_extension) vs image
    // (pg_available_extensions) is the whole mechanism.
    expect(DB_EXTENSION_AVAILABILITY_SQL).toContain("pg_extension");
    expect(DB_EXTENSION_AVAILABILITY_SQL).toContain("pg_available_extensions");
    expect(DB_EXTENSION_AVAILABILITY_SQL).toContain("IS NULL");
  });
});

describe("postgresExtensionPreflight", () => {
  it("threads the injected psql through and reports a definitive miss", async () => {
    const psql = psqlReturning("vector");
    const result = await postgresExtensionPreflight(
      { composeProject: "dpf" },
      psql,
    );
    expect(result.ok).toBe(false);
    expect(psql).toHaveBeenCalledWith(DB_EXTENSION_AVAILABILITY_SQL);
  });

  it("returns ok when the injected psql reports no missing extensions", async () => {
    const result = await postgresExtensionPreflight(
      { composeProject: "dpf" },
      psqlReturning(""),
    );
    expect(result).toEqual({ ok: true });
  });
});
