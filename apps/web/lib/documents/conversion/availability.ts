// Is the document converter usable on this install? (BI-52E565DA)
//
// An honest answer has three shapes, and the difference matters to alerting:
//   - ready: docker answers and the pinned dpf-doctools image is present;
//   - unavailable BY DESIGN: the install has no docker socket, or no image is
//     configured. Ingestion degrades to the S0 typed-unsupported result, and the
//     dependency gauge stays unset, because a permanent 0 would read as an
//     outage of something this install never had (the dpf-stt lesson, PR #5290);
//   - unavailable as a FAULT: the daemon is unreachable, the image is missing,
//     or the configured image is not pinned.
// The answer is cached for 60 s so health pages and batch ingestion do not
// spawn `docker` on every call.

import { existsSync } from "node:fs";
import {
  runProcessWithBudget,
  type BudgetedProcessOptions,
  type BudgetedProcessResult,
} from "@/lib/shared/run-process-with-budget";
import { resolveDoctoolsImage, type DoctoolsImageResolution } from "./image";

export const CONVERTER_AVAILABILITY_TTL_MS = 60_000;
const DOCKER_PROBE_TIMEOUT_MS = 5_000;
const DOCKER_SOCKET_PATH = "/var/run/docker.sock";

export type ConverterAvailabilityStatus =
  | "ready"
  | "no-docker-socket"
  | "not-configured"
  | "image-unpinned"
  | "docker-unreachable"
  | "image-missing";

export type ConverterAvailability = {
  available: boolean;
  status: ConverterAvailabilityStatus;
  /** True when the converter is absent on purpose; never an alert. */
  byDesign: boolean;
  image: string | null;
  detail: string;
  checkedAt: Date;
};

export type AvailabilityDeps = {
  resolveImage: () => Promise<DoctoolsImageResolution>;
  dockerSocketPresent: () => boolean;
  run: (command: string, args: string[], opts: BudgetedProcessOptions) => Promise<BudgetedProcessResult>;
  now: () => number;
};

/**
 * The portal reaches docker through DOCKER_HOST or the socket compose mounts at
 * /var/run/docker.sock. A host shell on Windows reaches Docker Desktop through
 * a named pipe, which has no file to test, so win32 counts as present and the
 * probe below decides.
 */
function defaultDockerSocketPresent(): boolean {
  if (process.env.DOCKER_HOST?.trim()) return true;
  if (process.platform === "win32") return true;
  return existsSync(DOCKER_SOCKET_PATH);
}

const defaultDeps = (): AvailabilityDeps => ({
  resolveImage: () => resolveDoctoolsImage(),
  dockerSocketPresent: defaultDockerSocketPresent,
  run: runProcessWithBudget,
  now: Date.now,
});

async function exitCodeOf(deps: AvailabilityDeps, args: string[]): Promise<number> {
  try {
    return (await deps.run("docker", args, { timeoutMs: DOCKER_PROBE_TIMEOUT_MS, timeoutLabel: "converter-probe-timeout" })).exitCode;
  } catch {
    return 127;
  }
}

async function check(deps: AvailabilityDeps): Promise<Omit<ConverterAvailability, "checkedAt">> {
  if (!deps.dockerSocketPresent()) {
    return { available: false, status: "no-docker-socket", byDesign: true, image: null, detail: "this install has no docker socket; office conversion is off by design" };
  }
  const resolution = await deps.resolveImage();
  if (resolution.status === "not-configured") {
    return { available: false, status: "not-configured", byDesign: true, image: null, detail: "no dpf-doctools image is configured; office conversion is off" };
  }
  if (resolution.status === "unpinned") {
    return { available: false, status: "image-unpinned", byDesign: false, image: resolution.image, detail: "the configured dpf-doctools image is not pinned by digest" };
  }
  const image = resolution.image;
  if ((await exitCodeOf(deps, ["image", "inspect", "--format", "{{.Id}}", image])) === 0) {
    return { available: true, status: "ready", byDesign: false, image, detail: "docker answers and the pinned image is present" };
  }
  if ((await exitCodeOf(deps, ["version", "--format", "{{.Server.Version}}"])) === 0) {
    return { available: false, status: "image-missing", byDesign: false, image, detail: "docker answers but the pinned dpf-doctools image is not present locally; a conversion will try to pull it by digest" };
  }
  return { available: false, status: "docker-unreachable", byDesign: false, image, detail: "the docker daemon did not answer" };
}

export type ConverterAvailabilityProbe = {
  get(): Promise<ConverterAvailability>;
  /** For dpf_dependency_up: null = not applicable on this install. */
  dependencyUp(): Promise<boolean | null>;
};

export function createConverterAvailabilityProbe(deps: AvailabilityDeps = defaultDeps()): ConverterAvailabilityProbe {
  let cached: { value: ConverterAvailability; at: number } | undefined;
  let inFlight: Promise<ConverterAvailability> | undefined;

  const get = async (): Promise<ConverterAvailability> => {
    const now = deps.now();
    if (cached && now - cached.at < CONVERTER_AVAILABILITY_TTL_MS) return cached.value;
    inFlight ??= check(deps)
      .then((result) => {
        const value = { ...result, checkedAt: new Date(now) };
        cached = { value, at: now };
        return value;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  };

  return {
    get,
    async dependencyUp() {
      const availability = await get();
      return availability.byDesign ? null : availability.available;
    },
  };
}

let processProbe: ConverterAvailabilityProbe | undefined;
const probe = () => (processProbe ??= createConverterAvailabilityProbe());

/** Cached (60 s) answer to "can this install convert office documents now?". */
export function getConverterAvailability(): Promise<ConverterAvailability> {
  return probe().get();
}

/** The converter's entry in the optional-dependency health probes. */
export function probeDoctools(): Promise<boolean | null> {
  return probe().dependencyUp();
}
