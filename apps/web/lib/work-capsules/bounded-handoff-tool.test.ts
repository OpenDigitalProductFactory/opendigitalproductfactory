import { beforeEach, describe, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({ assess:vi.fn(), actor:vi.fn(), lock:vi.fn(), publish:vi.fn(), invalidate:vi.fn() }));
vi.mock("@dpf/db",()=>({prisma:{}}));
vi.mock("./bounded-handoff",()=>({assessBoundedHandoff:m.assess}));
vi.mock("./handler-actor",()=>({workCapsuleActor:m.actor}));
vi.mock("@/lib/nonprod/environment-lease-lock",()=>({lockAllNonprodEnvironments:m.lock}));
vi.mock("./activity-events",()=>({publishRecordedWorkCapsuleActivity:m.publish}));
vi.mock("@/lib/portal-context/invalidation",()=>({revalidatePortalContextForCapsule:m.invalidate}));
import { boundedHandoffConsequenceForCall, prepareBoundedHandoff } from "./bounded-handoff-tool";
const params={phase:"request",commandId:"request-1",capsuleId:"WC-room",expectedLeaseHolderPrincipalId:"human",expectedExecutorKind:"claude-desktop",expectedExecutorRef:"source",targetAgentId:"AGT-EXT-CODEX",toExecutorKind:"codex-desktop",toExecutorRef:"receiver",handoffManifest:{nextAction:"Continue the existing plan"}};
const call={toolName:"reassign_workroom_executor",params,userId:"owner",context:{authSource:"oauth",agentId:"AGT-EXT-CLAUDE"}};
beforeEach(()=>{vi.clearAllMocks();m.actor.mockResolvedValue({userId:"owner",principalId:"human",agentId:"AGT-EXT-CLAUDE",agentPrincipalId:"assistant"});m.assess.mockResolvedValue({});});
describe("bounded handoff tool adapter",()=>{
  it("narrows only a positively verified explicit handoff",async()=>{expect(await boundedHandoffConsequenceForCall(call)).toMatchObject({consequence:null});expect(m.assess).toHaveBeenCalledOnce();});
  it.each([{}, {phase:"unknown"}, {...params,extraAuthority:true}])("retains authority for legacy or malformed input",async input=>{expect(await boundedHandoffConsequenceForCall({...call,params:input})).toMatchObject({consequence:"authority"});expect(m.assess).not.toHaveBeenCalled();});
  it("retains authority for missing authenticated assistant context",async()=>{expect(await boundedHandoffConsequenceForCall({...call,context:undefined})).toMatchObject({consequence:"authority"});});
  it("retains authority for a failed or changed boundary",async()=>{m.assess.mockRejectedValue(new Error("changed"));expect(await boundedHandoffConsequenceForCall(call)).toMatchObject({consequence:"authority"});});
  it("normalizes and binds before receipt replay with a server-owned lock prefix",()=>{const a=prepareBoundedHandoff(params);const b=prepareBoundedHandoff({...params,reason:"Different next step"});expect(a).toMatchObject({params,payloadBinding:{version:1},beforeRoomLock:m.lock});expect(a&&"payloadBinding" in a&&a.payloadBinding.digest).not.toBe(b&&"payloadBinding" in b&&b.payloadBinding.digest);});
  it("publishes the confirmed receipt through the existing feed and invalidates this room",async()=>{
    const prepared=prepareBoundedHandoff(params);
    expect(prepared&&"afterCommit" in prepared&&prepared.afterCommit).toBeTypeOf("function");
    if(prepared&&"afterCommit" in prepared) await prepared.afterCommit?.({workCapsuleId:"room-row",id:"receipt-row"},{success:true,message:"Requested"});
    expect(m.publish).toHaveBeenCalledWith("room-row","receipt-row");
    expect(m.invalidate).toHaveBeenCalledWith("WC-room");
  });
  it("keeps omitted phase on the legacy adapter",()=>{expect(prepareBoundedHandoff({capsuleId:"WC-room",toExecutorKind:"codex-desktop"})).toBeUndefined();});
  it("refuses invalid explicit phase before the handler or cache",()=>{expect(prepareBoundedHandoff({...params,phase:"accept-for-another-agent"})).toMatchObject({refusal:{success:false,error:"handoff-invalid-input"}});});
});
