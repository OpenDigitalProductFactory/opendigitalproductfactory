import { prisma, type Prisma } from "@dpf/db";
import type {RemoteTaskSubmitOutcome} from "@/lib/mcp-task-submit-types";
import type { EngagementTaskBinding } from "./engagement-task-binding";
import { engagementProviderIdentityRefs } from "./engagement-task-binding";
import { engagementReadEvidence, completeArtifactReads } from "./engagement-read-provenance";
import type { ReadEvidencePolicy } from "@/lib/tak/read-evidence-policy";
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
/** The same provenance validator used for result persistence owns completion. */
export function engagementReadCompletion(taskRunId: string, binding: EngagementTaskBinding): ReadEvidencePolicy {
  return {toolNames:["read_source_at_version","wiki_query","search_ux_critique_corpus"], async inspect(content) {
    const [{validateEngagementContribution}, {findProfessionFamilyForAgentIdentity}] = await Promise.all([
      import("./engagement-fulfillment"), import("@/lib/decision-perspective/resolve-profession-profile"),
    ]);
    const [task, executions, provider] = await Promise.all([
      prisma.taskRun.findUnique({where:{taskRunId},select:{a2aMetadata:true,status:true}}),
      prisma.toolExecution.findMany({where:{taskRunId,agentId:{in:engagementProviderIdentityRefs(binding.providerAgentId)},userId:binding.userId,success:true},select:{id:true,toolName:true,parameters:true,result:true,success:true}}),
      prisma.agent.findUnique({where:{agentId:binding.providerAgentId},select:{agentId:true,name:true,slugId:true}}),
    ]);
    const metadata = record(task?.a2aMetadata), family = provider ? findProfessionFamilyForAgentIdentity(provider) : null;
    if (task?.status !== "working" || metadata.engagementReadFailure || !family) return {complete:false,message:"The original task, craft identity or evidence budget cannot authorize completion"};
    const evidence = engagementReadEvidence(metadata.engagementReadEvidence);
    const successfulIds = new Set(executions.map(e=>e.id));
    const proven = evidence.filter(e=>successfulIds.has(e.executionId));
    const missing = [binding.artifactRef,...(binding.guidanceArtifacts??[])].filter(a=>!completeArtifactReads(a,proven)).map(a=>`${a.path}@${a.commitSha}`);
    if (missing.length) return {complete:false,message:`Complete immutable artifact traversal is missing for ${missing.join(", ")}`};
    if (!proven.some(e=>e.kind==="corpus")) return {complete:false,message:"Run wiki_query with the UX profession corpus included and cite the returned slugs"};
    if (!proven.some(e=>e.kind==="calibration")) return {complete:false,message:"Run search_ux_critique_corpus with calibratedOnly=true and retain an empty set as a limitation"};
    const valid = validateEngagementContribution(binding,content,executions,family.professionKey,evidence);
    return {complete:!!valid,message:valid?"Complete immutable source/corpus contribution verified":"Return the required JSON with nonempty criteria/corpusRefs from actually consulted profession pages and a findings array"};
  }};
}

/** Caller still owns atomic/fenced settlement; no execution is requested here. */
export async function engagementIncompleteOutcome(input:{policy:ReadEvidencePolicy;taskRunId:string;result:{content:string;executedTools?:readonly unknown[]};checkpoint:Record<string,unknown>;flags:Record<string,unknown>;skip:boolean}):Promise<{
 settlement:Prisma.TaskRunUpdateManyArgs & {where:{taskRunId:string}};outcome:RemoteTaskSubmitOutcome;
}|null> {
 if(input.skip||(await input.policy.inspect(input.result.content)).complete)return null;
 const message="Specialist contribution is incomplete. Inspect source/corpus provenance and native reader transport. Execution proof is unavailable, so this task is held without replay; obtain the existing recovery owner's supported finite disposition.";
 return {settlement:{where:{taskRunId:input.taskRunId},data:{status:"input-required",completedAt:null,progressPayload:{
  ...input.checkpoint,summary:message,riskClass:"read",executedToolCount:input.result.executedTools?.length??0,
  engagementEvidenceWait:{schemaVersion:1,kind:"incomplete-read-evidence",requiresExecutionProof:true,observedAt:new Date().toISOString(),resumeMode:"held"},...input.flags,
 } as Prisma.InputJsonValue}},outcome:{kind:"result",result:{taskRunId:input.taskRunId,status:"input-required",requiresApproval:false,resumable:false,waitReason:"incomplete-read-evidence",content:[{type:"text",text:message}],isError:false}}};
}
