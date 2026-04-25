import { prisma } from "@dpf/db";

import {
  bootstrapAuthorityBindings,
  type BootstrapAuthorityBindingsReport,
} from "@/lib/authority/bootstrap-bindings";

export type AuthorityBindingBootstrapState = {
  autoApplied: boolean;
  totalBindings: number | null;
  report: BootstrapAuthorityBindingsReport | null;
};

type GetAuthorityBindingBootstrapStateOptions = {
  canWrite: boolean;
  hasActiveFilters: boolean;
};

export async function getAuthorityBindingBootstrapState({
  canWrite,
  hasActiveFilters,
}: GetAuthorityBindingBootstrapStateOptions): Promise<AuthorityBindingBootstrapState> {
  if (!canWrite || hasActiveFilters) {
    return {
      autoApplied: false,
      report: null,
      totalBindings: null,
    };
  }

  const totalBindings = await prisma.authorityBinding.count();

  if (totalBindings === 0) {
    const report = await bootstrapAuthorityBindings({ writeMode: "commit" });
    return {
      autoApplied: true,
      totalBindings,
      report,
    };
  }

  const report = await bootstrapAuthorityBindings({ writeMode: "dry-run" });
  const shouldShowReport = report.lowConfidence.length > 0 || report.wouldCreate > 0;

  return {
    autoApplied: false,
    totalBindings,
    report: shouldShowReport ? report : null,
  };
}
