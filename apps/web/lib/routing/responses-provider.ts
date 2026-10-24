import { prisma } from "@dpf/db";

/** OAuth Codex executes on the shared subscription backend, not its API-key URL. */
export async function resolveResponsesProbeBaseUrl(provider: {
  providerId: string;
  authMethod: string;
  baseUrl: string | null;
  endpoint: string | null;
}): Promise<string> {
  if (provider.providerId === "codex" && provider.authMethod === "oauth2_authorization_code") {
    const subscription = await prisma.modelProvider.findUnique({
      where: { providerId: "chatgpt" },
      select: { baseUrl: true, endpoint: true },
    });
    return subscription?.baseUrl ?? subscription?.endpoint ?? "https://chatgpt.com/backend-api";
  }
  return provider.baseUrl ?? provider.endpoint ?? "";
}
