import { beforeEach, describe, expect, it, vi } from "vitest";
const m=vi.hoisted(()=>({ assess:vi.fn(), takeover:vi.fn(), actor:vi.fn(), lock:vi.fn(), publish:vi.fn(), invalidate:vi.fn() }));
vi.mock("@dpf/db",()=>({prisma:{}}));
vi.mock("./bounded-handoff",()=>({assessBoundedHandoff:m.assess}));
vi.mock("./own-room-takeover",()=>({assessOwnRoomTakeover:m.takeover}));
vi.mock("./handler-actor",()=>({workCapsuleActor:m.actor}));
vi.mock("@/lib/nonprod/environment-lease-lock",()=>({lockAllNonprodEnvironments:m.lock}));
vi.mock("./activity-events",()=>({publishRecordedWorkCapsuleActivity:m.publish}));
vi.mock("@/lib/portal-context/invalidation",()=>({revalidatePortalContextForCapsule:m.invalidate}));
import { boundedHandoffConsequenceForCall, prepareBoundedHandoff } from "./bounded-handoff-tool";
import { BoundedHandoffRefusal } from "./bounded-handoff-command";
const params={phase:"request",commandId:"request-1",capsuleId:"WC-room",expectedLeaseHolderPrincipalId:"human",expectedExecutorKind:"claude-desktop",expectedExecutorRef:"source",targetAgentId:"AGT-EXT-CODEX",toExecutorKind:"codex-desktop",toExecutorRef:"receiver",handoffManifest:{nextAction:"Continue the existing plan"}};
const call={toolName:"reassign_workroom_executor",params,userId:"owner",context:{authSource:"oauth",agentId:"AGT-EXT-CLAUDE"}};
beforeEach(()=>{vi.clearAllMocks();m.actor.mockResolvedValue({userId:"owner",principalId:"human",agentId:"AGT-EXT-CLAUDE",agentPrincipalId:"assistant"});m.assess.mockResolvedValue({});m.takeover.mockResolvedValue({});});
describe("bounded handoff tool adapter",()=>{
  it("narrows only a positively verified explicit handoff",async()=>{expect(await boundedHandoffConsequenceForCall(call)).toMatchObject({consequence:null});expect(m.assess).toHaveBeenCalledOnce();});
  it("retains authority for a call that names no room or executor",async()=>{expect(await boundedHandoffConsequenceForCall({...call,params:{}})).toMatchObject({consequence:"authority"});expect(m.assess).not.toHaveBeenCalled();expect(m.takeover).not.toHaveBeenCalled();});
  // BI-1986D3C1: the handler refuses these before any read or write, so they never reach the owner.
  it.each([{phase:"unknown"}, {...params,extraAuthority:true}, {phase:"acknowledge",requestId:"r-1"}])("lets the handler refuse malformed phase input instead of asking the owner",async input=>{expect(await boundedHandoffConsequenceForCall({...call,params:input})).toEqual({consequence:null,reason:"handoff-invalid-input"});expect(m.assess).not.toHaveBeenCalled();});
  it("retains authority for missing authenticated assistant context",async()=>{expect(await boundedHandoffConsequenceForCall({...call,context:undefined})).toMatchObject({consequence:"authority"});});
  it("retains authority for a failed or changed boundary",async()=>{m.assess.mockRejectedValue(new Error("changed"));expect(await boundedHandoffConsequenceForCall(call)).toMatchObject({consequence:"authority"});});
  it("records which boundary refused (BI-F1FC0B62)",async()=>{m.assess.mockRejectedValue(new BoundedHandoffRefusal("handoff-lease-expired","lapsed"));expect(await boundedHandoffConsequenceForCall(call)).toEqual({consequence:"authority",reason:"handoff-boundary-unproven:handoff-lease-expired"});});
  it("normalizes and binds before receipt replay with a server-owned lock prefix",()=>{const a=prepareBoundedHandoff(params);const b=prepareBoundedHandoff({...params,reason:"Different next step"});expect(a).toMatchObject({params,payloadBinding:{version:1},beforeRoomLock:m.lock});expect(a && ("payloadBinding" in a) && a.payloadBinding.digest).not.toBe(b && ("payloadBinding" in b) && b.payloadBinding.digest);});
  it("publishes the confirmed receipt through the existing feed and invalidates this room",async()=>{
    const prepared=prepareBoundedHandoff(params);
    expect(prepared && ("afterCommit" in prepared) && prepared.afterCommit).toBeTypeOf("function");
    if (prepared && ("afterCommit" in prepared)) await prepared.afterCommit?.({workCapsuleId:"room-row",id:"receipt-row"},{success:true,message:"Requested"});
    expect(m.publish).toHaveBeenCalledWith("room-row","receipt-row");
    expect(m.invalidate).toHaveBeenCalledWith("WC-room");
  });
  it("keeps omitted phase on the legacy adapter",()=>{expect(prepareBoundedHandoff({capsuleId:"WC-room",toExecutorKind:"codex-desktop"})).toBeUndefined();});
  it("refuses invalid explicit phase before the handler or cache",()=>{expect(prepareBoundedHandoff({...params,phase:"accept-for-another-agent"})).toMatchObject({refusal:{success:false,error:"handoff-invalid-input"}});});
});
describe("batched handover consequence (BI-D4144471)",()=>{
  it("treats a batch dry run as a read: it changes nothing",async()=>{
    expect(await boundedHandoffConsequenceForCall({...call,params:{capsuleIds:["WC-A","WC-B"],toExecutorKind:"claude-desktop"}})).toMatchObject({consequence:null,reason:"batch-handover-dry-run"});
    expect(await boundedHandoffConsequenceForCall({...call,params:{capsuleIds:["WC-A"],toExecutorKind:"claude-desktop",dryRun:true}})).toMatchObject({consequence:null});
  });
  it("keeps authority for a batch apply that leaves the owner's scope",async()=>{
    m.takeover.mockResolvedValueOnce({}).mockRejectedValueOnce(new BoundedHandoffRefusal("takeover-other-holder","other"));
    expect(await boundedHandoffConsequenceForCall({...call,params:{capsuleIds:["WC-A","WC-B"],toExecutorKind:"claude-desktop",dryRun:false,planDigest:"d"}})).toEqual({consequence:"authority",reason:"handoff-boundary-unproven:takeover-other-holder"});
    expect(m.assess).not.toHaveBeenCalled();
  });
  it("treats a batch apply of the owner's own rooms as routine, checking every room (BI-1986D3C1)",async()=>{
    expect(await boundedHandoffConsequenceForCall({...call,params:{capsuleIds:["WC-A","WC-B"],toExecutorKind:"claude-desktop",dryRun:false,planDigest:"d"}})).toEqual({consequence:null,reason:"own-room-takeover"});
    expect(m.takeover.mock.calls.map(([input])=>input.takeover.capsuleId)).toEqual(["WC-A","WC-B"]);
  });
});

