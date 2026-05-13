#!/usr/bin/env -S pnpm --filter web exec tsx
// apps/web/scripts/issue-edge-bootstrap-token.ts
//
// One-shot CLI that issues a bootstrap token for the local-host
// Edge Node. Used by the verification wrapper script
// (scripts/verify-install-edge.sh) and by operators who want to script
// enrollment instead of going through the Admin > Edge Nodes UI.
//
// Lives under apps/web/scripts/ so it can import from apps/web/lib/
// directly and so @dpf/db resolves via the apps/web package's
// workspace deps.
//
// Run from the repo root:
//
//   pnpm --filter web exec tsx scripts/issue-edge-bootstrap-token.ts
//
// Talks directly to Postgres via Prisma — does NOT route through the
// portal's auth layer. Designed to be runnable only by someone with
// host access (i.e. the operator on the DPF machine), so it doesn't
// need session auth. The bootstrap token it mints flows through the
// same single-use, 15-min-default-TTL contract that the UI path uses,
// so the issued token shows up in BootstrapToken with full audit
// attribution to the synthetic "installer" Principal.
//
// Output: plaintext token on stdout (and only that, so it's pipeable).
// All other diagnostic output goes to stderr.
//
// Spec: docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md
//   § Approval policy ("Auto-approve when the bootstrap token is
//   issued by the local installer for the DPF host's own Edge Node")

import { prisma } from "@dpf/db";

const INSTALLER_PRINCIPAL_KIND = "service_account";
const INSTALLER_PRINCIPAL_DISPLAY = "DPF installer (local host)";
const INSTALLER_PRINCIPAL_EXTERNAL_ID = "service_account:installer:local-host";

type Args = {
  ttlMinutes: number;
};

function parseArgs(argv: readonly string[]): Args {
  let ttlMinutes = 15;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--ttl-minutes" || arg === "-t") {
      const next = argv[i + 1];
      if (!next) fatal("--ttl-minutes requires a value");
      const parsed = Number(next);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        fatal(`--ttl-minutes must be a positive number; got: ${next}`);
      }
      ttlMinutes = Math.floor(parsed);
      i++;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg !== undefined) {
      fatal(`unknown argument: ${arg}`);
    }
  }
  return { ttlMinutes };
}

function printHelp(): void {
  console.error(
    [
      "Usage: pnpm exec tsx scripts/issue-edge-bootstrap-token.ts [flags]",
      "",
      "Flags:",
      "  --ttl-minutes, -t N    TTL in minutes (default 15; max 1440)",
      "  --help, -h             Show this help",
      "",
      "Output:",
      "  Plaintext token on stdout. Single-use, ≤ N minute TTL.",
      "  Capture with: TOKEN=$(pnpm exec tsx scripts/issue-edge-bootstrap-token.ts)",
      "",
      "Spec:",
      "  docs/superpowers/specs/2026-05-09-dpf-edge-node-design.md",
      "  § Token namespaces and lifecycle",
    ].join("\n"),
  );
}

function fatal(msg: string): never {
  console.error(`issue-edge-bootstrap-token: ${msg}`);
  process.exit(2);
}

/**
 * Find-or-create the synthetic "installer" Principal that owns
 * tokens issued by this CLI. Using a stable principalId means audit
 * rows for installer-issued tokens are queryable as a coherent set,
 * separate from operator-issued tokens (those have real user
 * Principal ids).
 */
async function getInstallerPrincipalId(): Promise<string> {
  const existing = await prisma.principalAlias.findUnique({
    where: {
      aliasType_aliasValue_issuer: {
        aliasType: INSTALLER_PRINCIPAL_KIND,
        aliasValue: "installer:local-host",
        issuer: "",
      },
    },
    include: { principal: true },
  });
  if (existing?.principal) {
    return existing.principal.id;
  }
  const principal = await prisma.principal.create({
    data: {
      principalId: INSTALLER_PRINCIPAL_EXTERNAL_ID,
      kind: INSTALLER_PRINCIPAL_KIND,
      displayName: INSTALLER_PRINCIPAL_DISPLAY,
    },
  });
  await prisma.principalAlias.create({
    data: {
      principalId: principal.id,
      aliasType: INSTALLER_PRINCIPAL_KIND,
      aliasValue: "installer:local-host",
    },
  });
  return principal.id;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  // We use the same business-logic helper the operator UI uses —
  // single-use enforcement, TTL clamp, prefix conventions all stay
  // consistent. Path resolves relative to this file's location under
  // apps/web/scripts/.
  const { issueBootstrapToken } = await import("../lib/edge-node/enrollment");

  const principalId = await getInstallerPrincipalId();
  const result = await issueBootstrapToken({
    issuedByPrincipalId: principalId,
    ttlMs: args.ttlMinutes * 60_000,
  });

  // Diagnostics to stderr so stdout is pipeable.
  console.error(
    `Issued bootstrap token ${result.prefix}…  expires ${result.expiresAt.toISOString()}  tokenId=${result.tokenId}`,
  );

  // Plaintext token to stdout. SHOWN ONCE.
  console.log(result.plaintext);

  await prisma.$disconnect();
}

main().catch(async (err: unknown) => {
  console.error(`issue-edge-bootstrap-token failed: ${(err as Error).stack ?? err}`);
  try {
    await prisma.$disconnect();
  } catch {
    // best effort
  }
  process.exit(1);
});
