import type { CoworkerAuthorityInput } from "@/lib/govern/authority/coworker-authority-decision";

export function coworkerAuthorityInputFixture(
  overrides: Partial<CoworkerAuthorityInput> = {},
): CoworkerAuthorityInput {
  return {
    authContext: {
      principalId: "PRN-1",
      principalAliases: [],
      population: "workforce",
      platformRole: "HR-000",
      isSuperuser: true,
      employeeId: "EMP-1",
      managerScope: { directReportIds: [], indirectReportIds: [] },
      teamIds: [],
      accountScope: {
        accountIds: [],
        contactIds: [],
        partnerAccountIds: [],
      },
      sensitivityClearance: [
        "public",
        "internal",
        "confidential",
        "restricted",
      ],
      authentication: {
        source: "session",
        methods: ["mfa"],
        contextClassReference: null,
      },
      actingHumanUserId: "user-1",
      actingAgentId: "AGT-100",
      delegationGrantIds: [],
      grantedCapabilities: ["view_platform", "view_backlog", "manage_backlog"],
    },
    action: {
      toolName: "query_backlog",
      requiredCapability: "view_platform",
      agentGrantAllowed: true,
      sideEffect: false,
      executionMode: "immediate",
      routeContext: "/ops",
      approvalPolicy: "none",
    },
    subject: { kind: "platform", id: "dpf" },
    delegation: null,
    integration: { required: false, state: "not-required" },
    dataPolicy: {
      sensitivity: "internal",
      maskingRequired: false,
      maskingSatisfied: true,
      decisionVersionsCurrent: true,
    },
    task: null,
    rawParams: {},
    ...overrides,
  };
}
