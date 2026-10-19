"use server";

import { prisma } from "@dpf/db";
import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { resolvePrincipalRecordIdForSessionIdentity } from "@/lib/identity/principal-linking";
import { validateLocalePreferences } from "@/lib/i18n/locale-preferences";
import { err, ok, type ActionResult } from "@/lib/shared/action-result";

/**
 * Save the signed-in person's own language and timezone (EP-6B33A840 L0.1).
 * Writes Principal.preferredLanguage / Principal.timeZone on the Principal
 * behind the session, resolved by its relational id (the FK-safe one).
 */
export async function saveLocalePreferences(input: {
  language: string | null;
  timeZone: string | null;
}): Promise<ActionResult> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return err("Sign in to change your language and region.");

  const checked = validateLocalePreferences(input, user.type === "admin");
  if (!checked.ok) return checked;

  const principalId = await resolvePrincipalRecordIdForSessionIdentity({ type: user.type, id: user.id });
  if (!principalId) return err("Your account has no identity record to save this to.");

  await prisma.principal.update({ where: { id: principalId }, data: checked.data });
  revalidatePath("/", "layout");
  return ok();
}

/** The signed-in person's saved preferences, for the settings form. */
export async function getLocalePreferences(): Promise<{
  preferredLanguage: string | null;
  timeZone: string | null;
  viewerIsAdmin: boolean;
}> {
  const session = await auth();
  const user = session?.user;
  const empty = { preferredLanguage: null, timeZone: null, viewerIsAdmin: user?.type === "admin" };
  if (!user?.id) return empty;
  const principalId = await resolvePrincipalRecordIdForSessionIdentity({ type: user.type, id: user.id });
  if (!principalId) return empty;
  const row = await prisma.principal.findUnique({
    where: { id: principalId },
    select: { preferredLanguage: true, timeZone: true },
  });
  return { ...empty, preferredLanguage: row?.preferredLanguage ?? null, timeZone: row?.timeZone ?? null };
}
