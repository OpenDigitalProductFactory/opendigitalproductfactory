import { expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  findModelConfig: vi.fn(),
  findTaskRun: vi.fn(),
  updateTaskRun: vi.fn(),
}));
const autonomous = vi.hoisted(() => ({
  execute: vi.fn(),
  resolveAgent: vi.fn(),
  resolveTools: vi.fn(),
}));
const pirContext = vi.hoisted(() => vi.fn(async () => ""));
const sensitivity = vi.hoisted(() => vi.fn(async (_parsed: unknown, _token: unknown, fallback: string) => fallback));
vi.mock("./mcp-task-review-sensitivity", () => ({ remoteReviewSensitivity: sensitivity }));
vi.mock("./pir-evidence-context", () => ({ loadPirEvidenceContext: pirContext }));
vi.mock("./mcp-task-review-outcome", async (importOriginal) => ({
  ...await importOriginal<typeof import("./mcp-task-review-outcome")>(),
  // BI-2E479619: the executor consults the TaskRun's persisted receipt before classifying a missing writer.
  loadTaskInitiativeReviewOutcome: vi.fn(async () => null),
  loadInitiativeReviewOutcome: vi.fn(async (_binding: unknown, receiptId: string) => ({
    receiptId, summary: `Receipt ${receiptId} persisted. Implementation readiness: input-required; plan coverage remains missing.`,
  })),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    agentModelConfig: { findUnique: (...args: unknown[]) => db.findModelConfig(...args) },
    taskRun: {
      findUnique: (...args: unknown[]) => db.findTaskRun(...args),
      update: (...args: unknown[]) => db.updateTaskRun(...args),
      updateMany: (...args: unknown[]) => db.updateTaskRun(...args),
    },
  },
}));
vi.mock("@/lib/tak/autonomous-work-run", () => ({
  executeAutonomousAgenticLoop: (...args: unknown[]) => autonomous.execute(...args),
  resolveAutonomousWorkAgent: (...args: unknown[]) => autonomous.resolveAgent(...args),
  resolveAutonomousWorkTools: (...args: unknown[]) => autonomous.resolveTools(...args),
}));
vi.mock("@/lib/tak/task-records", () => ({ createTaskMessage: vi.fn() }));
vi.mock("./mcp/external-approval-location-lookup", () => ({
  withTaskRunApprovalLocation: vi.fn(async (value: unknown) => value),
}));

import { executeRemoteTaskAttempt } from "./mcp-task-execution";

const readInspection=vi.hoisted(()=>vi.fn(async()=>({complete:false,code:"contribution-criteria-invalid",message:"criteria must be a nonempty string array"})));
vi.mock("./coworker-service-catalog/engagement-read-completion",async(importOriginal)=>({
 ...await importOriginal<typeof import("./coworker-service-catalog/engagement-read-completion")>(),
 engagementReadCompletion:()=>({toolNames:[],inspect:readInspection}),
}));
vi.mock("./coworker-service-catalog/engagement-fulfillment",async(importOriginal)=>({
 ...await importOriginal<typeof import("./coworker-service-catalog/engagement-fulfillment")>(),
 validateEngagementTask:vi.fn(async()=>({visualEvidence:null})),
 reconcileEngagementTaskResult:vi.fn(async()=>{}),
}));
const artifactRef={kind:"repo-blob-at-commit" as const,repositoryFullName:"owner/repo",commitSha:"a".repeat(40),path:"docs/prototype.html",providerBlobId:"b".repeat(40)};
const parsed={agentId:"ux-design-critic",routeContext:"/platform/build",title:"Original critique",objective:"Review the immutable prototype.",prompt:"Read and critique the prototype.",idempotencyKey:"original-engagement",riskClass:"read" as const,authorityScope:["tool:read_source_at_version"]};
it("persists original rejected specialist data and the first failure on the existing task without replay",async()=>{
 vi.clearAllMocks();
 db.findModelConfig.mockResolvedValue(null);
 db.findTaskRun.mockResolvedValue({status:"working"});
 db.updateTaskRun.mockResolvedValue({count:1});
 autonomous.resolveAgent.mockResolvedValue({agentId:"ux-design-critic",displayName:"UX Design Critic",systemPrompt:"Critique the source.",sensitivity:"internal"});
 autonomous.resolveTools.mockResolvedValue({tools:[],toolsForProvider:[],deferredTools:[]});
 const original='{"summary":"actual provider output","criteria":[{"name":"Hierarchy"}]}';
 autonomous.execute.mockImplementationOnce(async()=>{
  const {inspectReadEvidenceContribution}=await import("./tak/read-evidence-policy");
  await inspectReadEvidenceContribution(original);
  return {content:"Generated hold prose",executedTools:[]};
 });
 const engagementBinding={version:1 as const,engagementId:"CE-original",offerId:"offer",serviceId:"service",providerAgentId:"ux-design-critic",actorAgentId:"AGT-EXT-CODEX",userId:"human",workroomId:"WC-original",stageKey:"accept",inputDigest:"a".repeat(64),artifactRef:artifactRef};
 const outcome=await executeRemoteTaskAttempt({
  run:{id:"original-row",taskRunId:"TR-ORIGINAL-CRITIC",contextId:"thread"},threadId:"thread",
  token:{tokenId:"oauth",userId:"human",capability:"write",source:"oauth"},userContext:{} as never,
  parsed:{...parsed,agentId:"ux-design-critic",riskClass:"read",initiativeReviewBinding:undefined,engagementBinding},
  idempotentReplay:false,capacityAttempt:1,
 });
 const {createTaskMessage}=await import("./tak/task-records");
 expect(createTaskMessage).toHaveBeenCalledWith(expect.objectContaining({
  taskRunId:"TR-ORIGINAL-CRITIC",content:"Generated hold prose",
  metadata:expect.objectContaining({engagementContributionAttempt:expect.objectContaining({
   version:1,validated:false,check:expect.objectContaining({code:"contribution-criteria-invalid"}),original:expect.objectContaining({text:original,truncated:false,redacted:false}),
  })}),
 }));
 expect(readInspection).toHaveBeenCalledExactlyOnceWith(original);
 expect(autonomous.execute).toHaveBeenCalledTimes(1);
 expect(outcome).toMatchObject({kind:"result",result:{status:"input-required",resumable:false}});
 expect(JSON.stringify(db.updateTaskRun.mock.calls)).toContain("contribution-criteria-invalid");
});
