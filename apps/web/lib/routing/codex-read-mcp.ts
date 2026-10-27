import type { AdapterMcpSession } from "./adapter-types";
import { parseTaskExecutionFence } from "@/lib/shared/task-execution-fence";

const READERS = ["read_source_at_version", "wiki_query", "search_ux_critique_corpus"];
/** Reuse internal transport, never a persistent credential or authority grant.
 * Governed dispatch revalidates the task's original OAuth and current grants. */
export async function codexReadMcpConfig(session: AdapterMcpSession, tools: Array<Record<string, unknown>>, portalUrl: string): Promise<string> {
  const names = session.readOnlyToolNames;
  const attached = tools.map(t => (t.function as {name?: unknown} | undefined)?.name);
  if (typeof session.mintReadOnlySession !== "function" || !session.userId || !session.agentId || !session.taskRunId || !parseTaskExecutionFence(session.taskExecutionFence)
    || !names || names.length !== READERS.length || new Set(names).size !== READERS.length
    || names.some(n => !READERS.includes(n)) || attached.length !== names.length || attached.some(n => typeof n !== "string" || !names.includes(n))) {
    throw new Error("Bound native read transport requires the exact authorized reader surface and task fence.");
  }
  const token = await session.mintReadOnlySession();
  return [
    'cli_auth_credentials_store = "file"', 'approval_policy = "never"', 'sandbox_mode = "read-only"', 'web_search = "disabled"',
    '[features]', 'shell_tool = false', 'multi_agent = false', 'apps = false', 'goals = false', 'hooks = false', 'memories = false', 'skill_mcp_dependency_install = false', '[features.code_mode]', 'enabled = false',
    '[mcp_servers.dpf]', `url = ${JSON.stringify(`${portalUrl.replace(/\/$/, "")}/api/mcp/v1?tier=full`)}`,
    `http_headers = { "X-MCP-Session" = ${JSON.stringify(token)} }`,
    `enabled_tools = ${JSON.stringify(names)}`, 'required = true', 'startup_timeout_sec = 30', 'tool_timeout_sec = 60',
    'default_tools_approval_mode = "approve"',
    ...names.flatMap(name => [`[mcp_servers.dpf.tools.${name}]`, 'output_token_limit = 12000']), '',
  ].join("\n");
}
