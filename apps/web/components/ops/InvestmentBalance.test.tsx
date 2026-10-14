import { DEFAULT_LOCALE, namespaceMessages } from "@dpf/i18n";
import { MessagesProvider } from "@/components/i18n/MessagesProvider";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/portfolio-budget", () => ({ saveInvestmentBalanceAction: vi.fn(), bindInstallationInvestmentAction: vi.fn() }));
import { InvestmentBalance } from "./InvestmentBalance";
import { defaultBalancePolicy, evaluateInvestmentBalance } from "@/lib/portfolio/investment-balance";
import type { OwnerInvestmentView } from "@/lib/portfolio/investment-balance-server";

const renderBalance = (element: React.ReactNode) => renderToStaticMarkup(<MessagesProvider locale={DEFAULT_LOCALE} messages={{ portfolio: namespaceMessages(DEFAULT_LOCALE, "portfolio") }}>{element}</MessagesProvider>);

describe("investment allocation presentation", () => {
  it("shows defaults and unknown coverage without inventing observed spending", () => {
    const policy = defaultBalancePolicy("founder", "shared-platform");
    const scope = { principalId: "p1", organizationId: "org1", purpose: "shared-platform" as const };
    const view: OwnerInvestmentView = { scope, organizationName: "Operator organization", report: { ok: true, data: {
      scope, ownerKind: "founder", source: "default", revision: null, policy, guidance: "", installationBinding: null,
      policyActive: true, canSucceedBinding: false, attributionGap: { level: "installation", unassignedAttempts: 7 }, externalInferenceCoverage: "unobserved", observation: evaluateInvestmentBalance(policy, { knownAttempts: 0, unknownAttempts: 3, refactorTokens: 0, newTokens: 0, unclassifiedTokens: 0, latestAt: null }),
    } } };
    const html = renderBalance(<InvestmentBalance views={[view]} canManage />);
    expect(html).toContain("80% repair / 20% new");
    expect(html).toContain("Not measured yet");
    expect(html).toContain("3 attempts with unknown usage");
    expect(html).toContain("External agent spending is unobserved");
    expect(html).toContain("7 unassigned attempts");
    expect(html).not.toContain("p1");
  });
  it("does not render write controls without capability", () => {
    const html = renderBalance(<InvestmentBalance views={[]} canManage={false} />);
    expect(html).not.toContain("<button");
    expect(html).toContain("No funding scope is assigned to you");
  });
  it("keeps pagination as accessible navigation within the funding editor", () => {
    const html = renderBalance(<InvestmentBalance views={[]} canManage={false} nextHref="/ops/demand?investment=1&amp;investmentAfter=org-15#investment-balance" firstHref="/ops/demand?investment=1#investment-balance" />);
    expect(html).toContain('aria-label="Funding organizations"');
    expect(html).toContain("More organizations");
    expect(html).toContain("First organizations");
    expect(html).not.toContain("<button");
  });
});
