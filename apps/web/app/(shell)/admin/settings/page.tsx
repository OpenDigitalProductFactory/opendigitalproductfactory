import { prisma } from "@dpf/db";
import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { PlatformKeysPanel } from "@/components/admin/PlatformKeysPanel";

async function getPlatformKeyStatuses(): Promise<Record<string, boolean>> {
  const keys = ["brave_search_api_key", "upload_storage_path"];
  const configs = await prisma.platformConfig.findMany({
    where: { key: { in: keys } },
    select: { key: true, value: true },
  });
  const statuses: Record<string, boolean> = {};
  for (const k of keys) {
    const config = configs.find((c) => c.key === k);
    statuses[k] = !!config && typeof config.value === "string" && config.value.length > 0;
  }
  return statuses;
}

export default async function AdminSettingsPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Admin</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">Platform Settings</p>
      </div>
      <AdminTabNav />
      <PlatformKeysPanel keyStatuses={await getPlatformKeyStatuses()} />
    </div>
  );
}
