import { describe, it, expect } from "vitest";
import { isPathAllowedSync as isPathAllowed, resolveSafePath } from "./codebase-tools";

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
  it("returns resolved path for allowed files", async () => {
    const result = await resolveSafePath("apps/web/lib/mcp-tools.ts");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.path).toContain("mcp-tools.ts");
    }
  });

  it("returns error for blocked files", async () => {
    const result = await resolveSafePath(".env");
    expect(result.ok).toBe(false);
  });
});

// Per the installer-parity roadmap Phase 10c: the path-security
// guards above were originally written for the Windows installer
// (D:\DPF\...). When the macOS + Linux installers shipped, we needed
// to confirm POSIX paths flow through the same guards correctly:
//
//   - Relative POSIX paths (apps/web/...) stay allowed.
//   - POSIX absolute paths (/var/run/..., /Users/..., /Applications/...)
//     stay blocked — they are not browseable through this API surface.
//   - The Windows-drive regex (^[A-Za-z]:) does not false-positive on
//     POSIX paths that happen to contain a colon mid-path.
describe("isPathAllowed — POSIX portability", () => {
  it("allows typical relative POSIX paths used on macOS / Linux installs", () => {
    expect(isPathAllowed("apps/web/lib/mcp-tools.ts")).toBe(true);
    expect(isPathAllowed("packages/db/src/discovery-collectors/host.ts")).toBe(true);
    expect(isPathAllowed("scripts/installer/lib/preflight.sh")).toBe(true);
    expect(isPathAllowed("docs/install/macos.md")).toBe(true);
    expect(isPathAllowed("docs/install/linux.md")).toBe(true);
  });

  it("blocks all POSIX absolute path variants", () => {
    // Generic Unix
    expect(isPathAllowed("/etc/passwd")).toBe(false);
    expect(isPathAllowed("/var/run/docker.sock")).toBe(false);
    expect(isPathAllowed("/tmp/anything")).toBe(false);

    // macOS-specific
    expect(isPathAllowed("/Applications/Docker.app/Contents/Info.plist")).toBe(false);
    expect(isPathAllowed("/Users/foo/dpf/install-dpf.sh")).toBe(false);
    expect(isPathAllowed("/Library/LaunchAgents/local.dpf-autostart.plist")).toBe(false);

    // Linux-specific
    expect(isPathAllowed("/home/user/dpf/install-dpf.sh")).toBe(false);
    expect(isPathAllowed("/opt/dpf/docker-compose.yml")).toBe(false);
    expect(isPathAllowed("/root/.dpf/install-state.json")).toBe(false);
  });

  it("Windows-drive regex does not false-positive on POSIX paths with a colon", () => {
    // The ^[A-Za-z]: regex must anchor at start. Paths with a colon
    // mid-string are unusual on POSIX but legal, and must not be
    // mistaken for D:\ Windows paths.
    expect(isPathAllowed("apps/web/some:thing.ts")).toBe(true);
    expect(isPathAllowed("docs/architecture/note: a draft.md")).toBe(true);
  });

  it("normalizes backslash separators before pattern matching", () => {
    // Operators on POSIX hosts occasionally paste Windows-formatted
    // input (\) into the portal. Path security must catch the same
    // sensitive-file patterns after the unified-slash normalization
    // step (line 53 in codebase-tools.ts), regardless of which
    // separator the caller used.
    expect(isPathAllowed("apps\\web\\.env.local")).toBe(false); // .env. pattern
    expect(isPathAllowed("certs\\server.key")).toBe(false);     // .key$ pattern
    expect(isPathAllowed("secrets\\admin.json")).toBe(false);   // secrets pattern
    expect(isPathAllowed(".git\\config")).toBe(false);          // ^.git/ pattern
  });
});

// Originally, the secrets / credentials BLOCKED_PATTERNS were anchored
// at start-of-path only (/^secrets/i). That defeated their intent —
// nested `config/secrets/admin.json` slipped through. The patterns
// now match `secrets` / `credentials` as any path component (start
// or after a slash, followed by /, ., or end-of-string), so:
//
//   - top-level cases still block (regression coverage)
//   - nested cases now block (the fix)
//   - directories that merely share a prefix still allow
//     (`secrets-management/...` — no false positive)
describe("isPathAllowed — secrets / credentials path-component matching", () => {
  it("blocks 'secrets' at any path depth", () => {
    expect(isPathAllowed("secrets")).toBe(false);
    expect(isPathAllowed("secrets/admin.json")).toBe(false);
    expect(isPathAllowed("secrets.json")).toBe(false);
    // The bug surfaced during Phase 10c — nested case below previously
    // slipped through the start-anchored regex.
    expect(isPathAllowed("config/secrets/admin.json")).toBe(false);
    expect(isPathAllowed("apps/web/lib/secrets/index.ts")).toBe(false);
    expect(isPathAllowed("config/secrets.json")).toBe(false);
  });

  it("blocks 'credentials' at any path depth", () => {
    expect(isPathAllowed("credentials")).toBe(false);
    expect(isPathAllowed("credentials.json")).toBe(false);
    expect(isPathAllowed("config/credentials/admin.json")).toBe(false);
    expect(isPathAllowed("apps/web/credentials.json")).toBe(false);
  });

  it("does not false-positive on directories with shared prefix", () => {
    // The trailing `(?:[\\/.]|$)` in the pattern keeps it from
    // matching legitimate directory or filename starts that happen to
    // share the literal prefix `secrets` / `credentials`.
    expect(isPathAllowed("apps/web/secrets-management/api.ts")).toBe(true);
    expect(isPathAllowed("apps/web/lib/secretsForKids.md")).toBe(true);
    expect(isPathAllowed("docs/credentials-rotation-runbook.md")).toBe(true);
    expect(isPathAllowed("config/credentialsRotation.ts")).toBe(true);
  });
});
