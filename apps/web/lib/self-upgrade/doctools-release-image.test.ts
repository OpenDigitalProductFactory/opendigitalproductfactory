import { describe, expect, it, vi } from "vitest";
import {
  doctoolsReleaseReference,
  parseImagetoolsDigest,
  parseStoredReleaseDoctoolsImage,
  reconcileReleaseDoctoolsImage,
  resolveReleaseDoctoolsImage,
  type DoctoolsReconcileDeps,
  type StoredReleaseDoctoolsImage,
} from "./doctools-release-image";
import type { ReleaseInstallContext } from "./release-target";
import type { LocalDoctoolsBuildResult, SourceLineageContext } from "./doctools-source-lineage";

const DIGEST = `sha256:${"a".repeat(64)}`;
const OLD_DIGEST = `sha256:${"b".repeat(64)}`;
const TAG = "v2026.09.25-office.1";
const PINNED = `ghcr.io/opendigitalproductfactory/dpf-doctools@${DIGEST}`;

const CONTEXT: ReleaseInstallContext = Object.freeze({
  installMode: "consumer",
  imageTag: TAG,
  channelTag: "latest",
  installPath: "/workspace",
  composeFiles: ["docker-compose.yml", "docker-compose.release.yml"],
  ghcrOwner: "OpenDigitalProductFactory",
});

type DockerCall = string[];
type DockerReply = { exitCode: number; stdout?: string; stderr?: string };

function fakeDocker(replies: (args: string[]) => DockerReply) {
  const calls: DockerCall[] = [];
  const run = async (args: string[]) => {
    calls.push(args);
    const reply = replies(args);
    return { exitCode: reply.exitCode, stdout: reply.stdout ?? "", stderr: reply.stderr ?? "" };
  };
  return { run, calls };
}

// What publish-image.yml's "Record the published manifest digest" step reads:
// `docker buildx imagetools inspect <ref> --format '{{json .Manifest}}'`.
const manifestJson = (digest: string) =>
  JSON.stringify({ mediaType: "application/vnd.oci.image.index.v1+json", digest, size: 1609 });

function harness(opts: {
  context?: ReleaseInstallContext | null;
  stored?: StoredReleaseDoctoolsImage | null;
  docker: (args: string[]) => DockerReply;
}) {
  let stored = opts.stored ?? null;
  const docker = fakeDocker(opts.docker);
  const writes: StoredReleaseDoctoolsImage[] = [];
  let cleared = 0;
  const deps: DoctoolsReconcileDeps = {
    loadContext: async () => (opts.context === undefined ? CONTEXT : opts.context),
    readStored: async () => stored,
    writeStored: async (value) => {
      writes.push(value);
      stored = value;
    },
    clearStored: async () => {
      cleared += 1;
      stored = null;
    },
    runDocker: docker.run,
    now: () => new Date("2026-09-25T06:00:00.000Z"),
    logger: { log: vi.fn(), warn: vi.fn() },
  };
  return { deps, docker, writes, cleared: () => cleared, stored: () => stored };
}

describe("doctoolsReleaseReference (BI-9A2EC54A)", () => {
  it("mirrors the promoter's release reference: ghcr.io/<owner>/<image>:<immutable tag>", () => {
    expect(doctoolsReleaseReference(CONTEXT)).toBe(`ghcr.io/opendigitalproductfactory/dpf-doctools:${TAG}`);
  });

  it("refuses a moving channel tag, so the pin always names one release", () => {
    expect(doctoolsReleaseReference({ ...CONTEXT, imageTag: "latest" })).toBeNull();
    expect(doctoolsReleaseReference({ ...CONTEXT, imageTag: "v1.2" })).toBeNull();
  });

  it("refuses an owner that is not a registry namespace", () => {
    expect(doctoolsReleaseReference({ ...CONTEXT, ghcrOwner: "--config=/x" })).toBeNull();
  });
});

