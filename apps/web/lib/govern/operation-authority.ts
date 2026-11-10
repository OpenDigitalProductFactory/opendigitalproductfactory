import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import { can } from "./permissions";
import { currentUserContext } from "./current-user-context";

/** Reuse the operation catalog's human policy across portal and MCP entrypoints. */
export async function currentOperationAuthority(userId: string, toolName: string) {
  const tool = PLATFORM_TOOLS.find((candidate) => candidate.name === toolName);
  if (!tool) return null;
  const user = await currentUserContext(userId);
  if (!user || (tool.requiredCapability && !can(user, tool.requiredCapability))) return null;
  return user;
}
