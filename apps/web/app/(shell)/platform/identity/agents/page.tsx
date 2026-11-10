import { AgentIdentityPanel } from "@/components/platform/identity/AgentIdentityPanel";
import { auth } from "@/lib/auth";
import { coworkerDataAccessEditor, listCoworkerDataAccessChoices } from "@/lib/identity/coworker-data-access";
import {
  listAgentIdentitySnapshots,
  summarizeAgentIdentitySnapshots,
} from "@/lib/identity/agent-identity-snapshot";

export default async function PlatformIdentityAgentsPage() {
  const agents = await listAgentIdentitySnapshots();
  const session = await auth();
  const editableDataAccess = session?.user?.id ? await coworkerDataAccessEditor(session.user.id) ?? [] : [];
  const dataAccessChoices = editableDataAccess.length && session?.user?.id
    ? await listCoworkerDataAccessChoices(session.user.id) : undefined;

  return (
    <AgentIdentityPanel
      agents={agents}
      summary={summarizeAgentIdentitySnapshots(agents)}
      editableDataAccess={editableDataAccess}
      dataAccessChoices={dataAccessChoices}
    />
  );
}
