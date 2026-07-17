#!/usr/bin/env -S pnpm --filter web exec tsx
// apps/web/scripts/issue-mcp-token.ts
//
// One-shot CLI that issues an MCP API token for the local DPF install and
// prints a ready-to-paste config snippet to stdout. Closes the "had to click
// through the UI" gap for fresh installs and headless environments.
//
// Uses the same business-logic helper as Admin > Platform Development, so the
// issued token appears in the Admin token list with a full audit trail.
//
// Run from the repo root:
//
//   pnpm --filter web exec tsx apps/web/scripts/issue-mcp-token.ts
//
// Or from apps/web/:
//
//   pnpm exec tsx scripts/issue-mcp-token.ts
//
// Output:
//   stdout  — the chosen snippet (pipe-friendly, only this)
//   stderr  — diagnostic line (prefix, expiry, tokenId, user)
//
// Examples:
//
//   # Write .mcp.json for Claude Code (default, env-var backed):
//   pnpm --filter web exec tsx apps/web/scripts/issue-mcp-token.ts > .mcp.json
//   TOKEN=$(pnpm --filter web exec tsx apps/web/scripts/issue-mcp-token.ts --format raw)
//
//   # Write VS Code mcp.json:
//   pnpm --filter web exec tsx apps/web/scripts/issue-mcp-token.ts --format vscode > .vscode/mcp.json
//
//   # Get the raw token for scripting:
//   TOKEN=$(pnpm --filter web exec tsx apps/web/scripts/issue-mcp-token.ts --format raw)
//
// Sibling: apps/web/scripts/issue-edge-bootstrap-token.ts

import { prisma } from "@dpf/db";
import type { McpTokenCapability, McpTokenScope } from "../lib/auth/mcp-api-token";
import type { McpSnippetFormat } from "../lib/auth/mcp-setup-snippets";

const DEFAULT_EMAIL = "admin@dpf.local";
const DEFAULT_EXPIRES_DAYS = 90;

type Args = {
  email: string;
  name: string;
  scope: McpTokenScope;
  scopes: string[] | null; // null -> resolved from the selected read/write/admin tier
  expiresDays: number | null;
  format: McpSnippetFormat;
  baseUrl: string;
};

