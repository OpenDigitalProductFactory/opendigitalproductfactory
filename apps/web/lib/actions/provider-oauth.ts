"use server";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { prisma } from "@dpf/db";
import { createOAuthFlow } from "@/lib/provider-oauth";

async function requireManageProviders(): Promise<string> {
  const session = await auth();
  const user = session?.user;
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "manage_provider_connections")) {
    throw new Error("Unauthorized");
  }
  return user.id;
}

export async function startProviderOAuth(providerId: string): Promise<{ authorizeUrl: string } | { error: string }> {
  await requireManageProviders();
  return createOAuthFlow(providerId);
}

export async function disconnectProviderOAuth(providerId: string): Promise<{ error?: string }> {
  await requireManageProviders();
  await prisma.credentialEntry.upsert({
    where: { providerId },
    create: { providerId, status: "unconfigured" },
    update: {
      cachedToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      status: "unconfigured",
    },
  });

  // Deactivate linked MCP services when provider disconnects
  const linkedServers = await prisma.mcpServer.findMany({
    where: { config: { path: ["linkedProviderId"], equals: providerId } },
  });
  for (const server of linkedServers) {
    await prisma.mcpServer.update({ where: { id: server.id }, data: { status: "inactive" } });
    await prisma.modelProvider.updateMany({
      where: { providerId: server.serverId, status: "active" },
      data: { status: "inactive" },
    });
  }

  return {};
}
