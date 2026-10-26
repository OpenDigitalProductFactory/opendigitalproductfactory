import {describe,it,expect,vi} from "vitest";
import {createHash} from "node:crypto";
import {loadEngagementVisualEvidence,assertEngagementVisualReadGrants,hasEngagementVisualDelivery,engagementVisualDeliveryRecorder} from "./engagement-visual-evidence";
const state=vi.hoisted(()=>({task:null as any,write:vi.fn()}));
vi.mock("@dpf/db",()=>({prisma:{taskRun:{findUnique:async()=>state.task,updateMany:state.write}}}));
const sha=(b:string|Buffer)=>createHash("sha256").update(b).digest("hex");
const pixels=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aHNcAAAAASUVORK5CYII=","base64");
function fixture(){
 const artifactRef={kind:"repo-blob-at-commit" as const,repositoryFullName:"owner/repo",commitSha:"a".repeat(40),path:"docs/design.html",providerBlobId:"b".repeat(40)};
 const manifest={version:1,engagementId:"CE-original",captureActor:"AGT-EXT-CODEX",url:"https://example.com/prototype",sourceArtifact:artifactRef,captures:[{state:"default",documentId:"DOC-IMAGE",versionId:"image-version",sha256:sha(pixels),bytes:pixels.length,mimeType:"image/png",imageWidth:1,imageHeight:1,capturedAt:"2026-10-26T03:00:00Z",viewportWidth:1280,viewportHeight:720,colorScheme:"dark"}],limitations:["Supplied capture only"]};
 const contentText=JSON.stringify(manifest);
 const binding={version:1 as const,engagementId:"CE-original",actorAgentId:"AGT-EXT-CODEX",userId:"human",providerAgentId:"ux-design-critic",offerId:"offer",serviceId:"service",workroomId:"WC-original",stageKey:"accept",inputDigest:"c".repeat(64),artifactRef,visualEvidenceRef:{kind:"document-version" as const,repositoryFullName:"owner/repo",versionId:"manifest-version",valueDigest:sha(contentText)}};
 const document={documentId:"DOC-MANIFEST",organizationId:"org",ownerPrincipalId:"actor",createdByPrincipalId:"actor",sourceKind:"managed",accessScope:"organization",classification:null,archivedAt:null,currentState:"draft"};
 const versions:Record<string,any>={"manifest-version":{id:"manifest-version",contentFormat:"application/json",contentText,createdByPrincipalId:"actor",document},"image-version":{id:"image-version",contentFormat:"image/png",contentText:null,createdByPrincipalId:"actor",contentSha256:sha(pixels),document:{...document,documentId:"DOC-IMAGE"},contentBlob:{storageKey:"owned/hash.png",sha256:sha(pixels),sizeBytes:pixels.length,mimeType:"image/png"}}};
 const deps={organizationId:async()=>"org",principalId:async()=>"actor",version:async(id:string)=>versions[id]??null,readBlob:vi.fn(async()=>pixels)};
 return {binding,manifest,versions,deps,rebind(){versions["manifest-version"].contentText=JSON.stringify(manifest);binding.visualEvidenceRef.valueDigest=sha(versions["manifest-version"].contentText);}};
}
describe("provided visual engagement inputs",()=>{
 it("uses existing doc_load grant alternatives with no writer-implies-reader exception",()=>{
  expect(()=>assertEngagementVisualReadGrants([["registry_read"],["registry_read"],["document_read"]])).not.toThrow();
  expect(()=>assertEngagementVisualReadGrants([["registry_read"],["document_write"],["document_read"]])).toThrow(/grant/);
 });
 it("loads exact owned version bytes and supplies actual image blocks without persisting pixels in provenance",async()=>{
  const f=fixture(),r=await loadEngagementVisualEvidence(f.binding,f.deps);
  expect(r?.inputs.find(b=>b.type==="image_url")).toMatchObject({type:"image_url",image_url:{url:`data:image/png;base64,${pixels.toString("base64")}`}});
  expect(JSON.stringify(r?.inputs.filter(b=>b.type==="text"))).toContain("Supplied capture only");
  expect(r?.provenance.captures[0]).toMatchObject({versionId:"image-version",sha256:sha(pixels)});
  expect(JSON.stringify(r?.provenance)).not.toContain(pixels.toString("base64"));
 });
 it.each(["organizationId","ownerPrincipalId","createdByPrincipalId","accessScope","sourceKind","classification","archivedAt"])("refuses changed content authority %s before blob access",async key=>{
  const f=fixture();f.versions["image-version"].document[key]="foreign-or-restricted";
  await expect(loadEngagementVisualEvidence(f.binding,f.deps)).rejects.toThrow(/visual/);expect(f.deps.readBlob).not.toHaveBeenCalled();
 });
 it.each(["engagementId","captureActor","sourceArtifact"])("refuses manifest substitution %s",async key=>{
  const f=fixture();(f.manifest as any)[key]="substitute";f.rebind();
  await expect(loadEngagementVisualEvidence(f.binding,f.deps)).rejects.toThrow(/visual/);
 });
 it("refuses changed digest, corrupt/mismatched pixels, missing versions and unbounded count",async()=>{
  const f=fixture();f.binding.visualEvidenceRef.valueDigest="0".repeat(64);await expect(loadEngagementVisualEvidence(f.binding,f.deps)).rejects.toThrow(/visual/);
  f.rebind();f.deps.readBlob.mockResolvedValueOnce(Buffer.from("corrupt"));await expect(loadEngagementVisualEvidence(f.binding,f.deps)).rejects.toThrow(/visual/);
  f.manifest.captures[0].mimeType="image/jpeg";f.rebind();await expect(loadEngagementVisualEvidence(f.binding,f.deps)).rejects.toThrow(/visual/);
  f.manifest.captures=Array(5).fill(f.manifest.captures[0]);f.rebind();await expect(loadEngagementVisualEvidence(f.binding,f.deps)).rejects.toThrow(/visual/);
 });
 it("leaves legacy bindings unchanged and requires server delivery evidence for a visual binding",async()=>{
  const f=fixture();expect(await loadEngagementVisualEvidence({...f.binding,visualEvidenceRef:undefined},f.deps)).toBeNull();
  expect(hasEngagementVisualDelivery(f.binding,{})).toBe(false);
 });
});

