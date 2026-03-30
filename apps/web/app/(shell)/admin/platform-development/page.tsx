import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { PlatformDevelopmentForm } from "@/components/admin/PlatformDevelopmentForm";
import { getPlatformDevConfig } from "@/lib/actions/platform-dev-config";

export default async function AdminPlatformDevelopmentPage() {
  const config = await getPlatformDevConfig();

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Admin</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">Platform Development</p>
      </div>
      <AdminTabNav />
      <PlatformDevelopmentForm
        currentMode={(config?.contributionMode as "fork_only" | "selective" | "contribute_all") ?? null}
        configuredAt={config?.configuredAt?.toISOString() ?? null}
        configuredByEmail={config?.configuredBy?.email ?? null}
      />
    </div>
  );
}
