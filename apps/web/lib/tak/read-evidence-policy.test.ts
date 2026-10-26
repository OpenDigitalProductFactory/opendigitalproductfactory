import {describe,it,expect,vi} from "vitest";
import {readEvidenceExit,inspectReadEvidenceContribution,withReadEvidencePolicy,acceptReadEvidenceContribution,currentReadEvidencePolicy} from "./read-evidence-policy";
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

it("retains the first actual rejected response and reason across held prose without a second inspection", async () => {
 const inspect = vi.fn().mockResolvedValueOnce({complete:false,code:"contribution-criteria-invalid",message:"criteria must be a nonempty string array"}).mockResolvedValue({complete:true,message:"conflicting second check"});
 const actual = '{"summary":"real rejected output","criteria":[{"name":"Hierarchy"}]}';
 const result = await withReadEvidencePolicy({toolNames:["reader"],inspect}, async () => {
  await Promise.all([inspectReadEvidenceContribution(actual),inspectReadEvidenceContribution("conflicting later content")]);
  return {content:"Generated hold prose",executedTools:[]};
 });
 expect(result.readEvidenceInspection).toMatchObject({check:{complete:false,code:"contribution-criteria-invalid"},original:{text:actual,truncated:false}});
 const {engagementIncompleteOutcome}=await import("../coworker-service-catalog/engagement-read-completion");
 const hold=await engagementIncompleteOutcome({policy:{toolNames:[],inspect},taskRunId:"TR-original",result,checkpoint:{},flags:{},skip:false});
 expect(inspect).toHaveBeenCalledTimes(1);
 expect(JSON.stringify(hold?.settlement.data.progressPayload)).toContain("contribution-criteria-invalid");
 expect(JSON.stringify(hold?.settlement.data.progressPayload)).toContain("criteria must be a nonempty string array");
 expect(hold?.outcome).toMatchObject({kind:"result",result:{status:"input-required",resumable:false}});
});
it("bounds untrusted rejected output and excludes image data or credential-shaped output",async()=>{
 const run=(text:string)=>withReadEvidencePolicy({toolNames:[],inspect:async()=>({complete:false,message:"invalid"})},async()=>{
  await inspectReadEvidenceContribution(text);return {content:"hold"};
 });
 const bounded=await run("é".repeat(100001));
 expect(Buffer.byteLength(bounded.readEvidenceInspection!.original.text!)).toBeLessThanOrEqual(100000);
 expect(bounded.readEvidenceInspection!.original.truncated).toBe(true);
 expect((await run("data:image/png;base64,private-pixels")).readEvidenceInspection!.original).toMatchObject({text:null,redacted:true});
 expect((await run("Bearer fixture-session-value")).readEvidenceInspection!.original).toMatchObject({text:null,redacted:true});
});

it("excludes native DPF tokens without changing original hash or byte attribution",async()=>{
 const original="Rejected fixture includes "+"dpfmcp_"+"synthetic_fixture_not_a_real_credential";
 const result=await withReadEvidencePolicy({toolNames:[],inspect:async()=>({complete:false,message:"invalid"})},async()=>{
  await inspectReadEvidenceContribution(original);return {content:"hold"};
 });
 expect(result.readEvidenceInspection!.original).toMatchObject({text:null,redacted:true,bytes:Buffer.byteLength(original),sha256:expect.stringMatching(/^[a-f0-9]{64}$/)});
});
