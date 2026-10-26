// Bounded specialist completion forwards native reader authority, folds audited
// calls once, and holds unverified prose without another inference. These unit
// tests stub inference and the ToolExecution reader; source/corpus validation has
// separate completion coverage. They are not actual coworker participation.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string; taskRunId: string | null; threadId: string | null; toolName: string;
  parameters: Record<string, unknown>; result: Record<string, unknown>;
  success: boolean; executionMode: string; createdAt: Date;
};
const table = vi.hoisted(() => ({ rows: [] as Row[] }));

function matches(value: unknown, condition: unknown): boolean {
  if (condition === undefined) return true;
  if (condition !== null && typeof condition === "object" && !(condition instanceof Date)) {
    const c = condition as Record<string, unknown>;
    if ("in" in c) return (c["in"] as unknown[]).includes(value);
    if ("not" in c) return value !== c["not"];
    const t = value instanceof Date ? value.getTime() : Number.NaN;
    const at = (k: string) => (c[k] instanceof Date ? (c[k] as Date).getTime() : Date.parse(String(c[k])));
    if ("gte" in c && !(t >= at("gte"))) return false;
    if ("gt" in c && !(t > at("gt"))) return false;
    if ("lte" in c && !(t <= at("lte"))) return false;
    if ("lt" in c && !(t < at("lt"))) return false;
    return true;
  }
  return value === condition;
}
function findRows(args?: { where?: Record<string, unknown>; orderBy?: unknown }) {
  const where = args?.where ?? {};
  return table.rows
    .filter((row) => Object.entries(where).every(([key, condition]) => matches((row as Record<string, unknown>)[key], condition)))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

vi.mock("@dpf/db", () => ({ prisma: {
  agentModelConfig: { findUnique: vi.fn() }, user: { findUnique: vi.fn() },
  toolExecution: {
    create: vi.fn(),
    findMany: vi.fn(async (args?: { where?: Record<string, unknown> }) => findRows(args)),
    findFirst: vi.fn(async (args?: { where?: Record<string, unknown> }) => findRows(args).at(-1) ?? null),
  },
  platformIssueReport: { create: vi.fn() },
  coworkerTurnMetric: { upsert: vi.fn() },
} }));
vi.mock("@/lib/routed-inference", () => ({ routeAndCall: vi.fn() }));
vi.mock("@/lib/mcp-tools", () => ({ PLATFORM_TOOLS: [], toolsToOpenAIFormat: vi.fn(() => []), executeTool: vi.fn() }));
vi.mock("@/lib/mcp-governed-execute", () => ({ governedExecuteTool: vi.fn() }));
vi.mock("@/lib/observability/heartbeat", () => ({
  heartbeat: vi.fn(async () => true),
  withHeartbeatTicker: vi.fn(async (_taskRunId: string, fn: () => Promise<unknown>) => fn()),
}));
vi.mock("./terminal-tool-policy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./terminal-tool-policy")>();
  return { ...actual, resolveTerminalTextExit: vi.fn(actual.resolveTerminalTextExit) };
});

import { prisma } from "@dpf/db";
import { routeAndCall } from "@/lib/routed-inference";
import { governedExecuteTool } from "@/lib/mcp-governed-execute";
import { runAgenticLoop } from "./agentic-loop";

const TASK_RUN_ID = "TR-MCP-NATIVE-6C272F7C1DAE";
const THREAD_ID = "thread-native-review";
const writer = "record_initiative_design_review";
const reader = "read_source_at_version";

// What the CLI adapter returns today for a native-MCP turn: the narration only.
const cliProse = (content: string) => ({
  content, truncated: false, toolCalls: [], inputTokens: 1200, outputTokens: 300,
  providerId: "anthropic-sub", modelId: "claude-opus-4-6", downgraded: false,
  downgradeMessage: null, downgradeReason: null, toolsStripped: false, routeDecision: {},
});

