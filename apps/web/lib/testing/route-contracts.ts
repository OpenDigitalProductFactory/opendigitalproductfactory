export type RouteContractFamily =
  | "build-studio"
  | "ops-backlog"
  | "discovery"
  | "storefront"
  | "marketing"
  | "platform-ai"
  | "finance-tax";

export type RouteContract = {
  family: RouteContractFamily;
  route: string;
  expectedAgentId: string;
  expectedLabel: string;
  requiredDomainTools: string[];
  qaIds: string[];
};

export const ROUTE_CONTRACTS: RouteContract[] = [
  {
    family: "build-studio",
    route: "/build",
    expectedAgentId: "build-specialist",
    expectedLabel: "Software Engineer",
    requiredDomainTools: ["saveBuildEvidence", "run_ux_test", "report_quality_issue"],
    qaIds: ["BUILD-20", "BUILD-41", "BUILD-43"],
  },
  {
    family: "ops-backlog",
    route: "/ops",
    expectedAgentId: "ops-coordinator",
    expectedLabel: "Scrum Master",
    requiredDomainTools: ["create_backlog_item", "query_backlog", "update_backlog_item"],
    qaIds: ["OPS-01", "OPS-05", "AUTH-GOV-11"],
  },
  {
    family: "discovery",
    route: "/platform/tools/discovery",
    expectedAgentId: "inventory-specialist",
    expectedLabel: "Digital Product Estate Specialist",
    requiredDomainTools: [],
    qaIds: ["INV-08", "AI-15"],
  },
  {
    family: "storefront",
    route: "/storefront",
    expectedAgentId: "storefront-advisor",
    expectedLabel: "Storefront Operations Manager",
    requiredDomainTools: [],
    qaIds: ["STORE-01"],
  },
  {
    family: "marketing",
    route: "/customer/marketing",
    expectedAgentId: "marketing-specialist",
    expectedLabel: "Marketing Strategist",
    requiredDomainTools: ["save_marketing_review", "create_backlog_item"],
    qaIds: [],
  },
  {
    family: "platform-ai",
    route: "/platform/ai/authority",
    expectedAgentId: "platform-engineer",
    expectedLabel: "AI Ops Engineer",
    requiredDomainTools: ["evaluate_tool"],
    qaIds: ["AUTH-GOV-11"],
  },
  {
    family: "finance-tax",
    route: "/finance/settings/tax",
    expectedAgentId: "finance-agent",
    expectedLabel: "Finance Specialist",
    requiredDomainTools: [],
    qaIds: ["FIN-09", "FIN-12"],
  },
];
