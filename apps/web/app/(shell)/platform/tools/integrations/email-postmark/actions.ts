"use server";

import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import {
  disconnectEmailPostmark,
  saveEmailPostmarkCredential,
} from "@/lib/marketing/channels/email-postmark/config";
import { revalidatePath } from "next/cache";

const PAGE_PATH = "/platform/tools/integrations/email-postmark";

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

export async function saveEmailPostmarkAction(form: FormData): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const guard = await requireProviderAdmin();
  if ("error" in guard) return { ok: false, error: guard.error };
  const result = await saveEmailPostmarkCredential({
    serverToken: String(form.get("serverToken") ?? "").trim(),
    signingSecret: String(form.get("signingSecret") ?? "").trim(),
    fromAddress: String(form.get("fromAddress") ?? "").trim(),
    replyToAddress: (String(form.get("replyToAddress") ?? "").trim() || undefined) as string | undefined,
  });
  if (!result.ok) return result;
  revalidatePath(PAGE_PATH);
  return { ok: true };
}

export async function disconnectEmailPostmarkAction(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const guard = await requireProviderAdmin();
  if ("error" in guard) return { ok: false, error: guard.error };
  await disconnectEmailPostmark();
  revalidatePath(PAGE_PATH);
  return { ok: true };
}
