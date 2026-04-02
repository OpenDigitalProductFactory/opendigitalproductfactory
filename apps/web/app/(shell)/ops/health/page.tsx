// apps/web/app/(shell)/ops/health/page.tsx
//
// Redirect: System Health has moved to the portal product's Health tab.
// The portal is a digital product under Foundational/Platform Services.

import { redirect } from "next/navigation";
import { prisma } from "@dpf/db";

export default async function SystemHealthRedirect() {
  const portal = await prisma.digitalProduct.findUnique({
    where: { productId: "dpf-portal" },
    select: { id: true },
  });

  if (portal) {
    redirect(`/portfolio/product/${portal.id}/health`);
  }

  // Fallback if portal product hasn't been seeded yet
  redirect("/portfolio");
}
