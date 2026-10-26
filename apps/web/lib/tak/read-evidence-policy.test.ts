import {describe,it,expect} from "vitest";
import {readEvidenceExit,withReadEvidencePolicy,acceptReadEvidenceContribution,currentReadEvidencePolicy} from "./read-evidence-policy";
describe("read evidence completion",()=>{
 it("holds incomplete evidence without another provider dispatch or invented proof",()=>{
  expect(readEvidenceExit({complete:false,message:"missing pinned artifact page"})).toMatchObject({kind:"blocked",message:expect.stringContaining("held without replay")});
 });
 it("completes without a writer only on verified read contribution",()=>expect(readEvidenceExit({complete:true,message:"verified"})).toEqual({kind:"complete"}));
});

it("retains actual verified specialist JSON across generic conversational editing",async()=>{
 const actual='{"summary":"actual specialist"}';const policy={toolNames:["reader"],inspect:async()=>({complete:true,message:"verified"})};
 const result=await withReadEvidencePolicy(policy,async()=>{acceptReadEvidenceContribution(actual);return {content:"generic rewritten prose"};});
 expect(result.content).toBe(actual);expect(currentReadEvidencePolicy()).toBeUndefined();
});
it("keeps simultaneous specialist execution scopes separate",async()=>{
 const run=(name:string)=>withReadEvidencePolicy({toolNames:[name],inspect:async()=>({complete:true,message:name})},async()=>{await Promise.resolve();expect(currentReadEvidencePolicy()?.toolNames).toEqual([name]);acceptReadEvidenceContribution(name);return {content:"edited"};});
 expect(await Promise.all([run("a"),run("b")])).toEqual([{content:"a"},{content:"b"}]);
});
