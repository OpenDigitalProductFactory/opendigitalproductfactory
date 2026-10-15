#!/usr/bin/env -S pnpm --filter web exec tsx
// Create or re-read the installing operator's Grok client_credentials client.
//
// Runs inside the portal container, where the database is reachable. Stdout is
// one JSON object for the refresher. Stderr is diagnostics. This script does
// not mint a personal access token.
//
//   pnpm --filter web exec tsx apps/web/scripts/issue-grok-credentials-client.ts --user admin@dpf.local

import { prisma } from "@dpf/db";

const DEFAULT_EMAIL = "admin@dpf.local";

function fatal(message: string): never {
  console.error(`issue-grok-credentials-client: ${message}`);
  process.exit(2);
}

function parseUser(argv: readonly string[]): string {
  let email = DEFAULT_EMAIL;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.error("Usage: issue-grok-credentials-client.ts [--user <email>]");
      process.exit(0);
    }
    if (arg === "--user") {
      const value = argv[i + 1];
      if (!value) fatal("--user requires a value");
      email = value;
      i++;
      continue;
    }
    fatal(`unknown argument: ${arg}`);
  }
  return email;
}

async function main(): Promise<void> {
  const email = parseUser(process.argv.slice(2));
  const { ensureGrokCredentialsClient, GROK_CREDENTIALS_CLIENT_NAME } = await import("../lib/auth/grok-credentials-client");
  const { prepareClientSecret } = await import("../lib/auth/oauth-tokens");
  const { decryptSecret } = await import("../lib/govern/credential-crypto");
  const { grokAgentRecordId, bindGrokClientAgent } = await import("../lib/auth/grok-agent-binding");

  const user = await prisma.user.findFirst({ where: { email } });
  if (!user) {
    fatal(`No user found with email "${email}". Override with --user <email>.`);
  }

  const result = await ensureGrokCredentialsClient({
    ownerUserId: user.id,
    rows: async () => prisma.oAuthClient.findMany({
      where: { ownerUserId: user.id, clientName: GROK_CREDENTIALS_CLIENT_NAME },
      select: {
        oAuthClientId: true,
        clientName: true,
        registrationKind: true,
        ownerUserId: true,
        revokedAt: true,
        allowedScopes: true,
        clientSecretEnc: true,
        agentId: true,
      },
    }),
    create: async (input) => {
      await prisma.oAuthClient.create({
        data: {
          oAuthClientId: input.oAuthClientId,
          clientName: input.clientName,
          registrationKind: input.registrationKind,
          clientSecretHash: input.clientSecretHash,
          clientSecretEnc: input.clientSecretEnc,
          ownerUserId: input.ownerUserId,
          allowedScopes: [...input.allowedScopes],
          redirectUris: [],
          agentId: input.agentId,
        },
      });
    },
    grokAgent: () => grokAgentRecordId(prisma),
    bindAgent: (oAuthClientId, agentRecordId) => bindGrokClientAgent(prisma, oAuthClientId, agentRecordId),
    decrypt: decryptSecret,
    prepareSecret: prepareClientSecret,
  });

  console.error(`Grok credentials client ${result.clientId} ${result.created ? "created" : "reused"} for ${email}${result.agentBound ? " (acts as AGT-EXT-GROK)" : " (NOT bound to AGT-EXT-GROK: Grok cannot write workrooms)"}`);
  console.log(JSON.stringify({
    clientId: result.clientId,
    clientSecret: result.clientSecret,
    created: result.created,
  }));
  await prisma.$disconnect();
}

main().catch(async (err: unknown) => {
  console.error(`issue-grok-credentials-client failed: ${(err as Error).stack ?? err}`);
  try {
    await prisma.$disconnect();
  } catch {
    // best effort
  }
  process.exit(1);
});
