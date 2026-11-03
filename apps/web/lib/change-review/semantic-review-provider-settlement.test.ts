import { expect, it } from "vitest";
import { semanticNodeNeedsSettlement, semanticNodeProviderSettled } from "./semantic-review-provider-settlement";
const digest = "a".repeat(64);
const node = { taskNodeId:"TN-original", requestContract:{requestDigest:digest,generation:"g-original"},
 outputSnapshot:{requestDigest:digest,providerSettlement:{schemaVersion:1,taskNodeId:"TN-original",requestDigest:digest,generation:"g-original",sealed:true,events:[
 {attemptId:"adapter",state:"adapter-registered"},
 {attemptId:"http",adapterAttemptId:"adapter",state:"dispatching"},
 {attemptId:"http",adapterAttemptId:"adapter",state:"response-completed",providerRequestId:"chat-id",responseDigest:"b".repeat(64)}
 ].map(event => ({...event,providerId:"local",modelId:"model",traceId:"trace",accountMode:"local"}))}} };
it("consumes original sealed provider proof without converting it to a review verdict",()=>{
 expect(semanticNodeProviderSettled(node,digest)).toBe(true);
 expect(semanticNodeProviderSettled(node,"c".repeat(64))).toBe(false);
 expect(semanticNodeProviderSettled({...node,requestContract:{requestDigest:digest,generation:"different"}},digest)).toBe(false);
});
it("keeps historical missing or unsealed provider evidence unknown",()=>{
 expect(semanticNodeProviderSettled({taskNodeId:"old",requestContract:{},outputSnapshot:{providerOutcome:"unknown"}},digest)).toBe(false);
 expect(semanticNodeProviderSettled({...node,outputSnapshot:{...node.outputSnapshot,providerSettlement:{...node.outputSnapshot.providerSettlement,sealed:false}}},digest)).toBe(false);
});
it('rejects cross-model and cross-account terminal proof', () => {
 const original=structuredClone(node);
 original.outputSnapshot.providerSettlement.events=original.outputSnapshot.providerSettlement.events.map(event => ({...event,accountMode:'credential',providerConnectionId:'original-account'})) as any;
 expect(semanticNodeProviderSettled(original,digest)).toBe(true);
 for (const changed of [{modelId:'other-model'},{providerConnectionId:'other-account'},{traceId:'other-trace'},{providerId:'other-provider'}]) {
  const mixed=structuredClone(original);
  Object.assign(mixed.outputSnapshot.providerSettlement.events[2],changed);
  expect(semanticNodeProviderSettled(mixed,digest)).toBe(false);
 }
});

it("requires settlement for completed inconclusive results while retaining definitive verdicts", () => {
 for (const decision of ["pass", "fail", "inconclusive"]) {
  const candidate = { ...node, status: "completed", outputSnapshot: { result: { decision, issues: [], summary: "Review" } } };
  expect(semanticNodeNeedsSettlement(candidate)).toBe(decision === "inconclusive");
 }
 expect(semanticNodeNeedsSettlement({ ...node, status: "completed", outputSnapshot: {} })).toBe(true);
});
it("accepts only bound typed server eligibility refusal without a provider ledger", () => {
 const refusal = { taskNodeId: node.taskNodeId, status: "completed", requestContract: node.requestContract,
  outputSnapshot: { requestDigest: digest, providerOutcome: "not-dispatched",
   result: { decision: "inconclusive", issues: [], inconclusiveReason: "review-endpoint-ineligible" },
   routingEligibility: [{ sensitivity: "restricted", residencyPolicy: "local_only", excludedCount: 1,
    exclusions: [{ bucket: "output-capacity", count: 1 }] }] } };
 expect(semanticNodeProviderSettled(refusal, digest)).toBe(true);
 const incomplete = structuredClone(node.outputSnapshot.providerSettlement);
 incomplete.events = incomplete.events.filter(event => event.state !== "response-completed");
 expect(semanticNodeProviderSettled({ ...refusal, outputSnapshot: { ...refusal.outputSnapshot, providerSettlement: incomplete } }, digest)).toBe(false);
 expect(semanticNodeProviderSettled({ ...refusal, outputSnapshot: { ...refusal.outputSnapshot, providerSettlement: {} } }, digest)).toBe(false);

 expect(semanticNodeProviderSettled({ ...refusal, requestContract: {} }, digest)).toBe(false);
 expect(semanticNodeProviderSettled({ ...refusal, outputSnapshot: { ...refusal.outputSnapshot, providerOutcome: "unknown" } }, digest)).toBe(false);
 expect(semanticNodeProviderSettled({ ...refusal, outputSnapshot: { ...refusal.outputSnapshot, routingEligibility: [{}] } }, digest)).toBe(false);
 expect(semanticNodeProviderSettled({ ...refusal, outputSnapshot: { ...refusal.outputSnapshot, result: {} } }, digest)).toBe(false);
});
