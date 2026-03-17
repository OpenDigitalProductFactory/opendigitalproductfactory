import { getPromotions } from "@/lib/actions/promotions";
import PromotionsClient from "@/components/ops/PromotionsClient";

export default async function PromotionsPage() {
  const promotions = await getPromotions();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-white">Change Promotions</h1>
        <p className="text-sm text-[var(--dpf-muted)] mt-1">
          Review and approve version deployments to production.
        </p>
      </div>
      <PromotionsClient promotions={JSON.parse(JSON.stringify(promotions))} />
    </div>
  );
}
