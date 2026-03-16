import { describe, it, expect } from "vitest";
import { isPathAllowed, resolveSafePath } from "./codebase-tools";

describe("isPathAllowed", () => {
  it("allows source files", () => {
    expect(isPathAllowed("apps/web/lib/mcp-tools.ts")).toBe(true);
    expect(isPathAllowed("packages/db/prisma/schema.prisma")).toBe(true);
    expect(isPathAllowed("scripts/fresh-install.ps1")).toBe(true);
  });

  it("allows config files", () => {
    expect(isPathAllowed("package.json")).toBe(true);
    expect(isPathAllowed("docker-compose.yml")).toBe(true);
    expect(isPathAllowed("AGENTS.md")).toBe(true);
  });

  it("blocks .env files", () => {
    expect(isPathAllowed(".env")).toBe(false);
    expect(isPathAllowed(".env.local")).toBe(false);
    expect(isPathAllowed("apps/web/.env.local")).toBe(false);
  });

  it("blocks credential files", () => {
    expect(isPathAllowed("secrets.json")).toBe(false);
    expect(isPathAllowed("credentials.json")).toBe(false);
    expect(isPathAllowed("server.key")).toBe(false);
    expect(isPathAllowed("cert.pem")).toBe(false);
  });

  it("blocks path traversal", () => {
    expect(isPathAllowed("../etc/passwd")).toBe(false);
    expect(isPathAllowed("apps/../../etc/passwd")).toBe(false);
  });

  it("blocks absolute paths", () => {
    expect(isPathAllowed("/etc/passwd")).toBe(false);
    expect(isPathAllowed("C:\\Windows\\System32")).toBe(false);
  });

  it("blocks node_modules", () => {
    expect(isPathAllowed("node_modules/foo/index.js")).toBe(false);
  });

  it("blocks .git internals", () => {
    expect(isPathAllowed(".git/config")).toBe(false);
    expect(isPathAllowed(".git/objects/abc")).toBe(false);
  });
});

describe("resolveSafePath", () => {
  it("returns resolved path for allowed files", () => {
    const result = resolveSafePath("apps/web/lib/mcp-tools.ts");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toContain("mcp-tools.ts");
    }
  });

  it("returns error for blocked files", () => {
    const result = resolveSafePath(".env");
    expect(result.ok).toBe(false);
  });
});
