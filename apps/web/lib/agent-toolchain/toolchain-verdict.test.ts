// BI-54469E18 — AC-VERDICT, AC-FLOOR-SCOPE (verdict half), AC-INSTRUCT.
import { describe, expect, it } from "vitest";

import {
  formatToolchainNotice,
  parseToolchainDeclaration,
  resolveToolchainVerdict,
  toolchainFloorGraceEnded,
  type PublishedToolchain,
} from "./toolchain-verdict";

const DIGEST = "ab".repeat(32);
const RELEASE: PublishedToolchain = { packVersion: "0.3.0", packDigest: DIGEST, floor: { minPackVersion: null, graceStartsAt: null } };
const FLOORED: PublishedToolchain = { ...RELEASE, floor: { minPackVersion: "0.3.0", graceStartsAt: "2026-10-10T00:00:00Z" } };
const HTTPS = "https://dpf.example/api/mcp/v1";
const LOOPBACK_HTTP = "http://127.0.0.1:3000/api/mcp/v1";
const none = { get: () => null };
const IN_GRACE = new Date("2026-10-12T00:00:00Z");
const AFTER_GRACE = new Date("2026-10-18T00:00:00Z");

function declared(client: string, pack = "0.3.0", digest = DIGEST.slice(0, 16)) {
  return { pack, digest, client };
}

describe("parseToolchainDeclaration", () => {
  it("reads the query carrier and the header carrier", () => {
    expect(parseToolchainDeclaration(`${HTTPS}?tier=full&dpf_pack=0.3.0&dpf_digest=${DIGEST.slice(0, 16)}&dpf_client=codex`, none))
      .toEqual(declared("codex"));
    const headers = { get: (name: string) => (name === "x-dpf-toolchain" ? `pack=0.3.0; digest=${DIGEST.slice(0, 16)}; client=grok` : null) };
    expect(parseToolchainDeclaration(HTTPS, headers)).toEqual(declared("grok"));
  });

  it("treats malformed values and unknown clients as no declaration", () => {
    expect(parseToolchainDeclaration(`${HTTPS}?dpf_pack=0.3&dpf_digest=${DIGEST.slice(0, 16)}&dpf_client=codex`, none)).toBeNull();
    expect(parseToolchainDeclaration(`${HTTPS}?dpf_pack=0.3.0&dpf_digest=xyz&dpf_client=codex`, none)).toBeNull();
    expect(parseToolchainDeclaration(`${HTTPS}?dpf_pack=0.3.0&dpf_digest=${DIGEST.slice(0, 16)}&dpf_client=my-agent`, none)).toBeNull();
    expect(parseToolchainDeclaration(HTTPS, none)).toBeNull();
  });
});

describe("resolveToolchainVerdict", () => {
  const oauth = { authSource: "oauth" as const };
  const pat = { authSource: "pat" as const, credentialKind: "operator" };

  it("current when the declared digest matches the release", () => {
    expect(resolveToolchainVerdict({ declaration: declared("claude-code"), credential: oauth, mcpEndpoint: HTTPS, published: RELEASE, now: AFTER_GRACE }).verdict).toBe("current");
  });

  it("stale when the declared digest differs", () => {
    const result = resolveToolchainVerdict({ declaration: declared("codex", "0.3.0", "0".repeat(16)), credential: oauth, mcpEndpoint: HTTPS, published: RELEASE, now: AFTER_GRACE });
    expect(result.verdict).toBe("stale");
  });

  it("undeclared with no declaration, whatever the User-Agent says", () => {
    expect(resolveToolchainVerdict({ declaration: null, credential: pat, mcpEndpoint: HTTPS, published: FLOORED, now: AFTER_GRACE }).verdict).toBe("undeclared");
  });

  it("applies no floor rules until a release configures a floor", () => {
    const result = resolveToolchainVerdict({ declaration: declared("claude-code", "0.2.8"), credential: pat, mcpEndpoint: HTTPS, published: RELEASE, now: AFTER_GRACE });
    expect(result.verdict).toBe("current");
  });

  it("below-floor for a declared pack older than the floor", () => {
    const result = resolveToolchainVerdict({ declaration: declared("codex", "0.2.9"), credential: oauth, mcpEndpoint: HTTPS, published: FLOORED, now: AFTER_GRACE });
    expect(result.verdict).toBe("below-floor");
  });

  it("below-floor for a bearer where the credential policy says OAuth is available", () => {
    expect(resolveToolchainVerdict({ declaration: declared("claude-code"), credential: pat, mcpEndpoint: HTTPS, published: FLOORED, now: AFTER_GRACE }).verdict).toBe("below-floor");
  });

  it("never below-floor for a bearer the policy requires (plain-http Claude)", () => {
    expect(resolveToolchainVerdict({ declaration: declared("claude-code"), credential: pat, mcpEndpoint: LOOPBACK_HTTP, published: FLOORED, now: AFTER_GRACE }).verdict).toBe("current");
  });

  // BI-84C1F526 / DI-4B843FAF62F9: Grok's own credential is its registered
  // OAuth credentials client. An operator token is stale during grace and
  // below the floor once grace ends.
  it("Grok on its own credentials client is current", () => {
    const own = { authSource: "oauth" as const, credentialKind: "grok-credentials-client" };
    expect(resolveToolchainVerdict({ declaration: declared("grok"), credential: own, mcpEndpoint: HTTPS, published: FLOORED, now: AFTER_GRACE }).verdict).toBe("current");
  });

  it("Grok on an operator token is stale during grace and below-floor after it", () => {
    const inGrace = resolveToolchainVerdict({ declaration: declared("grok"), credential: pat, mcpEndpoint: HTTPS, published: FLOORED, now: IN_GRACE });
    expect(inGrace.verdict).toBe("stale");
    expect(inGrace.reasons.join(" ")).toMatch(/own credentials client/);
    expect(resolveToolchainVerdict({ declaration: declared("grok"), credential: pat, mcpEndpoint: HTTPS, published: FLOORED, now: AFTER_GRACE }).verdict).toBe("below-floor");
  });

  it("Grok on an operator token stays stale while the release names no grace start", () => {
    const noStart: PublishedToolchain = { ...RELEASE, floor: { minPackVersion: "0.3.0", graceStartsAt: null } };
    expect(resolveToolchainVerdict({ declaration: declared("grok"), credential: pat, mcpEndpoint: HTTPS, published: noStart, now: AFTER_GRACE }).verdict).toBe("stale");
  });

  it("an OAuth token from some other client is not Grok's own credential", () => {
    const other = { authSource: "oauth" as const, credentialKind: "oauth_access" };
    expect(resolveToolchainVerdict({ declaration: declared("grok"), credential: other, mcpEndpoint: HTTPS, published: FLOORED, now: AFTER_GRACE }).verdict).toBe("below-floor");
  });
});

