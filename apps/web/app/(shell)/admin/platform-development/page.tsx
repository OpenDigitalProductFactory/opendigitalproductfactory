import { AdminTabNav } from "@/components/admin/AdminTabNav";
import { ForkSetupPanel } from "@/components/admin/ForkSetupPanel";
import { PlatformDevelopmentForm } from "@/components/admin/PlatformDevelopmentForm";
import {
  getPlatformDevConfig,
  getUntrackedFeatureCount,
  hasContributionToken,
  hasGitBackupCredential,
} from "@/lib/actions/platform-dev-config";
import { isContributionModelEnabled } from "@/lib/flags/contribution-model";
import { getDisplayPseudonym } from "@/lib/integrate/identity-privacy";
import type { PlatformDevPolicyState } from "@/lib/platform-dev-policy";

export default async function AdminPlatformDevelopmentPage() {
  const config = await getPlatformDevConfig();
  const policyState: PlatformDevPolicyState = config?.policyState ?? "policy_pending";
  const untrackedCount = config?.contributionMode === "fork_only"
    ? await getUntrackedFeatureCount()
    : 0;
  const hasCredential = await hasGitBackupCredential();
  const hasContribToken = await hasContributionToken();
  // Pseudonym is only defined once the install has seeded its client identity.
  // Catch: during the first boot the identity may not be ready yet.
  const pseudonym = await getDisplayPseudonym().catch(() => null);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Admin</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-0.5">Platform Development</p>
      </div>
      <AdminTabNav />
      <ForkSetupPanel
        enabled={isContributionModelEnabled()}
        contributionModel={config?.contributionModel ?? null}
        contributorForkOwner={config?.contributorForkOwner ?? null}
        contributorForkRepo={config?.contributorForkRepo ?? null}
        hasContributionToken={hasContribToken}
        machineUserOptIn={config?.machineUserOptIn ?? false}
      />
      <PlatformDevelopmentForm
        policyState={policyState}
        currentMode={(config?.contributionMode as "fork_only" | "selective" | "contribute_all") ?? null}
        configuredAt={config?.configuredAt?.toISOString() ?? null}
        configuredByEmail={config?.configuredBy?.email ?? null}
        gitRemoteUrl={config?.gitRemoteUrl ?? null}
        dcoAcceptedAt={config?.dcoAcceptedAt?.toISOString() ?? null}
        dcoAcceptedByEmail={(config?.dcoAcceptedBy as { email: string } | null)?.email ?? null}
        untrackedFeatureCount={untrackedCount}
        hasGitCredential={hasCredential}
        hasContributionToken={hasContribToken}
        pseudonym={pseudonym}
      />
    </div>
  );
}
