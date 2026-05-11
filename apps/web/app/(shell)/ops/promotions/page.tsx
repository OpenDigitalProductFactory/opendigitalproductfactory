import { createPromotionReviewFromGitCandidateForm, getGitPromotionCandidates, getPromotions } from "@/lib/actions/promotions";
import PromotionsClient from "@/components/ops/PromotionsClient";
import { GitPromotionCandidatesPanel } from "@/components/ops/GitPromotionCandidatesPanel";
import { OpsTabNav } from "@/components/ops/OpsTabNav";

export default async function PromotionsPage() {
  const [promotions, gitCandidates] = await Promise.all([
    getPromotions(),
    getGitPromotionCandidates(),
  ]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-[var(--dpf-text)]">Change Promotions</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-1">
          Review and approve version deployments to production.
        </p>
      </div>
      <OpsTabNav />
      <GitPromotionCandidatesPanel
        candidates={JSON.parse(JSON.stringify(gitCandidates))}
        createReviewAction={createPromotionReviewFromGitCandidateForm}
      />
      <PromotionsClient promotions={JSON.parse(JSON.stringify(promotions))} />
    </div>
  );
}
