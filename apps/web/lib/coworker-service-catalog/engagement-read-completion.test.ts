import {beforeEach,it,expect,vi} from "vitest";
const state=vi.hoisted(()=>({task:{} as any,executions:[] as any[],queries:[] as any[]}));
vi.mock("@dpf/db",()=>({prisma:{taskRun:{findUnique:async()=>state.task},toolExecution:{findMany:async(q:any)=>{state.queries.push(q);return state.executions;}},agent:{findUnique:async()=>({agentId:"ux-design-critic",name:"UX Design Critic",slugId:"ux-design-critic"})}}}));
vi.mock("@/lib/decision-perspective/resolve-profession-profile",()=>({findProfessionFamilyForAgentIdentity:()=>({professionKey:"ux-design"})}));
import {engagementReadCompletion,engagementIncompleteOutcome} from "./engagement-read-completion";
import {compactEngagementRead} from "./engagement-read-provenance";
import {engagementInputDigest} from "./engagement-task-binding";
const artifact={kind:"repo-blob-at-commit" as const,repositoryFullName:"owner/repo",commitSha:"a".repeat(40),path:"docs/prototype.html",providerBlobId:"b".repeat(40)};
const guidance={...artifact,commitSha:"d".repeat(40),path:"docs/professions/ux-design/wiki/hierarchy.md",providerBlobId:"e".repeat(40)};
const binding={version:1 as const,engagementId:"CE-original",offerId:"offer",serviceId:"service",providerAgentId:"ux-design-critic",actorAgentId:"AGT-EXT-CODEX",userId:"human",workroomId:"WC-original",stageKey:"accept",inputDigest:engagementInputDigest("review",{}),artifactRef:artifact,roomHeadSha:guidance.commitSha,guidanceArtifacts:[guidance]};
const content=JSON.stringify({summary:"Pinned prototype review",criteria:["Hierarchy"],corpusRefs:["professions/ux-design/hierarchy"],findings:[],limitations:["Calibrated corpus empty; advisory only"]});
beforeEach(()=>{
 const source=(id:string,a:typeof artifact)=>compactEngagementRead(id,"read_source_at_version",{repositoryFullName:a.repositoryFullName,version:a.commitSha,path:a.path,expectedBlobId:a.providerBlobId},{success:true,message:"read",data:{repositoryFullName:a.repositoryFullName,version:a.commitSha,path:a.path,blobId:a.providerBlobId,content:"Source",startLine:1,endLine:1,totalLines:1,hasMore:false,nextCursor:null}})!;
 state.task={status:"working",a2aMetadata:{engagementBinding:binding,engagementReadEvidence:[source("primary",artifact),source("guidance",guidance),compactEngagementRead("wiki","wiki_query",{includeProfessionCorpus:true},{success:true,message:"read",data:{results:[{slug:"professions/ux-design/hierarchy",contentPreview:"Craft guidance"}]}}),compactEngagementRead("calibration","search_ux_critique_corpus",{calibratedOnly:true},{success:true,message:"read",data:{total:0,grounding:"UNGROUNDED"}})]}};
 state.executions=["primary","guidance","wiki","calibration"].map(id=>({id,toolName:id==="wiki"?"wiki_query":id==="calibration"?"search_ux_critique_corpus":"read_source_at_version",parameters:{},result:{},success:true}));state.queries=[];
});
it("requires actual primary, separately pinned guidance, profession references and calibrated corpus evidence",async()=>{
 const result=await engagementReadCompletion("TR-original",binding).inspect(content);expect(result.complete).toBe(true);
 expect(state.queries[0].where).toMatchObject({taskRunId:"TR-original",userId:"human",success:true,agentId:{in:["AGT-906","ux-design-critic"]}});
});
it.each(["primary","guidance","wiki","calibration"])("refuses missing actual execution %s even if provenance metadata claims it",async id=>{
 state.executions=state.executions.filter(e=>e.id!==id);expect((await engagementReadCompletion("TR-original",binding).inspect(content)).complete).toBe(false);
});
it("refuses invented corpus citations, malformed output, displaced task and budget failure",async()=>{
 const policy=engagementReadCompletion("TR-original",binding);
 expect((await policy.inspect(content.replace("professions/ux-design/hierarchy","professions/ux-design/invented"))).complete).toBe(false);
 expect((await policy.inspect("Looks good")).complete).toBe(false);
 state.task.status="input-required";expect((await policy.inspect(content)).complete).toBe(false);
 state.task.status="working";state.task.a2aMetadata.engagementReadFailure={code:"budget-exceeded"};expect((await policy.inspect(content)).complete).toBe(false);
});

it("holds incomplete native work without declaring a settled profile or authorizing replay",async()=>{
 const hold=await engagementIncompleteOutcome({policy:{toolNames:[],inspect:async()=>({complete:false,message:"missing"})},taskRunId:"TR-original",result:{content:"unverified",executedTools:[]},checkpoint:{},flags:{},skip:false});
 expect(hold?.outcome).toMatchObject({kind:"result",result:{status:"input-required",resumable:false}});
 expect(hold?.settlement.data.progressPayload).toMatchObject({engagementEvidenceWait:{requiresExecutionProof:true,resumeMode:"held"}});
 expect(JSON.stringify(hold)).not.toContain("knownSettled");expect(JSON.stringify(hold)).not.toContain("transportProfile");
});

it("holds source-only output when the immutable request requires provided images",async()=>{
 const visualBinding={...binding,visualEvidenceRef:{kind:"document-version" as const,repositoryFullName:"owner/repo",versionId:"manifest",valueDigest:"f".repeat(64)}};
 expect((await engagementReadCompletion("TR-original",visualBinding).inspect(content)).complete).toBe(false);
 state.task.a2aMetadata.engagementVisualDelivery={version:1,manifestRef:visualBinding.visualEvidenceRef,captures:[{sha256:"a".repeat(64)}],deliveredAt:new Date().toISOString(),providerId:"codex",modelId:"actual",dispatchFence:{schemaVersion:1,reservation:null,dispatchClaim:null,authorityDigest:null,requestDigest:null}};
 expect((await engagementReadCompletion("TR-original",visualBinding).inspect(content)).complete).toBe(true);
 state.task.a2aMetadata.engagementVisualDelivery.manifestRef={...visualBinding.visualEvidenceRef,valueDigest:"b".repeat(64)};
 expect((await engagementReadCompletion("TR-original",visualBinding).inspect(content)).complete).toBe(false);
});