let seq = 0;
function nativeRow(toolName: string, result: Record<string, unknown>, success: boolean, patch: Partial<Row> = {}): Row {
  seq += 1;
  return {
    id: `te-${seq}`, taskRunId: TASK_RUN_ID, threadId: THREAD_ID, toolName,
    parameters: toolName === reader
      ? { repositoryFullName: "OpenDigitalProductFactory/opendigitalproductfactory", path: "docs/spec.md", version: "a".repeat(40), expectedBlobId: "b".repeat(40) }
      : { itemId: "BI-C8EC05C9", gate: "design-spec", decision: "pass" },
    // Live reader rows are auditClass=metrics_only and persist result {}.
    result, success, executionMode: "internal-mcp-session", createdAt: new Date(), ...patch,
  };
}
const nativeRead = (patch: Partial<Row> = {}) => nativeRow(reader, {}, true, patch);

const params = {
  chatHistory: [{ role: "user" as const, content: "Review the bound design and record the governed assessment." }],
  systemPrompt: "Read the immutable evidence, then record your independent assessment.",
  sensitivity: "internal" as const,
  tools: [reader, writer].map((name) => ({ name, description: name, inputSchema: {},
    requiredCapability: null, executionMode: "immediate" as const, sideEffect: name === writer })),
  toolsForProvider: [reader, writer].map((name) => ({ type: "function", function: { name, parameters: {} } })),
  userId: "user-1", agentId: "AGT-WS-REVIEW", threadId: THREAD_ID, routeContext: "/platform/build",
  taskType: "external-mcp", interactionMode: "autonomous" as const, taskRunId: TASK_RUN_ID,
  terminalToolPolicy: { writerToolName: writer, readerToolNames: [reader],
    minimumSuccessfulReaderCalls: 1, maximumReaderCalls: 6 },
};

beforeEach(() => {
  vi.clearAllMocks();
  table.rows = [];
  seq = 0;
  vi.mocked(prisma.agentModelConfig.findUnique).mockResolvedValue(null as never);
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ isSuperuser: false,
    groups: [{ platformRole: { roleId: "developer" } }] } as never);
  vi.mocked(governedExecuteTool).mockResolvedValue({ success: true, message: "unexpected loop-side dispatch" });
});

import {withReadEvidencePolicy} from "./read-evidence-policy";
const names=["read_source_at_version","wiki_query","search_ux_critique_corpus"];
const contribution=JSON.stringify({summary:"Actual specialist result",criteria:["Hierarchy"],corpusRefs:["professions/ux-design/hierarchy"],findings:[]});
const readParams={...params,terminalToolPolicy:undefined,agentId:"ux-design-critic",routeContext:"/area/platform",
 tools:names.map(name=>({name,description:name,inputSchema:{},requiredCapability:null,executionMode:"immediate" as const,sideEffect:false})),
 toolsForProvider:names.map(name=>({type:"function",function:{name,parameters:{}}})),
 taskExecutionFence:{schemaVersion:1 as const,reservation:"reserved",dispatchClaim:"claim",authorityDigest:null,requestDigest:"a".repeat(64)}};
