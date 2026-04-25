import { prisma } from "@dpf/db";
import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { PlatformKeysPanel } from "@/components/admin/PlatformKeysPanel";
import { SocialAuthPanel } from "@/components/admin/SocialAuthPanel";

const PLATFORM_KEYS = ["upload_storage_path"];
const ADMIN_PLATFORM_KEY_CONFIGS = [
  {
    key: "upload_storage_path",
    label: "File Upload Storage Path",
    description: "Directory for uploaded files. Use an absolute path in production (e.g., D:/dpf-uploads).",
    placeholder: "./data/uploads",
    isSecret: false,
  },
];
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
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">Organization &amp; Core Configuration</p>
      </div>
      <AdminTabNav />
      <PlatformKeysPanel
        keyData={await getKeyData(PLATFORM_KEYS)}
        title="Core Configuration"
        description="Install-wide settings that belong to the organization and platform rather than AI runtime tools."
        configs={ADMIN_PLATFORM_KEY_CONFIGS}
      />
      <SocialAuthPanel keyData={await getKeyData(SOCIAL_AUTH_KEYS)} />
    </div>
  );
}
