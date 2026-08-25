// apps/web/app/(shell)/ops/installation/page.tsx
//
// BI-7626A660 — the full installation identity, moved off the workspace home.
//
// The workspace home used to open with this panel for anyone who could manage
// the platform, costing roughly the top third of the first viewport before the
// operator reached any work. The arrival-time signal is now the header badge,
// which is a few words and renders only on a non-production installation. The
// detail — what the installation is, what its coworkers may do here, and how to
// correct it — lives here, one click from that badge.
//
// Accepted debt, recorded at the founder's direction: /ops has accumulated
// enough routes that navigation needs its own pass. This adds one more rather
// than blocking on that refactor.

import { redirect } from "next/navigation";

import { prisma } from "@dpf/db";

import { InstallationIdentityPanel } from "@/components/workspace/InstallationIdentityPanel";
import { auth } from "@/lib/auth";
import { prismaInstanceStanceStore } from "@/lib/install/instance-stance";
import { loadInstallationIdentityView } from "@/lib/installation-journey/installation-identity-view";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function InstallationIdentityPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  // Same capability that previously gated the panel on the workspace home. The
  // move changes where the panel lives, never who may see it.
  const canManageInstallation = can(
    { platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser },
    "manage_platform",
  );
  if (!canManageInstallation) redirect("/workspace");

  const view = await loadInstallationIdentityView(prisma, prismaInstanceStanceStore(prisma));

  return (
    <div className="mx-auto w-full max-w-4xl">
      <InstallationIdentityPanel view={view} />
    </div>
  );
}