describe("toolchainFloorGraceEnded", () => {
  it("ends seven days after graceStartsAt and never without one", () => {
    expect(toolchainFloorGraceEnded(FLOORED.floor, IN_GRACE)).toBe(false);
    expect(toolchainFloorGraceEnded(FLOORED.floor, AFTER_GRACE)).toBe(true);
    expect(toolchainFloorGraceEnded({ minPackVersion: "0.3.0", graceStartsAt: null }, AFTER_GRACE)).toBe(false);
    expect(toolchainFloorGraceEnded({ minPackVersion: "0.3.0", graceStartsAt: "not a date" }, AFTER_GRACE)).toBe(false);
  });
});

describe("formatToolchainNotice", () => {
  const base = { published: RELEASE, manifestUrl: "https://dpf.example/api/agent-toolchain/manifest" };

  it("asks the agent to repair a stale copy, names the portal, and never hands the user a command", () => {
    const declaration = declared("codex", "0.2.8", "0".repeat(16));
    const notice = formatToolchainNotice({
      ...base,
      declaration,
      probableClient: null,
      result: resolveToolchainVerdict({ declaration, credential: { authSource: "oauth" }, mcpEndpoint: HTTPS, published: RELEASE, now: AFTER_GRACE }),
    })!;
    expect(notice).toMatch(/^TOOLCHAIN: out of date/);
    expect(notice).toContain(base.manifestUrl);
    expect(notice).toContain("restart this client");
    expect(notice).toContain("Never show the user a command");
    expect(notice).not.toMatch(/`|\bpython\b|update_agent_toolchain|claude plugin/);
  });

  it("names the full installation id the updater must expect, when known", () => {
    const declaration = declared("codex", "0.2.8", "0".repeat(16));
    const result = resolveToolchainVerdict({ declaration, credential: { authSource: "oauth" }, mcpEndpoint: HTTPS, published: RELEASE, now: AFTER_GRACE });
    const did = `did_${"a1".repeat(32)}`;
    expect(formatToolchainNotice({ ...base, declaration, probableClient: null, result, installationId: did })).toContain(`expecting installation ${did}.`);
    expect(formatToolchainNotice({ ...base, declaration, probableClient: null, result, installationId: null })).not.toContain("expecting installation");
  });

  it("is a short confirmation for a current copy, and silent for an undeclared non-DPF caller", () => {
    const current = formatToolchainNotice({ ...base, declaration: declared("codex"), probableClient: null, result: { verdict: "current", reasons: [] } });
    expect(current).toMatch(/^TOOLCHAIN: current/);
    expect(formatToolchainNotice({ ...base, declaration: null, probableClient: null, result: { verdict: "undeclared", reasons: [] } })).toBeNull();
    expect(formatToolchainNotice({ ...base, declaration: null, probableClient: "claude-code", result: { verdict: "undeclared", reasons: [] } }))
      .toMatch(/predates release declarations/);
  });
});
