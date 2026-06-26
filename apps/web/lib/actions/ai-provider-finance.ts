"use server";

import { revalidatePath } from "next/cache";
import { requireCapability } from "@/lib/actions/shared/guards";
import {
  activateAiProviderContract,
  getAiProviderFinanceDetail,
  getAiSpendOverview,
  getAiSupplierFinanceDetail,
  recordAiProviderSubscriptionPayment,
  seedAiProviderFinanceBridge,
} from "@/lib/finance/ai-provider-finance";
import type {
  ActivateAiProviderContractInput,
  RecordAiProviderSubscriptionPaymentInput,
  SeedAiProviderFinanceBridgeInput,
} from "@/lib/finance/ai-provider-finance-validation";

async function requireManageFinance(): Promise<void> {
  await requireCapability("manage_finance");
}

export async function seedAiProviderFinanceBridgeAction(input: SeedAiProviderFinanceBridgeInput) {
  await requireManageFinance();
  return seedAiProviderFinanceBridge(input);
}

export async function activateAiProviderContractAction(input: ActivateAiProviderContractInput) {
  await requireManageFinance();
  return activateAiProviderContract(input);
}

export async function recordAiProviderSubscriptionPaymentAction(input: RecordAiProviderSubscriptionPaymentInput) {
  await requireManageFinance();
  const result = await recordAiProviderSubscriptionPayment(input);
  revalidatePath("/finance/spend/ai");
  revalidatePath("/finance/bills");
  revalidatePath("/finance/payments");
  revalidatePath("/platform/ai/providers");
  return result;
}

export async function loadAiSpendOverviewAction() {
  await requireManageFinance();
  return getAiSpendOverview();
}

export async function loadAiProviderFinanceDetailAction(providerId: string) {
  await requireManageFinance();
  return getAiProviderFinanceDetail(providerId);
}

export async function loadAiSupplierFinanceDetailAction(supplierId: string) {
  await requireManageFinance();
  return getAiSupplierFinanceDetail(supplierId);
}
