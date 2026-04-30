import { AgentIdentityPanel } from "@/components/platform/identity/AgentIdentityPanel";
import {
  listAgentIdentitySnapshots,
  summarizeAgentIdentitySnapshots,
} from "@/lib/identity/agent-identity-snapshot";

export default async function PlatformIdentityAgentsPage() {
  const agents = await listAgentIdentitySnapshots();

  return (
    <AgentIdentityPanel
      agents={agents}
      summary={summarizeAgentIdentitySnapshots(agents)}
    />
  );
}