describe("parseImagetoolsDigest", () => {
  it("reads the manifest digest publish-image.yml records", () => {
    expect(parseImagetoolsDigest(manifestJson(DIGEST))).toBe(DIGEST);
  });

  it("rejects anything that is not a sha256 content digest", () => {
    expect(parseImagetoolsDigest("")).toBeNull();
    expect(parseImagetoolsDigest("not json")).toBeNull();
    expect(parseImagetoolsDigest(JSON.stringify({ digest: "sha256:abc" }))).toBeNull();
  });
});

describe("resolveReleaseDoctoolsImage", () => {
  it("pins the release tag's digest as name@sha256 (AC-1)", async () => {
    const docker = fakeDocker(() => ({ exitCode: 0, stdout: manifestJson(DIGEST) }));
    expect(await resolveReleaseDoctoolsImage(CONTEXT, docker.run)).toEqual({ kind: "published", image: PINNED });
    expect(docker.calls).toEqual([
      ["buildx", "imagetools", "inspect", `ghcr.io/opendigitalproductfactory/dpf-doctools:${TAG}`, "--format", "{{json .Manifest}}"],
    ]);
  });

  it("reports not-published when the release has no dpf-doctools manifest (AC-3)", async () => {
    const docker = fakeDocker(() => ({
      exitCode: 1,
      stderr: `ERROR: ghcr.io/opendigitalproductfactory/dpf-doctools:${TAG}: not found`,
    }));
    expect(await resolveReleaseDoctoolsImage(CONTEXT, docker.run)).toEqual({ kind: "not-published" });
  });

  it("reports unavailable, not not-published, when the registry cannot answer", async () => {
    const docker = fakeDocker(() => ({ exitCode: 1, stderr: "dial tcp: lookup ghcr.io: no such host" }));
    expect(await resolveReleaseDoctoolsImage(CONTEXT, docker.run)).toMatchObject({ kind: "unavailable" });
  });

  it("reports unavailable when docker cannot be spawned", async () => {
    const run = async () => {
      throw new Error("spawn docker ENOENT");
    };
    expect(await resolveReleaseDoctoolsImage(CONTEXT, run)).toMatchObject({ kind: "unavailable" });
  });
});

describe("parseStoredReleaseDoctoolsImage", () => {
  it("accepts only a pinned image with its release tag", () => {
    expect(parseStoredReleaseDoctoolsImage({ image: PINNED, releaseTag: TAG, resolvedAt: "x" })).toEqual({
      image: PINNED,
      releaseTag: TAG,
      resolvedAt: "x",
    });
    expect(parseStoredReleaseDoctoolsImage({ image: "ghcr.io/o/dpf-doctools:v1.0.0", releaseTag: TAG })).toBeNull();
    expect(parseStoredReleaseDoctoolsImage({ image: PINNED })).toBeNull();
    expect(parseStoredReleaseDoctoolsImage(null)).toBeNull();
  });
});

