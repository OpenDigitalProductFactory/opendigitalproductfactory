import { expect, it } from "vitest";
import { semanticNodeProviderSettled } from "./semantic-review-provider-settlement";
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
