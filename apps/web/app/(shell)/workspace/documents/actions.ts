"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { changeManagedDocumentState } from "@/lib/documents/document-store";
import { syncUserPrincipal } from "@/lib/identity/principal-linking";

export async function changeDocumentStateAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const documentId = String(formData.get("documentId") ?? "");
  const toState = String(formData.get("toState") ?? "");
  const reason = String(formData.get("reason") ?? "");
  const principal = await syncUserPrincipal(session.user.id).catch(() => null);

  await changeManagedDocumentState({
    documentId,
    toState,
    reason,
    actorPrincipalId: principal?.id ?? null,
  });

  revalidatePath("/workspace/documents");
  revalidatePath(`/workspace/documents/${encodeURIComponent(documentId)}`);
}
