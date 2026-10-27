"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { changeManagedDocumentState } from "@/lib/documents/document-store";
import { syncUserPrincipal } from "@/lib/identity/principal-linking";
import { resolveDocumentViewer } from "@/lib/documents/document-access";
import { createCollection } from "@/lib/documents/document-collections";

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
    viewer: await resolveDocumentViewer(session.user.id),
  });

  revalidatePath("/workspace/documents");
  revalidatePath(`/workspace/documents/${encodeURIComponent(documentId)}`);
}

/** Create a collection (BI-957915CB) and open it. */
export async function createCollectionAction(formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;
  const principal = await syncUserPrincipal(session.user.id).catch(() => null);
  const viewer = principal ? { principalId: principal.id } : await resolveDocumentViewer(session.user.id);
  const collection = await createCollection({
    title,
    accessScope: formData.get("restricted") ? "restricted" : "organization",
    viewer,
    actorPrincipalId: principal?.id ?? null,
  });

  revalidatePath("/workspace/documents");
  redirect(`/workspace/documents?collection=${encodeURIComponent(collection.documentId)}`);
}
