"use server";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  disconnectLinkedInIntegration,
  startLinkedInOAuth,
} from "@/lib/marketing/channels/linkedin-personal-social/oauth";
import { revalidatePath } from "next/cache";

const PAGE_PATH = "/platform/tools/integrations/linkedin-personal-social";

async function requireProviderAdmin(): Promise<{ userId: string } | { error: string }> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return { error: "Unauthorized" };
  const ctx = { platformRole: user.platformRole ?? null, isSuperuser: user.isSuperuser ?? false };
  if (!can(ctx, "manage_provider_connections")) {
    return { error: "Insufficient capability: manage_provider_connections" };
  }
  return { userId: user.id };
}

export async function startLinkedInOAuthAction(form: FormData): Promise<
  | { ok: true; authorizeUrl: string }
  | { ok: false; error: string }
> {
  const guard = await requireProviderAdmin();
  if ("error" in guard) return { ok: false, error: guard.error };

  const clientId = String(form.get("clientId") ?? "").trim();
  const clientSecret = String(form.get("clientSecret") ?? "").trim();
  const redirectUri = String(form.get("redirectUri") ?? "").trim();

  const result = await startLinkedInOAuth({ clientId, clientSecret, redirectUri });
  if (!result.ok) return { ok: false, error: result.error };

  revalidatePath(PAGE_PATH);
  return { ok: true, authorizeUrl: result.authorizeUrl };
}

export async function disconnectLinkedInAction(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const guard = await requireProviderAdmin();
  if ("error" in guard) return { ok: false, error: guard.error };
  await disconnectLinkedInIntegration();
  revalidatePath(PAGE_PATH);
  return { ok: true };
}
