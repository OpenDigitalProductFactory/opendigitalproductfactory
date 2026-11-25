// Release image operations through the private actuator (BI-224F56F1).
//
// The doctools pre-pull and boot reconciler, the runtime-capability service
// image plan and the promoter availability check resolve, inspect and pull a
// few known images. In the qualified portal those Docker calls go to the
// actuator as three fixed operations, each admitted only for the install's own
// registry repositories (ghcr.io/<GHCR_OWNER>/...) or the local promoter, by
// immutable tag or digest. The actuator builds the Docker argv itself; the
// portal's argv is only mapped to an operation name and never forwarded.

import { isRecord } from "@/lib/shared/coerce";

export type DoctoolsImageOperation = "resolve" | "present" | "pull";
export type DoctoolsImageRequest = { operation: DoctoolsImageOperation; reference: string };
type DockerResult = { exitCode: number; stdout: string; stderr: string };

const OWNER = /^[a-z0-9][a-z0-9-]{0,38}$/;
const TAG = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const refuse = (): never => { throw new Error("doctools_image_admission_refused"); };
const tail = (text: string) => text.slice(-8 * 1024);

/** Which operations each of the install's registry repositories admits. */
const REPOSITORIES: Record<string, readonly DoctoolsImageOperation[]> = {
  "dpf-doctools": ["resolve", "present", "pull"],
  "dpf-browser-use": ["resolve"],
  "dpf-promoter": ["present"],
};
/** The locally built promoter, by name, target tag or image ID: presence only. */
const LOCAL_PROMOTER = /^(?:dpf-promoter(?::[a-f0-9]{40})?|sha256:[a-f0-9]{64})$/;

/** An admitted reference for this operation, or a refusal. */
export function admitDoctoolsReference(reference: unknown, ghcrOwner: string | undefined, operation: DoctoolsImageOperation): string {
  if (typeof reference !== "string") return refuse();
  if (operation === "present" && LOCAL_PROMOTER.test(reference)) return reference;
  if (!ghcrOwner || !OWNER.test(ghcrOwner)) return refuse();
  for (const [name, operations] of Object.entries(REPOSITORIES)) {
    const repository = `ghcr.io/${ghcrOwner}/${name}`;
    const tagged = reference.startsWith(`${repository}:`) && TAG.test(reference.slice(repository.length + 1));
    const pinned = reference.startsWith(`${repository}@`) && DIGEST.test(reference.slice(repository.length + 1));
    // Resolution reads a published tag's manifest; presence and pull take either form.
    if (operations.includes(operation) && (operation === "resolve" ? tagged : tagged || pinned)) return reference;
  }
  return refuse();
}

const ARGV: Record<DoctoolsImageOperation, (reference: string) => string[]> = {
  resolve: (reference) => ["buildx", "imagetools", "inspect", reference, "--format", "{{json .Manifest}}"],
  present: (reference) => ["image", "inspect", "--format", "{{.Id}}", reference],
  pull: (reference) => ["pull", reference],
};

/** Actuator side. A refused request never reaches Docker. */
export function createDoctoolsImageOperator(deps: {
  ghcrOwner: string | undefined;
  run: (args: string[], options: { timeoutMs: number; maxStdoutBytes: number }) => Promise<DockerResult>;
}) {
  return async (value: unknown): Promise<DockerResult> => {
    if (!isRecord(value) || Object.keys(value).length !== 2 || typeof value.operation !== "string"
      || !Object.hasOwn(ARGV, value.operation)) return refuse();
    const operation = value.operation as DoctoolsImageOperation;
    const reference = admitDoctoolsReference(value.reference, deps.ghcrOwner, operation);
    const result = await deps.run(ARGV[operation](reference), { timeoutMs: operation === "pull" ? 15 * 60_000 : 60_000, maxStdoutBytes: 64 * 1024 });
    return { exitCode: result.exitCode, stdout: tail(result.stdout), stderr: tail(result.stderr) };
  };
}

/** The portal's argv, recognized as one fixed operation, or null. */
export function doctoolsOperationFor(args: string[]): DoctoolsImageRequest | null {
  for (const operation of Object.keys(ARGV) as DoctoolsImageOperation[]) {
    const reference = operation === "resolve" ? args[3] : operation === "present" ? args[4] : args[1];
    if (typeof reference === "string" && JSON.stringify(ARGV[operation](reference)) === JSON.stringify(args)) return { operation, reference };
  }
  return null;
}

type ActuatorSend = (body: unknown, timeoutMs: number) => Promise<unknown>;

/** Portal side. Null keeps the local runner (no actuator mounted). Any other
 * Docker call is refused in the qualified portal, never run locally. */
export async function doctoolsDockerThroughActuator(args: string[],
  available?: () => Promise<boolean>, send?: ActuatorSend): Promise<DockerResult | null> {
  const observation = await import("@/lib/platform-runtime/actuator-client");
  if (!await (available ?? observation.usesPrivateActuator)()) return null;
  const request = doctoolsOperationFor(args);
  if (!request) return { exitCode: 1, stdout: "", stderr: "This Docker operation is not available in the qualified portal." };
  try {
    const result = await (send ?? ((body, ms) => observation.runActuatorDoctoolsImage(body, { timeoutMs: ms })))(request,
      request.operation === "pull" ? 16 * 60_000 : 2 * 60_000);
    if (isRecord(result) && Number.isInteger(result.exitCode) && typeof result.stdout === "string" && typeof result.stderr === "string") {
      return { exitCode: result.exitCode as number, stdout: result.stdout, stderr: result.stderr };
    }
  } catch { /* reported below */ }
  return { exitCode: 1, stdout: "", stderr: "The private actuator did not confirm the converter image operation." };
}