it("records only matching successful input hashes under the exact active task fence",async()=>{
 const f=fixture(),visual=await loadEngagementVisualEvidence(f.binding,f.deps);
 const fence={schemaVersion:1 as const,reservation:null,dispatchClaim:"attempt-1",authorityDigest:null,requestDigest:"d".repeat(64)};
 state.task={status:"working",updatedAt:new Date(),progressPayload:{dispatch:{claimedAt:"attempt-1"}},a2aMetadata:{engagementBinding:f.binding,requestDigest:fence.requestDigest}};
 state.write.mockReset();state.write.mockResolvedValue({count:1});
 const record=engagementVisualDeliveryRecorder("TR-original",f.binding,fence,visual);
 const delivery={sha256:[sha(pixels)],providerId:"codex",modelId:"actual",adapterKind:"codex-cli"};
 await record(delivery);
 const receipt=state.write.mock.calls[0][0].data.a2aMetadata.engagementVisualDelivery;
 expect(receipt).toMatchObject({manifestRef:f.binding.visualEvidenceRef,providerId:"codex",modelId:"actual",dispatchFence:fence});
 expect(hasEngagementVisualDelivery(f.binding,receipt,fence)).toBe(true);
 expect(hasEngagementVisualDelivery(f.binding,receipt,{...fence,dispatchClaim:"attempt-2"})).toBe(false);
 expect(JSON.stringify(receipt)).not.toContain(pixels.toString("base64"));
 state.write.mockClear();await expect(record({...delivery,sha256:["e".repeat(64)]})).rejects.toThrow(/mismatch/);expect(state.write).not.toHaveBeenCalled();
 state.task.progressPayload.dispatch.claimedAt="attempt-2";
 await expect(record(delivery)).rejects.toThrow(/displaced/);expect(state.write).not.toHaveBeenCalled();
 state.task.progressPayload.dispatch.claimedAt="attempt-1";state.write.mockResolvedValue({count:0});
 await expect(record(delivery)).rejects.toThrow(/displaced/);
});
