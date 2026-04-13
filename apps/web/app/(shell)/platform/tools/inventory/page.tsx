// apps/web/app/(shell)/platform/tools/inventory/page.tsx
// Capability Inventory — Phase 2 admin view.
// Shows all platform capabilities: internal tools, MCP server tools, and model providers.

import { getCapabilityInventory } from "@/lib/actions/capability-inventory";
import { CapabilityInventoryClient } from "@/components/platform/CapabilityInventoryClient";

export const dynamic = "force-dynamic";

export default async function CapabilityInventoryPage() {
  const capabilities = await getCapabilityInventory();

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Capability Inventory</h1>
        <p className="text-muted-foreground text-sm mt-1">
          {capabilities.length} capabilities registered · platform tools, MCP servers, and AI providers
        </p>
      </div>

      {capabilities.length === 0 ? (
        <div className="py-16 text-center border border-dashed rounded-lg border-[var(--dpf-border)]">
          <p className="text-muted-foreground text-sm">
            Sync capabilities first — run portal-init or trigger a redeploy.
          </p>
        </div>
      ) : (
        <CapabilityInventoryClient capabilities={capabilities} />
      )}
    </div>
  );
}
