import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CLIENT_CAPABILITY_PROFILE,
  checkClientVersion,
  clientCapabilityRow,
  compareClientVersions,
  extractClientVersion,
  type ClientCapabilityProfile,
} from "./client-capability-profile";
import { bearerHeaderRequiredFor } from "./client-capability-rules.cjs";

// BI-64795FD0: the profile is the one source; the generated copy must be it.
describe("client capability profile", () => {
  it("is the generated copy of client-capabilities.json", () => {
    const source = JSON.parse(readFileSync(resolve(__dirname, "../../dpf-skill-pack/client-capabilities.json"), "utf8"));
    // `writes` is the Python updater's single-writer contract (BI-1DCF9F23); the module omits it.
    const capabilities = Object.fromEntries(
      Object.entries(source.clients as Record<string, Record<string, unknown>>).map(([kind, { writes: _writes, ...row }]) => [kind, row]),
    );
    expect(CLIENT_CAPABILITY_PROFILE.clients).toEqual(capabilities);
  });

  it("lists every client kind that loads the dpf-platform pack", () => {
    for (const kind of ["claude-code", "codex", "grok", "antigravity"]) {
      expect(clientCapabilityRow(kind)?.loadsPack, kind).toBe(true);
    }
    expect(clientCapabilityRow("not-a-client")).toBeNull();
  });
});

describe("compareClientVersions", () => {
  it.each([
    ["2.1.300", "2.1.295", 1],
    ["2.1.295", "2.1.295", 0],
    ["2.1.29", "2.1.295", -1],
    ["0.155.0", "0.155.0-alpha.16", 1],
    ["0.155.0-alpha.17", "0.155.0-alpha.16", 1],
    ["0.155.0-alpha.9", "0.155.0-alpha.16", -1],
    ["v1.2", "1.2.0", 0],
  ])("orders %s against %s", (left, right, sign) => {
    expect(Math.sign(compareClientVersions(left, right) ?? Number.NaN)).toBe(sign);
  });

  it("refuses to order a string that is not a version", () => {
    expect(compareClientVersions("desktop-build", "2.1.295")).toBeNull();
  });
});

describe("extractClientVersion", () => {
  it.each([
    ["2.1.295 (Claude Code)", "2.1.295"],
    ["codex-cli 0.142.5", "0.142.5"],
    ["codex-cli 0.155.0-alpha.16", "0.155.0-alpha.16"],
    ["grok 0.2.87", "0.2.87"],
    ["v1.4.0", "1.4.0"],
  ])("reads the version in %s", (line, version) => {
    expect(extractClientVersion(line)).toBe(version);
  });

  it("returns null when the line carries no version", () => {
    expect(extractClientVersion("command not found")).toBeNull();
    expect(extractClientVersion(null)).toBeNull();
  });
});

describe("checkClientVersion", () => {
  it("flags a Claude Code version newer than the verified one", () => {
    expect(checkClientVersion("claude-code", "2.1.300")).toEqual({
      clientKind: "claude-code",
      clientVersion: "2.1.300",
      verifiedVersion: "2.1.295",
      unverified: true,
    });
  });

  it("does not flag the verified version or an older one", () => {
    expect(checkClientVersion("claude-code", "2.1.295").unverified).toBe(false);
    expect(checkClientVersion("claude-code", "2.0.1").unverified).toBe(false);
  });

  it("flags every version of a client that was never verified", () => {
    expect(checkClientVersion("antigravity", "1.0.0").unverified).toBe(true);
  });

  it("does not flag an unreadable version or an unknown client", () => {
    expect(checkClientVersion("claude-code", "desktop-build").unverified).toBe(false);
    expect(checkClientVersion("cursor", "9.9.9").unverified).toBe(false);
  });
});

describe("the credential rule reads the profile", () => {
  const withGrokOAuth = (): ClientCapabilityProfile => {
    const copy = structuredClone(CLIENT_CAPABILITY_PROFILE) as ClientCapabilityProfile;
    copy.clients.grok!.capabilities.oauthHttps = {
      value: true,
      status: "verified",
      verifiedAt: "2026-10-13",
      verifiedVersion: "0.3.0",
      evidence: "test",
    };
    return copy;
  };

  it("keeps the bearer for Grok today", () => {
    expect(bearerHeaderRequiredFor(CLIENT_CAPABILITY_PROFILE, "https://dpf.example/api/mcp/v1", "grok", "oauth")).toBe(true);
  });

  it("drops the bearer for Grok once the profile proves OAuth over https", () => {
    expect(bearerHeaderRequiredFor(withGrokOAuth(), "https://dpf.example/api/mcp/v1", "grok", "oauth")).toBe(false);
    expect(bearerHeaderRequiredFor(withGrokOAuth(), "http://127.0.0.1:3000/api/mcp/v1", "grok", "oauth")).toBe(true);
  });

  it("never treats an unproven capability as present", () => {
    const copy = withGrokOAuth();
    copy.clients.grok!.capabilities.oauthHttps.status = "unproven";
    expect(bearerHeaderRequiredFor(copy, "https://dpf.example/api/mcp/v1", "grok", "oauth")).toBe(true);
  });

  it("keeps the bearer for a client the profile does not list", () => {
    expect(bearerHeaderRequiredFor(CLIENT_CAPABILITY_PROFILE, "https://dpf.example/api/mcp/v1", "cursor", "oauth")).toBe(true);
  });
});
