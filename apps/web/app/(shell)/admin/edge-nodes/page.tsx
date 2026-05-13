import { redirect } from "next/navigation";

import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { EdgeNodeListPanel } from "@/components/admin/edge-nodes/EdgeNodeListPanel";
import { listEdgeNodes } from "@/lib/actions/edge-node-actions";
import { auth } from "@/lib/auth";
import { can } from "@/lib/permissions";

export default async function AdminEdgeNodesPage() {
  const session = await auth();
  const user = session?.user;
  if (
    !user ||
    !can(
      { platformRole: user.platformRole, isSuperuser: user.isSuperuser },
      "manage_platform",
    )
  ) {
    // The route is under the admin shell; non-managers should never
    // reach it through the nav, but they could deep-link.
    redirect("/admin/platform-development");
  }

  const nodes = await listEdgeNodes();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Admin</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">Edge Nodes</p>
      </div>
      <AdminTabNav />
      <div className="space-y-6">
        <section>
          <h2 className="text-base font-semibold text-[var(--dpf-text)]">
            Edge Nodes
          </h2>
          <p className="mt-1 text-sm text-[var(--dpf-muted)]">
            Host-resident agents enrolled against this Authority Core.
            Issue a bootstrap token to onboard a new node; approve,
            quarantine, or revoke existing nodes from their row.
          </p>
        </section>
        <EdgeNodeListPanel initialNodes={nodes} />
      </div>
    </div>
  );
}
