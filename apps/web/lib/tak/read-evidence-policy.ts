import {AsyncLocalStorage} from "node:async_hooks";
/** Read-only specialist completion: evidence first, no invented receipt writer. */
export type ReadEvidencePolicy = {
  toolNames: readonly string[];
  recordImageInputDelivery?: import("@/lib/routing/adapter-types").AdapterMcpSession["recordImageInputDelivery"];
  mintReadOnlySession?: () => Promise<string>;
  inspect(content: string): Promise<{complete: boolean; message: string}>;
};
export function readEvidenceExit(check: {complete: boolean; message: string}) {
  if (check.complete) return {kind:"complete" as const};
  // The generic native execution-proof producer owns closure/effect attestation.
  // Without qualified proof even a normal native reply cannot authorize replay.
  return {kind:"blocked" as const, message:`Specialist contribution unavailable: ${check.message}. Native execution proof is unavailable; this task is held without replay. Obtain the existing recovery owner's supported finite disposition.`};
}

// Bind the policy to the server-owned execution lifetime, like inference authority.
// This avoids making the shared interactive/autonomous seam a second owner of it.
const execution = new AsyncLocalStorage<{policy: ReadEvidencePolicy; contribution: string | null}>();
export const currentReadEvidencePolicy = () => execution.getStore()?.policy;
export function acceptReadEvidenceContribution(content: string) { const scope = execution.getStore(); if (scope) scope.contribution = content; }
export async function withReadEvidencePolicy<T extends {content:string}>(policy: ReadEvidencePolicy | undefined, run:()=>Promise<T>): Promise<T> {
  if (!policy) return run();
  const scope = {policy, contribution:null as string|null};
  return execution.run(scope,async()=>{
    const result = await run();
    // Preserve the verified specialist JSON before generic conversational editing.
    return scope.contribution === null ? result : {...result,content:scope.contribution};
  });
}
