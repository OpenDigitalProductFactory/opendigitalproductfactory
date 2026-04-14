// apps/web/app/(shell)/ea/views/[id]/page.tsx
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";
import { getEaView } from "@/lib/ea-data";
import { prisma } from "@dpf/db";
import { EaCanvas } from "@/components/ea/EaCanvas";

export default async function EaViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth();
  const user = session?.user;

  // View the page if user can view EA — write actions are gated at action level
  if (!user || !can({ platformRole: user.platformRole, isSuperuser: user.isSuperuser }, "view_ea_modeler")) {
    notFound();
  }

  const view = await getEaView(id);
  if (!view) notFound();

  const isReadOnly = !can(
    { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
    "manage_ea_model"
  );

  // Fetch all element types for this view's notation.
  // Use view.notationId (returned by getEaView) to scope correctly — do NOT use findFirst.
  const allElementTypes = await prisma.eaElementType.findMany({
    where: { notationId: view.notationId },
    select: { id: true, slug: true, name: true, neoLabel: true },
    orderBy: { name: "asc" },
  });

  return (
    <div style={{ height: "calc(100vh - 56px)", display: "flex", flexDirection: "column" }}>
      <EaCanvas
        viewId={view.id}
        viewName={view.name}
        viewStatus={view.status}
        notationSlug={view.notationSlug}
        viewpoint={view.viewpoint ?? null}
        allElementTypes={allElementTypes}
        initialElements={view.elements}
        initialEdges={view.edges}
        initialCanvasState={view.canvasState}
        isReadOnly={isReadOnly}
      />
    </div>
  );
}
