import type { PrincipalContext } from "./governance-types";

type SessionUser = {
  id: string;
  email: string;
  platformRole: string | null;
  isSuperuser: boolean;
};

export function buildPrincipalContext(input: {
  sessionUser: SessionUser;
  teamIds: string[];
  actingAgentId: string | null;
  delegationGrantIds: string[];
}): PrincipalContext {
  return {
    authenticatedSubject: { kind: "user", userId: input.sessionUser.id },
    actingHuman: { kind: "user", userId: input.sessionUser.id },
    ...(input.actingAgentId ? { actingAgent: { agentId: input.actingAgentId } } : {}),
    teamIds: input.teamIds,
    platformRoleIds: input.sessionUser.platformRole ? [input.sessionUser.platformRole] : [],
    effectiveCapabilities: [],
    delegationGrantIds: input.delegationGrantIds,
  };
}
