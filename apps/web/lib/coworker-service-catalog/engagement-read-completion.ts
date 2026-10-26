import {captureTaskExecutionFence} from "@/lib/shared/task-execution-fence";
import {hasEngagementVisualDelivery} from "./engagement-visual-evidence";
import { prisma, type Prisma } from "@dpf/db";
import type {RemoteTaskSubmitOutcome} from "@/lib/mcp-task-submit-types";
import type { EngagementTaskBinding } from "./engagement-task-binding";
import { engagementProviderIdentityRefs } from "./engagement-task-binding";
import { engagementReadEvidence, completeArtifactReads } from "./engagement-read-provenance";
import type { ReadEvidencePolicy,ReadEvidenceInspection,ReadEvidenceCheck } from "@/lib/tak/read-evidence-policy";
const record = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
/** The same provenance validator used for result persistence owns completion. */
export function engagementReadCompletion(taskRunId: string, binding: EngagementTaskBinding): ReadEvidencePolicy {
  return {toolNames:["read_source_at_version","wiki_query","search_ux_critique_corpus"], async inspect(content) {
    const [{validateEngagementContribution}, {findProfessionFamilyForAgentIdentity}] = await Promise.all([
      import("./engagement-fulfillment"), import("@/lib/decision-perspective/resolve-profession-profile"),
    ]);
    const [task, executions, provider] = await Promise.all([
      prisma.taskRun.findUnique({where:{taskRunId},select:{a2aMetadata:true,status:true,progressPayload:true}}),
      prisma.toolExecution.findMany({where:{taskRunId,agentId:{in:engagementProviderIdentityRefs(binding.providerAgentId)},userId:binding.userId,success:true},select:{id:true,toolName:true,parameters:true,result:true,success:true}}),
      prisma.agent.findUnique({where:{agentId:binding.providerAgentId},select:{agentId:true,name:true,slugId:true}}),
    ]);
    const metadata = record(task?.a2aMetadata), family = provider ? findProfessionFamilyForAgentIdentity(provider) : null;
    if(task?.status!=="working")return {complete:false,code:"task-not-working",message:"The original task is no longer working"};
    if(metadata.engagementReadFailure)return {complete:false,code:"read-evidence-failure",message:"The original task's read-evidence budget or recording failed"};
    if(!family)return {complete:false,code:"profession-unresolved",message:"The provider's recorded profession cannot authorize completion"};
    if(!hasEngagementVisualDelivery(binding,metadata.engagementVisualDelivery,captureTaskExecutionFence(task.progressPayload,metadata.requestDigest??null)))return {complete:false,code:"rendered-input-unproven",message:"Provided rendered input delivery is missing; source-only output cannot complete this visual critique"};
    const evidence = engagementReadEvidence(metadata.engagementReadEvidence);
    const successfulIds = new Set(executions.map(e=>e.id));
    const proven = evidence.filter(e=>successfulIds.has(e.executionId));
    const missing = [binding.artifactRef,...(binding.guidanceArtifacts??[])].filter(a=>!completeArtifactReads(a,proven)).map(a=>`${a.path}@${a.commitSha}`);
    if (missing.length) return {complete:false,code:"artifact-traversal-incomplete",message:`Complete immutable artifact traversal is missing for ${missing.join(", ")}`};
    if (!proven.some(e=>e.kind==="corpus")) return {complete:false,code:"profession-corpus-unread",message:"Run wiki_query with the UX profession corpus included and cite the returned slugs"};
    if (!proven.some(e=>e.kind==="calibration")) return {complete:false,code:"calibration-corpus-unread",message:"Run search_ux_critique_corpus with calibratedOnly=true and retain an empty set as a limitation"};
    let failure:ReadEvidenceCheck={complete:false,code:"contribution-unverified",message:"Specialist contribution could not be verified"};
    const valid = validateEngagementContribution(binding,content,executions,family.professionKey,evidence,metadata.engagementVisualDelivery,(code,message)=>{failure={complete:false,code,message};});
    return valid?{complete:true,message:"Complete immutable source/corpus contribution verified"}:failure;
  }};
}

/** Caller still owns atomic/fenced settlement; no execution is requested here. */
export async function engagementIncompleteOutcome(input:{policy:ReadEvidencePolicy;taskRunId:string;result:{content:string;executedTools?:readonly unknown[];readEvidenceInspection?:ReadEvidenceInspection};checkpoint:Record<string,unknown>;flags:Record<string,unknown>;skip:boolean}):Promise<{
 settlement:Prisma.TaskRunUpdateManyArgs & {where:{taskRunId:string}};outcome:RemoteTaskSubmitOutcome;
}|null> {
 if(input.skip)return null;
 const inspection=input.result.readEvidenceInspection;
 const check=inspection?.check??await input.policy.inspect(input.result.content);
 if(check.complete)return null;
 const message=`Specialist contribution is incomplete: ${check.message}. Inspect source/corpus provenance and native reader transport. Execution proof is unavailable, so this task is held without replay; obtain the existing recovery owner's supported finite disposition.`;
 return {settlement:{where:{taskRunId:input.taskRunId},data:{status:"input-required",completedAt:null,progressPayload:{
  ...input.checkpoint,summary:message,riskClass:"read",executedToolCount:input.result.executedTools?.length??0,
  engagementEvidenceWait:{schemaVersion:1,kind:"incomplete-read-evidence",requiresExecutionProof:true,observedAt:new Date().toISOString(),resumeMode:"held",...(check.code?{code:check.code}:{})},...input.flags,
 } as Prisma.InputJsonValue}},outcome:{kind:"result",result:{taskRunId:input.taskRunId,status:"input-required",requiresApproval:false,resumable:false,waitReason:"incomplete-read-evidence",content:[{type:"text",text:message}],isError:false}}};
}