describe("read-only native specialist completion",()=>{
 it("folds actual native reader rows once before completion without dispatching them again",async()=>{
  const inspect=vi.fn(async()=>({complete:true,message:"verified full artifact/corpus provenance"}));
  const mintReadOnlySession=vi.fn(async()=>"execution-bound-test-session");
  const recordImageInputDelivery=vi.fn(async()=>{});
  vi.mocked(routeAndCall).mockImplementation(async(messages,system,_sensitivity,options)=>{
   expect(options?.mcpSession?.mintReadOnlySession).toBe(mintReadOnlySession);
   expect(options?.mcpSession?.recordImageInputDelivery).toBe(recordImageInputDelivery);
   const {codexReadMcpConfig}=await import("../routing/codex-read-mcp");
   const config=await codexReadMcpConfig(options!.mcpSession!,readParams.toolsForProvider,"http://portal:3000");
   expect(config).toContain("execution-bound-test-session");
   expect(JSON.stringify({messages,system})).not.toContain("execution-bound-test-session");
   table.rows.push(...names.map(name=>nativeRow(name,{},true)));return {...cliProse(contribution),providerId:"codex",modelId:"gpt-5.6-luna"} as never;
  });
  const result=await withReadEvidencePolicy({toolNames:names,inspect,mintReadOnlySession,recordImageInputDelivery},()=>runAgenticLoop(readParams));
  expect(mintReadOnlySession).toHaveBeenCalledExactlyOnceWith();
  expect(result.content).toBe(contribution);expect(result.executedTools.map(t=>t.name)).toEqual(names);
  expect(result.executedTools.map(t=>(t as typeof t & {nativeExecutionId?:string}).nativeExecutionId)).toEqual(table.rows.map(t=>t.id));
  expect(governedExecuteTool).not.toHaveBeenCalled();expect(routeAndCall).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(vi.mocked(routeAndCall).mock.calls[0])).toContain('readOnlyToolNames');
 });
 it("rejects prose and metrics-only rows until real immutable provenance is complete",async()=>{
  const inspect=vi.fn(async()=>({complete:false,message:"missing guidance pages and calibrated corpus read"}));
  vi.mocked(routeAndCall).mockImplementation(async()=>{if(!table.rows.length)table.rows.push(nativeRead());return {...cliProse("I have reviewed everything and it looks sound."),providerId:"codex"} as never;});
  const result=await withReadEvidencePolicy({toolNames:names,inspect},()=>runAgenticLoop(readParams));
  expect(routeAndCall).toHaveBeenCalledTimes(1);expect(result.failure?.kind).toBe("policy-or-capability");
  expect(result.content).toContain("missing guidance pages");expect(result.content).not.toContain("looks sound");
  expect(result.executedTools).toHaveLength(1);expect(governedExecuteTool).not.toHaveBeenCalled();
 });
 it("does not leak the bounded policy into the next unrelated execution",async()=>{
  const inspect=vi.fn(async()=>({complete:true,message:"verified"}));
  vi.mocked(routeAndCall).mockResolvedValue({...cliProse(contribution),providerId:"codex"} as never);
  await withReadEvidencePolicy({toolNames:names,inspect},()=>runAgenticLoop(readParams));
  vi.mocked(routeAndCall).mockClear();await runAgenticLoop(readParams);
  expect(JSON.stringify(vi.mocked(routeAndCall).mock.calls[0])).not.toContain('readOnlyToolNames');
 });
 it("preserves the complete original specialist packet on its first provider dispatch",async()=>{
  const original="Fulfill original immutable engagement. "+"scope ".repeat(1500)+"ORIGINAL_SCOPE_END";
  vi.mocked(routeAndCall).mockResolvedValue({...cliProse(contribution),providerId:"codex"} as never);
  await withReadEvidencePolicy({toolNames:names,inspect:async()=>({complete:true,message:"verified"})},()=>runAgenticLoop({...readParams,chatHistory:[{role:"user",content:original}]}));
  expect(vi.mocked(routeAndCall).mock.calls[0]![0].some(m=>m.content===original)).toBe(true);
 });

});

it("keeps actual supplied image blocks in the original specialist dispatch",async()=>{
 const images=[{type:"text" as const,text:"Original scope"},{type:"image_url" as const,image_url:{url:"data:image/png;base64,provided"}}];
 vi.mocked(routeAndCall).mockResolvedValue({...cliProse(contribution),providerId:"codex"} as never);
 await withReadEvidencePolicy({toolNames:names,inspect:async()=>({complete:true,message:"verified"})},()=>runAgenticLoop({...readParams,chatHistory:[{role:"user",content:images}]}));
 expect(vi.mocked(routeAndCall).mock.calls[0][0].some(m=>Array.isArray(m.content)&&m.content.some(b=>b.type==="image_url"&&b.image_url.url==="data:image/png;base64,provided"))).toBe(true);
});