// BI-1986D3C1: a replacement session of the same owner taking over the room in one call.
describe("one-call own-room takeover consequence",()=>{
  const takeoverCall={...call,params:{capsuleId:"WC-room",toExecutorKind:"claude-desktop",toExecutorRef:"new-session",reason:"A new assistant is taking over this work for the room's owner."}};
  it("is routine when the owner's assistant takes the owner's room",async()=>{
    expect(await boundedHandoffConsequenceForCall(takeoverCall)).toEqual({consequence:null,reason:"own-room-takeover"});
    expect(m.takeover).toHaveBeenCalledWith(expect.objectContaining({takeover:{capsuleId:"WC-room",toExecutorKind:"claude-desktop",toExecutorRef:"new-session"}}));
  });
  it("records why it still reaches the owner when the room is outside their scope",async()=>{
    m.takeover.mockRejectedValue(new BoundedHandoffRefusal("takeover-other-holder","other"));
    expect(await boundedHandoffConsequenceForCall(takeoverCall)).toEqual({consequence:"authority",reason:"handoff-boundary-unproven:takeover-other-holder"});
  });
  it("stays with the owner for a personal access token or no assistant",async()=>{
    expect(await boundedHandoffConsequenceForCall({...takeoverCall,context:{authSource:"pat",agentId:"AGT-EXT-CLAUDE"}})).toMatchObject({consequence:"authority"});
    expect(await boundedHandoffConsequenceForCall({...takeoverCall,context:{authSource:"oauth"}})).toMatchObject({consequence:"authority"});
    expect(m.takeover).not.toHaveBeenCalled();
  });
});
