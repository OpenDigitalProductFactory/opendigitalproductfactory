"use client";

import { useRouter } from "next/navigation";
import { FinancialSetupStep } from "@/components/storefront-admin/FinancialSetupStep";

type Props = {
  archetypeSlug: string;
  archetypeName: string;
  suggestedCurrency?: string | null;
};

export function FinanceSetupClient({ archetypeSlug, archetypeName, suggestedCurrency }: Props) {
  const router = useRouter();

  return (
    <FinancialSetupStep
      archetypeSlug={archetypeSlug}
      archetypeName={archetypeName}
      suggestedCurrency={suggestedCurrency ?? null}
      onComplete={() => {
        router.push("/finance/settings");
        router.refresh();
      }}
    />
  );
}