describe("reconcileReleaseDoctoolsImage", () => {
  const present = (args: string[]) => args[0] === "image" && args[1] === "inspect";
  const inspectTag = (args: string[]) => args[0] === "buildx";

  it("does nothing on a source install (no release context): the dev override path is untouched", async () => {
    const h = harness({ context: null, docker: () => ({ exitCode: 0 }) });
    expect(await reconcileReleaseDoctoolsImage(h.deps)).toEqual({ outcome: "not-release-install" });
    expect(h.docker.calls).toEqual([]);
    expect(h.writes).toEqual([]);
    expect(h.cleared()).toBe(0);
  });

  it("does nothing on a release install that tracks a moving tag", async () => {
    const h = harness({ context: { ...CONTEXT, imageTag: "latest" }, docker: () => ({ exitCode: 0 }) });
    expect(await reconcileReleaseDoctoolsImage(h.deps)).toEqual({ outcome: "not-release-install" });
    expect(h.docker.calls).toEqual([]);
  });

  it("first boot of a release: resolves, records the pin with its tag, then pulls it by digest", async () => {
    const h = harness({
      docker: (args) => {
        if (inspectTag(args)) return { exitCode: 0, stdout: manifestJson(DIGEST) };
        if (present(args)) return { exitCode: 1, stderr: "No such image" };
        return { exitCode: 0 };
      },
    });
    expect(await reconcileReleaseDoctoolsImage(h.deps)).toEqual({ outcome: "resolved", image: PINNED, pulled: true });
    expect(h.writes).toEqual([{ image: PINNED, releaseTag: TAG, resolvedAt: "2026-09-25T06:00:00.000Z", origin: "published" }]);
    // The pull targets the digest, never the tag, so the bytes are the recorded ones.
    expect(h.docker.calls.at(-1)).toEqual(["pull", PINNED]);
  });

  it("after a self-upgrade to a new tag, replaces the previous release's pin (AC-1)", async () => {
    const h = harness({
      stored: {
        image: `ghcr.io/opendigitalproductfactory/dpf-doctools@${OLD_DIGEST}`,
        releaseTag: "v2026.09.20-previous.1",
        resolvedAt: "2026-09-20T00:00:00.000Z",
      },
      docker: (args) => (inspectTag(args) ? { exitCode: 0, stdout: manifestJson(DIGEST) } : { exitCode: 0 }),
    });
    expect(await reconcileReleaseDoctoolsImage(h.deps)).toMatchObject({ outcome: "resolved", image: PINNED });
    expect(h.stored()?.image).toBe(PINNED);
    expect(h.stored()?.releaseTag).toBe(TAG);
  });

  it("a later tick for the same tag does not re-query the registry, and skips the pull when the image is present", async () => {
    const h = harness({
      stored: { image: PINNED, releaseTag: TAG, resolvedAt: "2026-09-25T05:00:00.000Z" },
      docker: () => ({ exitCode: 0 }),
    });
    expect(await reconcileReleaseDoctoolsImage(h.deps)).toEqual({ outcome: "unchanged", image: PINNED, pulled: false });
    expect(h.docker.calls).toEqual([["image", "inspect", "--format", "{{.Id}}", PINNED]]);
    expect(h.writes).toEqual([]);
  });

  it("a later tick retries a pull that did not land earlier", async () => {
    const h = harness({
      stored: { image: PINNED, releaseTag: TAG, resolvedAt: "2026-09-25T05:00:00.000Z" },
      docker: (args) => (present(args) ? { exitCode: 1 } : { exitCode: 0 }),
    });
    expect(await reconcileReleaseDoctoolsImage(h.deps)).toEqual({ outcome: "unchanged", image: PINNED, pulled: true });
    expect(h.docker.calls.at(-1)).toEqual(["pull", PINNED]);
  });

  it("a failed pull keeps the pin (a conversion can still pull it) and does not throw", async () => {
    const h = harness({
      docker: (args) => {
        if (inspectTag(args)) return { exitCode: 0, stdout: manifestJson(DIGEST) };
        return { exitCode: 1, stderr: "toomanyrequests" };
      },
    });
    expect(await reconcileReleaseDoctoolsImage(h.deps)).toEqual({ outcome: "resolved", image: PINNED, pulled: false });
    expect(h.stored()?.image).toBe(PINNED);
  });

  it("a release that did not publish dpf-doctools leaves the key unset, and nothing fails (AC-3)", async () => {
    const h = harness({
      stored: {
        image: `ghcr.io/opendigitalproductfactory/dpf-doctools@${OLD_DIGEST}`,
        releaseTag: "v2026.09.20-previous.1",
        resolvedAt: "2026-09-20T00:00:00.000Z",
      },
      docker: () => ({ exitCode: 1, stderr: "ERROR: manifest unknown" }),
    });
    expect(await reconcileReleaseDoctoolsImage(h.deps)).toEqual({ outcome: "not-published" });
    expect(h.cleared()).toBe(1);
    expect(h.stored()).toBeNull();
    expect(h.docker.calls.some((args) => args[0] === "pull")).toBe(false);
  });

  it("an unreachable registry keeps the prior pin for the next tick to retry", async () => {
    const prior = {
      image: `ghcr.io/opendigitalproductfactory/dpf-doctools@${OLD_DIGEST}`,
      releaseTag: "v2026.09.20-previous.1",
      resolvedAt: "2026-09-20T00:00:00.000Z",
    };
    const h = harness({ stored: prior, docker: () => ({ exitCode: 1, stderr: "i/o timeout" }) });
    expect(await reconcileReleaseDoctoolsImage(h.deps)).toMatchObject({ outcome: "unavailable" });
    expect(h.cleared()).toBe(0);
    expect(h.stored()).toEqual(prior);
  });

  it("never throws: a database failure is reported as an outcome", async () => {
    const h = harness({ docker: () => ({ exitCode: 0, stdout: manifestJson(DIGEST) }) });
    h.deps.readStored = async () => {
      throw new Error("db down");
    };
    expect(await reconcileReleaseDoctoolsImage(h.deps)).toMatchObject({ outcome: "error" });
  });
});

