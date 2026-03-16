import { prisma } from "@dpf/db";
import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { PlatformKeysPanel } from "@/components/admin/PlatformKeysPanel";

async function getPlatformKeyData(): Promise<Record<string, { configured: boolean; currentValue: string | null }>> {
  const keys = ["brave_search_api_key", "upload_storage_path"];
  const configs = await prisma.platformConfig.findMany({
    where: { key: { in: keys } },
    select: { key: true, value: true },
  });
  const data: Record<string, { configured: boolean; currentValue: string | null }> = {};
  for (const k of keys) {
    const config = configs.find((c) => c.key === k);
    const val = config && typeof config.value === "string" && config.value.length > 0 ? config.value : null;
    data[k] = { configured: !!val, currentValue: val };
  }
  return data;
}

export default async function AdminSettingsPage() {
  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-white">Admin</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">Platform Settings</p>
      </div>
      <AdminTabNav />
      <PlatformKeysPanel keyData={await getPlatformKeyData()} />
    </div>
  );
}
