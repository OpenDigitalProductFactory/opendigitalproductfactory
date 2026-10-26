import {redactDiagnosticEvidenceText} from "../shared/diagnostic-evidence-redaction";
import {AsyncLocalStorage} from "node:async_hooks";
import {createHash} from "node:crypto";
export type ReadEvidenceCheck = {complete:boolean; message:string; code?:string};
export type ReadEvidenceInspection = {
 check:ReadEvidenceCheck;
 original:{text:string|null;sha256:string;bytes:number;truncated:boolean;redacted:boolean};
};
/** Bounded unvalidated model data, retained under the existing task access policy. */
function retainOriginal(content:string):ReadEvidenceInspection["original"] {
 const bytes=Buffer.from(content,"utf8");
 const redacted=redactDiagnosticEvidenceText(content)!==content;
 // Decode only complete UTF-8 characters; re-encoding a split character can exceed the byte limit.
 let end=Math.min(bytes.length,100000);
 while(end>0 && end<bytes.length && (bytes[end]&0xc0)===0x80)end--;
 return {text:redacted?null:bytes.subarray(0,end).toString("utf8"),sha256:createHash("sha256").update(bytes).digest("hex"),bytes:bytes.length,truncated:bytes.length>end,redacted};
}
/** Read-only specialist completion: evidence first, no invented receipt writer. */
export type ReadEvidencePolicy = {
  toolNames: readonly string[];
  recordImageInputDelivery?: import("@/lib/routing/adapter-types").AdapterMcpSession["recordImageInputDelivery"];
  mintReadOnlySession?: () => Promise<string>;
  inspect(content: string): Promise<ReadEvidenceCheck>;
};
export function readEvidenceExit(check: {complete: boolean; message: string}) {
  if (check.complete) return {kind:"complete" as const};
  // The generic native execution-proof producer owns closure/effect attestation.
  // Without qualified proof even a normal native reply cannot authorize replay.
  return {kind:"blocked" as const, message:`Specialist contribution unavailable: ${check.message}. Native execution proof is unavailable; this task is held without replay. Obtain the existing recovery owner's supported finite disposition.`};
}

// Bind the policy to the server-owned execution lifetime, like inference authority.
// This avoids making the shared interactive/autonomous seam a second owner of it.
type ReadEvidenceScope={policy:ReadEvidencePolicy;contribution:string|null;inspection:ReadEvidenceInspection|null;inspecting?:Promise<ReadEvidenceCheck>};
const execution = new AsyncLocalStorage<ReadEvidenceScope>();
export const currentReadEvidencePolicy = () => execution.getStore()?.policy;
export function acceptReadEvidenceContribution(content: string) { const scope = execution.getStore(); if (scope) scope.contribution = content; }
/** Called only at the actual specialist terminal-output boundary. Keep policy identity intact. */
export function inspectReadEvidenceContribution(content:string):Promise<ReadEvidenceCheck> {
 const scope=execution.getStore();
 if(!scope)throw new Error("Read-evidence execution scope is missing");
 return scope.inspecting??=(async()=>{
  const check=await scope.policy.inspect(content);
  scope.inspection={check:{...check},original:retainOriginal(content)};
  return scope.inspection.check;
 })();
}
export async function withReadEvidencePolicy<T extends {content:string}>(policy: ReadEvidencePolicy | undefined, run:()=>Promise<T>): Promise<T & {readEvidenceInspection?:ReadEvidenceInspection}> {
  if (!policy) return run();
  const scope:ReadEvidenceScope={policy,contribution:null,inspection:null};
  return execution.run(scope,async()=>{
    const result = await run();
    return {...result,...(scope.contribution===null?{}:{content:scope.contribution}),
      ...(scope.inspection?{readEvidenceInspection:scope.inspection}:{})};
  });
}