describe("reconcileReleaseDoctoolsImage on a customizable, source-built install (BI-4E18BC28)", () => {
  const present = (args: string[]) => args[0] === "image" && args[1] === "inspect";
  const inspectTag = (args: string[]) => args[0] === "buildx";
  const LINEAGE_TAG = "v2026.09.25-shape-raise.1";
  const LINEAGE_PINNED = `ghcr.io/opendigitalproductfactory/dpf-doctools@${DIGEST}`;
  const LOCAL_ID = `sha256:${"c".repeat(64)}`;
  const LINEAGE: SourceLineageContext = Object.freeze({
    imageTag: LINEAGE_TAG,
    ghcrOwner: "opendigitalproductfactory",
    sourceRoot: "/host-dpf",
  });

  function sourceHarness(opts: {
    stored?: StoredReleaseDoctoolsImage | null;
    docker: (args: string[]) => DockerReply;
    build?: () => Promise<LocalDoctoolsBuildResult>;
  }) {
    const h = harness({ context: null, stored: opts.stored, docker: opts.docker });
    const builds: SourceLineageContext[] = [];
    h.deps.loadSourceLineage = async () => LINEAGE;
    h.deps.buildLocal = async (lineage) => {
      builds.push(lineage);
      return opts.build ? opts.build() : { ok: true, data: LOCAL_ID };
    };
    return { ...h, builds };
  }

  it("pins the PUBLISHED image of the release the clone descends from, by digest, and pulls it (AC-1)", async () => {
    const h = sourceHarness({
      docker: (args) => {
        if (inspectTag(args)) return { exitCode: 0, stdout: manifestJson(DIGEST) };
        if (present(args)) return { exitCode: 1, stderr: "No such image" };
        return { exitCode: 0 };
      },
    });
    expect(await reconcileReleaseDoctoolsImage(h.deps)).toEqual({ outcome: "resolved", image: LINEAGE_PINNED, pulled: true });
    expect(h.docker.calls[0]).toEqual([
      "buildx", "imagetools", "inspect", `ghcr.io/opendigitalproductfactory/dpf-doctools:${LINEAGE_TAG}`, "--format", "{{json .Manifest}}",
    ]);
    expect(h.writes).toEqual([
      { image: LINEAGE_PINNED, releaseTag: LINEAGE_TAG, resolvedAt: "2026-09-25T06:00:00.000Z", origin: "published" },
    ]);
    expect(h.builds).toEqual([]);
  });

  it("offline: builds Dockerfile.doctools from the clone and pins the local image id", async () => {
    const h = sourceHarness({ docker: () => ({ exitCode: 1, stderr: "dial tcp: lookup ghcr.io: no such host" }) });
    expect(await reconcileReleaseDoctoolsImage(h.deps)).toEqual({ outcome: "built-locally", image: LOCAL_ID });
    expect(h.builds).toEqual([LINEAGE]);
    expect(h.stored()).toEqual({ image: LOCAL_ID, releaseTag: LINEAGE_TAG, resolvedAt: "2026-09-25T06:00:00.000Z", origin: "local-build" });
  });

  it("a lineage whose release published no dpf-doctools also builds locally", async () => {
    const h = sourceHarness({ docker: () => ({ exitCode: 1, stderr: "ERROR: manifest unknown" }) });
    expect(await reconcileReleaseDoctoolsImage(h.deps)).toEqual({ outcome: "built-locally", image: LOCAL_ID });
  });

  it("a failed local build leaves conversion off without throwing, and keeps no stale pin", async () => {
    const h = sourceHarness({
      docker: () => ({ exitCode: 1, stderr: "i/o timeout" }),
      build: async () => ({ ok: false, error: "no base image offline" }),
    });
    expect(await reconcileReleaseDoctoolsImage(h.deps)).toMatchObject({ outcome: "unavailable" });
    expect(h.writes).toEqual([]);
  });

  it("a local pin is replaced by the published one once the registry is reachable", async () => {
    const h = sourceHarness({
      stored: { image: LOCAL_ID, releaseTag: LINEAGE_TAG, origin: "local-build" },
      docker: (args) => (inspectTag(args) ? { exitCode: 0, stdout: manifestJson(DIGEST) } : { exitCode: 0 }),
    });
    expect(await reconcileReleaseDoctoolsImage(h.deps)).toMatchObject({ outcome: "resolved", image: LINEAGE_PINNED });
    expect(h.stored()?.origin).toBe("published");
    expect(h.builds).toEqual([]);
  });

  it("a local pin stays while still offline, and is rebuilt only when the image was removed", async () => {
    const kept = sourceHarness({
      stored: { image: LOCAL_ID, releaseTag: LINEAGE_TAG, origin: "local-build" },
      docker: (args) => (present(args) ? { exitCode: 0 } : { exitCode: 1, stderr: "i/o timeout" }),
    });
    expect(await reconcileReleaseDoctoolsImage(kept.deps)).toEqual({ outcome: "unchanged", image: LOCAL_ID, pulled: false });
    expect(kept.builds).toEqual([]);
    expect(kept.docker.calls.some((args) => args[0] === "pull")).toBe(false);

    const removed = sourceHarness({
      stored: { image: LOCAL_ID, releaseTag: LINEAGE_TAG, origin: "local-build" },
      docker: () => ({ exitCode: 1, stderr: "i/o timeout" }),
    });
    expect(await reconcileReleaseDoctoolsImage(removed.deps)).toEqual({ outcome: "built-locally", image: LOCAL_ID });
    expect(removed.builds).toEqual([LINEAGE]);
  });

  it("a source upgrade to a new lineage re-resolves (the setting survives upgrade, AC-2)", async () => {
    const h = sourceHarness({
      stored: { image: `ghcr.io/opendigitalproductfactory/dpf-doctools@${OLD_DIGEST}`, releaseTag: "v2026.09.20-previous.1", origin: "published" },
      docker: (args) => (inspectTag(args) ? { exitCode: 0, stdout: manifestJson(DIGEST) } : { exitCode: 0 }),
    });
    expect(await reconcileReleaseDoctoolsImage(h.deps)).toMatchObject({ outcome: "resolved", image: LINEAGE_PINNED });
    expect(h.stored()?.releaseTag).toBe(LINEAGE_TAG);
  });

  it("a release install never takes the source path, and never builds locally", async () => {
    const h = sourceHarness({ docker: () => ({ exitCode: 1, stderr: "i/o timeout" }) });
    h.deps.loadContext = async () => CONTEXT;
    expect(await reconcileReleaseDoctoolsImage(h.deps)).toMatchObject({ outcome: "unavailable" });
    expect(h.builds).toEqual([]);
  });

  it("an install with no release lineage still does nothing", async () => {
    const h = sourceHarness({ docker: () => ({ exitCode: 0 }) });
    h.deps.loadSourceLineage = async () => null;
    expect(await reconcileReleaseDoctoolsImage(h.deps)).toEqual({ outcome: "not-release-install" });
    expect(h.docker.calls).toEqual([]);
  });
});
