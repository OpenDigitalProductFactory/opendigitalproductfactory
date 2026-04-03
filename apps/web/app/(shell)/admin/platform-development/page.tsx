import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { PlatformDevelopmentForm } from "@/components/admin/PlatformDevelopmentForm";
import { getPlatformDevConfig, getUntrackedFeatureCount, hasGitBackupCredential } from "@/lib/actions/platform-dev-config";

export default async function AdminPlatformDevelopmentPage() {
  const config = await getPlatformDevConfig();
  const untrackedCount = config?.contributionMode === "fork_only"
    ? await getUntrackedFeatureCount()
    : 0;
  const hasCredential = await hasGitBackupCredential();

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
        gitRemoteUrl={config?.gitRemoteUrl ?? null}
        dcoAcceptedAt={config?.dcoAcceptedAt?.toISOString() ?? null}
        dcoAcceptedByEmail={(config?.dcoAcceptedBy as { email: string } | null)?.email ?? null}
        untrackedFeatureCount={untrackedCount}
        hasGitCredential={hasCredential}
      />
    </div>
  );
}
