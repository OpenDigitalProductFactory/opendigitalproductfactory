import {beforeEach,describe,expect,it,vi} from "vitest";
const routed=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/inference/routed-inference",()=>({routeAndCall:routed}));
import {reviewCoworkerDraft} from "./coworker-inline-review";
import {withReadEvidencePolicy,acceptReadEvidenceContribution} from "./read-evidence-policy";
beforeEach(()=>{routed.mockReset();routed.mockResolvedValue({content:"Generic revised prose"});});
describe("workflow-owned specialist completion",()=>{
 it.each(["review","debate"] as const)("does not run a %s inference after verified or held specialist work",async pattern=>{
  for(const complete of [true,false]){
   const draft=complete?'{"summary":"Actual Critic contribution"}':"Specialist unavailable; held without replay";
   const result=await withReadEvidencePolicy({toolNames:["reader"],inspect:async()=>({complete,message:"actual boundary"})},async()=>{
    if(complete)acceptReadEvidenceContribution(draft);
    const verdict=await reviewCoworkerDraft({userRequest:"Original scope",draft,sensitivity:"internal",pattern});
    expect(verdict).toEqual({content:draft,revised:false});return {content:verdict.content};
   });
   expect(result.content).toBe(draft);expect(routed).not.toHaveBeenCalled();
  }
 });
 it.each(["review","debate"] as const)("retains the normal %s outside a specialist scope",async pattern=>{
  expect(await reviewCoworkerDraft({userRequest:"Explain",draft:"Draft",sensitivity:"internal",pattern})).toEqual({content:"Generic revised prose",revised:true});
  expect(routed).toHaveBeenCalledOnce();expect(routed.mock.calls[0][3]).toMatchObject({taskType:pattern,routingActor:{kind:"system"}});
 });
 it("does not leak a completed specialist scope into a later conversational review",async()=>{
  await withReadEvidencePolicy({toolNames:[],inspect:async()=>({complete:false,message:"held"})},async()=>({content:(await reviewCoworkerDraft({userRequest:"Scope",draft:"Held",sensitivity:"internal"})).content}));
  expect(routed).not.toHaveBeenCalled();
  await reviewCoworkerDraft({userRequest:"New conversation",draft:"Ordinary",sensitivity:"internal"});expect(routed).toHaveBeenCalledOnce();
 });
});