function parseArgs(argv: readonly string[]): Args {
  let email = DEFAULT_EMAIL;
  let name = `cli-issued-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  let scope: McpTokenScope = "read";
  let scopes: string[] | null = null;
  let expiresDays: number | null = DEFAULT_EXPIRES_DAYS;
  let format: McpSnippetFormat = "claude-code";
  let baseUrl =
    process.env["AUTH_URL"] ?? process.env["APP_URL"] ?? "http://localhost:3000";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const next = (): string => {
      const v = argv[i + 1];
      if (!v) fatal(`${arg} requires a value`);
      i++;
      return v;
    };

    switch (arg) {
      case "--user":
        email = next();
        break;
      case "--name":
        name = next();
        break;
      case "--scope": {
        const v = next();
        if (v !== "read" && v !== "write" && v !== "admin") {
          fatal(`--scope must be read | write | admin; got: ${v}`);
        }
        scope = v;
        break;
      }
      case "--capability": {
        const v = next();
        if (v !== "read" && v !== "write") {
          fatal(`--capability is deprecated; use --scope read|write|admin. Got: ${v}`);
        }
        scope = v;
        break;
      }
      case "--scopes": {
        const parsed = next()
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        if (parsed.length === 0) fatal("--scopes produced an empty list after splitting");
        scopes = parsed;
        break;
      }
      case "--expires-days": {
        const v = next();
        if (v === "never") {
          expiresDays = null;
        } else {
          const n = Number(v);
          if (!Number.isFinite(n) || n <= 0) {
            fatal(`--expires-days must be a positive number or "never"; got: ${v}`);
          }
          expiresDays = Math.floor(n);
        }
        break;
      }
      case "--format": {
        const v = next();
        if (
          v !== "claude-code" &&
          v !== "codex" &&
          v !== "grok" &&
          v !== "antigravity" &&
          v !== "vscode" &&
          v !== "raw"
        ) {
          fatal(`--format must be claude-code | codex | grok | antigravity | vscode | raw; got: ${v}`);
        }
        format = v;
        break;
      }
      case "--base-url":
        baseUrl = next().replace(/\/$/, "");
        break;
      case "--help":
      case "-h":
        printHelp();
        process.exit(0);
      default:
        fatal(`unknown argument: ${arg}`);
    }
  }

  return { email, name, scope, scopes, expiresDays, format, baseUrl };
}

function printHelp(): void {
  console.error(
    [
      "Usage: pnpm --filter web exec tsx apps/web/scripts/issue-mcp-token.ts [flags]",
      "",
      "Issues an MCP API token and prints a ready-to-paste config snippet to stdout.",
      "The issued token appears in Admin > Platform Development with a full audit trail.",
      "",
      "Flags:",
      "  --user <email>         Admin user to issue the token for",
      `                         (default: ${DEFAULT_EMAIL})`,
      "  --name <label>         Token display name (default: cli-issued-<timestamp>)",
      "  --scope <scope>        read | write | admin (default: read)",
      "  --capability <c>       Deprecated alias for --scope read|write",
      "  --scopes <csv>         Comma-separated scope list (overrides the default)",
      "                         Default by --scope: write -> development role",
      "                         template (sandbox_execute, iac_execute, build_promote,",
      "                         ...); admin -> admin template; read -> coding-agent reads.",
      `  --expires-days N|never Token TTL in days, or "never" (default: ${DEFAULT_EXPIRES_DAYS})`,
      "  --format <fmt>         claude-code | codex | grok | antigravity | vscode | raw (default: claude-code)",
      "  --base-url <url>       Portal base URL",
      "                         (default: $AUTH_URL / $APP_URL / http://localhost:3000)",
      "  --help, -h             Show this help",
      "",
      "Output (stdout):",
      "  claude-code  .mcp.json snippet   (mcpServers.dpf, http transport)",
      "  codex        ~/.codex/config.toml snippet using bearer_token_env_var",
      "  grok         ~/.grok/config.toml snippet (same TOML shape as codex; also works for project .grok/config.toml)",
      "  antigravity  ~/.antigravity/mcp_config.json snippet (mcpServers.dpf, http transport; confirm path per EP-ANTIGRAVITY-001 evidence gate)",
      "  vscode       .vscode/mcp.json snippet (servers.dpf)",
      "  raw          Plaintext token only",
      "",
      "Examples:",
      "  pnpm --filter web exec tsx apps/web/scripts/issue-mcp-token.ts > .mcp.json",
      "  pnpm --filter web exec tsx apps/web/scripts/issue-mcp-token.ts --format codex >> ~/.codex/config.toml",
      "  pnpm --filter web exec tsx apps/web/scripts/issue-mcp-token.ts --format grok >> ~/.grok/config.toml",
      "  pnpm --filter web exec tsx apps/web/scripts/issue-mcp-token.ts --format vscode > .vscode/mcp.json",
      "  TOKEN=$(pnpm --filter web exec tsx apps/web/scripts/issue-mcp-token.ts --format raw)",
    ].join("\n"),
  );
}

function fatal(msg: string): never {
  console.error(`issue-mcp-token: ${msg}`);
  process.exit(2);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // Dynamic imports so tsx resolves path aliases correctly at runtime.
  const { issueMcpApiToken } = await import("../lib/auth/mcp-api-token");
  const { buildSetupSnippets } = await import("../lib/auth/mcp-setup-snippets");
  const { templateScopesForTier } = await import("../lib/mcp-token-scopes");
  const { getToolGrantMapping } = await import("../lib/tak/agent-grants");

  const user = await prisma.user.findFirst({ where: { email: args.email } });
  if (!user) {
    fatal(
      `No user found with email "${args.email}". ` +
        `Ensure the platform is running and seeded (pnpm dev or docker compose up), ` +
        `then re-run. Override with --user <email>.`,
    );
  }

  // Available scopes = the union of every grant this install registers in the
  // tool→grant catalog. Mirrors listAvailableMcpScopes (lib/actions/mcp-tokens.ts)
  // so a CLI-issued token resolves the same role-template grants the Admin UI
  // would — a write token gets the full `development` bundle (sandbox_execute,
  // iac_execute, build_promote, …), not the narrow legacy write set.
  const availableScopes = (() => {
    const set = new Set<string>();
    for (const grants of Object.values(getToolGrantMapping())) {
      for (const g of grants) set.add(g);
    }
    return [...set];
  })();
  const scopes: string[] = args.scopes ?? templateScopesForTier(args.scope, availableScopes);
  const capability: McpTokenCapability = args.scope === "read" ? "read" : "write";

  const result = await issueMcpApiToken({
    userId: user.id,
    name: args.name,
    capability,
    scope: args.scope,
    scopes,
    expiresInDays: args.expiresDays,
  });

  if (!result.ok) {
    fatal(result.message);
  }

  // Diagnostics to stderr — stdout stays pipeable.
  const expiryStr = result.expiresAt ? result.expiresAt.toISOString() : "never";
  console.error(
    `Issued MCP token ${result.prefix}…  expires ${expiryStr}  tokenId=${result.tokenId}  user=${args.email}`,
  );

  if (args.format === "raw") {
    console.log(result.plaintext);
  } else {
    const snippets = buildSetupSnippets(result.plaintext, args.baseUrl);
    const snippet =
      args.format === "vscode"
        ? snippets.vscode
        : args.format === "codex"
          ? snippets.codex
          : args.format === "grok"
            ? snippets.grok
            : args.format === "antigravity"
              ? snippets.antigravity
              : snippets.claudeCode;
    console.log(snippet);
  }

  await prisma.$disconnect();
}

main().catch(async (err: unknown) => {
  console.error(`issue-mcp-token failed: ${(err as Error).stack ?? err}`);
  try {
    await prisma.$disconnect();
  } catch {
    // best effort
  }
  process.exit(1);
});
