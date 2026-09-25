// The one-shot `docker run` for the dpf-doctools engine (BI-52E565DA, slice S2
// of BI-815D40C6). Pure, like buildPromoterCommand
// (apps/web/lib/self-upgrade/promoter.ts): every containment decision is in the
// argv this returns, so a unit test can hold all of them.
//
// Containment rests on the container, not on the parser (design §Security): no
// network, a read-only root with a size-capped /tmp, no host mounts, every
// capability dropped, no-new-privileges, a non-root user, memory and pid
// limits. Input and output travel over stdin and stdout only, so host-path and
// named-volume differences between install shapes never matter.

import {
  CONVERTER_SOURCE_EXTENSIONS,
  isConverterTarget,
  normalizeSourceExtension,
  type ConverterTarget,
} from "./formats";

/** The non-root user Dockerfile.doctools creates (`USER 10001:10001`). */
export const CONVERTER_CONTAINER_UID = 10001;
export const CONVERTER_CONTAINER_PREFIX = "dpf-doctools-";
export const CONVERTER_MEMORY_LIMIT = "1g";
export const CONVERTER_PIDS_LIMIT = 256;
export const CONVERTER_TMPFS = "/tmp:rw,noexec,nosuid,size=512m";

// name[:tag]@sha256:<64 hex>, or a bare content-addressed image id. The name
// must start with an alphanumeric so it can never be read as a docker flag.
const PINNED_REFERENCE = /^[a-z0-9][a-z0-9._/-]*(?::[0-9]+\/[a-z0-9._/-]+)?(?::[A-Za-z0-9_][A-Za-z0-9._-]{0,127})?@sha256:[a-f0-9]{64}$/;
const IMAGE_ID = /^sha256:[a-f0-9]{64}$/;
const CONTAINER_NAME = /^dpf-doctools-[a-z0-9]{8,64}$/;

/** True when `image` names exact bytes: `name@sha256:…` or `sha256:…`. */
export function isPinnedImageReference(image: string): boolean {
  return PINNED_REFERENCE.test(image) || IMAGE_ID.test(image);
}

export type ConverterCommandParams = {
  /** Digest-pinned dpf-doctools reference. A tag alone is refused. */
  image: string;
  /** `dpf-doctools-<id>`; the kill path removes the container by this name. */
  containerName: string;
  to: ConverterTarget;
  /** Source type hint; LibreOffice still detects the type from the content. */
  from?: string;
  /** Passed to dpf-convert as DPF_CONVERT_MAX_BYTES (its exit 4). */
  maxInputBytes: number;
  /** Passed as DPF_CONVERT_TIMEOUT_SECONDS: the engine stops itself (exit 124) before the portal's budget kills the container. */
  engineTimeoutSeconds: number;
};

export function buildConverterCommand(params: ConverterCommandParams): { command: string; args: string[] } {
  if (!isPinnedImageReference(params.image)) {
    throw new Error(`converter image must be pinned by digest (name@sha256:…): ${params.image || "<empty>"}`);
  }
  if (!CONTAINER_NAME.test(params.containerName)) {
    throw new Error(`invalid converter container name: ${params.containerName}`);
  }
  if (!isConverterTarget(params.to)) {
    throw new Error(`unsupported --to: ${String(params.to)}`);
  }
  const from = params.from === undefined ? undefined : normalizeSourceExtension(params.from);
  if (from !== undefined && !CONVERTER_SOURCE_EXTENSIONS.has(from)) {
    throw new Error(`unsupported --from: ${params.from}`);
  }
  if (!Number.isInteger(params.maxInputBytes) || params.maxInputBytes <= 0) {
    throw new Error("maxInputBytes must be a positive integer");
  }
  if (!Number.isInteger(params.engineTimeoutSeconds) || params.engineTimeoutSeconds <= 0) {
    throw new Error("engineTimeoutSeconds must be a positive integer");
  }

  const args = [
    "run",
    "--rm",
    // stdin carries the document in; stdout carries the result out.
    "-i",
    "--name",
    params.containerName,
    "--network",
    "none",
    "--read-only",
    "--tmpfs",
    CONVERTER_TMPFS,
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--user",
    `${CONVERTER_CONTAINER_UID}:${CONVERTER_CONTAINER_UID}`,
    "--memory",
    CONVERTER_MEMORY_LIMIT,
    // Equal to --memory: no swap on top of the memory limit.
    "--memory-swap",
    CONVERTER_MEMORY_LIMIT,
    "--pids-limit",
    String(CONVERTER_PIDS_LIMIT),
    "-e",
    `DPF_CONVERT_MAX_BYTES=${params.maxInputBytes}`,
    "-e",
    `DPF_CONVERT_TIMEOUT_SECONDS=${params.engineTimeoutSeconds}`,
    params.image,
    // The image's ENTRYPOINT is dpf-convert; these are its arguments.
    "--to",
    params.to,
  ];
  if (from !== undefined) args.push("--from", from);
  return { command: "docker", args };
}
