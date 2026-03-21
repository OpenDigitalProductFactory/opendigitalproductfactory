import { prisma } from "@dpf/db";
import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { PlatformKeysPanel } from "@/components/admin/PlatformKeysPanel";
import { SocialAuthPanel } from "@/components/admin/SocialAuthPanel";

const PLATFORM_KEYS = ["brave_search_api_key", "upload_storage_path"];
const SOCIAL_AUTH_KEYS = [
  "google_client_id",
  "google_client_secret",
  "apple_client_id",
  "apple_client_secret",
  "apple_team_id",
  "apple_key_id",
];

async function getKeyData(keys: string[]): Promise<Record<string, { configured: boolean; currentValue: string | null }>> {
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
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Admin</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">Platform Settings</p>
      </div>
      <AdminTabNav />
      <PlatformKeysPanel keyData={await getKeyData(PLATFORM_KEYS)} />
      <SocialAuthPanel keyData={await getKeyData(SOCIAL_AUTH_KEYS)} />
    </div>
  );
}
