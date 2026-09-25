import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LOCAL_DOCTOOLS_TAG,
  buildLocalDoctoolsImage,
  loadSourceLineageContext,
  parseBuiltImageId,
  releaseTagFromPlatformVersion,
} from "./doctools-source-lineage";
import { parseStoredReleaseDoctoolsImage } from "./doctools-release-image";

const IMAGE_ID = `sha256:${"d".repeat(64)}`;

describe("releaseTagFromPlatformVersion (BI-4E18BC28)", () => {
  it("reads the release tag a source build descends from out of its baked git describe", () => {
    expect(releaseTagFromPlatformVersion("2026.09.25-shape-raise.1-35-gbcaa30a8")).toBe("v2026.09.25-shape-raise.1");
    expect(releaseTagFromPlatformVersion("5.6.0-35-gbcaa30a8")).toBe("v5.6.0");
  });

  it("accepts a build exactly on a tag, with or without the leading v", () => {
    expect(releaseTagFromPlatformVersion("2026.09.25-shape-raise.1")).toBe("v2026.09.25-shape-raise.1");
    expect(releaseTagFromPlatformVersion("v2026.08.21")).toBe("v2026.08.21");
  });

  it("ignores a dirty marker", () => {
    expect(releaseTagFromPlatformVersion("2026.08.21-3-g0123abc-dirty")).toBe("v2026.08.21");
  });

  it("refuses a build with no reachable release tag", () => {
    expect(releaseTagFromPlatformVersion("bcaa30a8")).toBeNull();
    expect(releaseTagFromPlatformVersion("latest")).toBeNull();
    expect(releaseTagFromPlatformVersion("")).toBeNull();
    expect(releaseTagFromPlatformVersion(null)).toBeNull();
  });
});

describe("loadSourceLineageContext", () => {
  it("combines the baked lineage with the install's registry owner and clone mount", async () => {
    const context = await loadSourceLineageContext({
      hostSourcePath: "/host-dpf/",
      readPlatformVersion: async () => "2026.09.25-shape-raise.1-35-gbcaa30a8",
      env: { GHCR_OWNER: "opendigitalproductfactory" },
    });
    expect(context).toEqual({
      imageTag: "v2026.09.25-shape-raise.1",
      ghcrOwner: "opendigitalproductfactory",
      sourceRoot: "/host-dpf",
    });
  });

  it("returns null without an owner, a version, or a readable version", async () => {
    const version = async () => "2026.08.21";
    expect(await loadSourceLineageContext({ hostSourcePath: "/h", readPlatformVersion: version, env: {} })).toBeNull();
    expect(
      await loadSourceLineageContext({ hostSourcePath: "/h", readPlatformVersion: async () => null, env: { GHCR_OWNER: "o" } }),
    ).toBeNull();
    expect(
      await loadSourceLineageContext({
        hostSourcePath: "/h",
        readPlatformVersion: async () => {
          throw new Error("EACCES");
        },
        env: { GHCR_OWNER: "o" },
      }),
    ).toBeNull();
  });
});

describe("parseBuiltImageId", () => {
  it("reads the image id `docker build --quiet` prints last", () => {
    expect(parseBuiltImageId(`${IMAGE_ID}\n`)).toBe(IMAGE_ID);
    expect(parseBuiltImageId(`#1 building\r\n${IMAGE_ID}`)).toBe(IMAGE_ID);
    expect(parseBuiltImageId("sha256:abc")).toBeNull();
    expect(parseBuiltImageId("")).toBeNull();
  });
});

describe("the stored pin records where it came from", () => {
  it("keeps a local-build origin and drops an unknown one", () => {
    expect(parseStoredReleaseDoctoolsImage({ image: IMAGE_ID, releaseTag: "v2026.08.21", origin: "local-build" })).toEqual({
      image: IMAGE_ID,
      releaseTag: "v2026.08.21",
      origin: "local-build",
    });
    expect(parseStoredReleaseDoctoolsImage({ image: IMAGE_ID, releaseTag: "v2026.08.21", origin: "x" })).toEqual({
      image: IMAGE_ID,
      releaseTag: "v2026.08.21",
    });
  });
});

describe("buildLocalDoctoolsImage", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function clone(withDockerfile = true): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "dpf-s9a-clone-"));
    dirs.push(root);
    if (withDockerfile) await writeFile(join(root, "Dockerfile.doctools"), "FROM scratch\n");
    await mkdir(join(root, "tools", "doctools", "fixtures"), { recursive: true });
    await writeFile(join(root, "tools", "doctools", "dpf-convert"), "#!/bin/sh\n");
    await writeFile(join(root, "tools", "doctools", "fixtures", "a.fodt"), "<x/>");
    await mkdir(join(root, "node_modules"), { recursive: true });
    await writeFile(join(root, "node_modules", "big"), "x");
    return root;
  }

  it("builds from a scratch context holding only the Dockerfile and tools/doctools, and removes it", async () => {
    const root = await clone();
    const scratchRoot = await mkdtemp(join(tmpdir(), "dpf-s9a-scratch-"));
    dirs.push(scratchRoot);
    let seen: { args: string[]; context: string[]; tools: string[] } | undefined;
    const result = await buildLocalDoctoolsImage({
      sourceRoot: root,
      imageTag: "v2026.08.21",
      scratchRoot,
      runDocker: async (args) => {
        const context = args.at(-1) as string;
        seen = { args, context: (await readdir(context)).sort(), tools: (await readdir(join(context, "tools", "doctools"))).sort() };
        return { exitCode: 0, stdout: `${IMAGE_ID}\n`, stderr: "" };
      },
    });
    expect(result).toEqual({ ok: true, image: IMAGE_ID });
    expect(seen?.context).toEqual(["Dockerfile.doctools", "tools"]);
    expect(seen?.tools).toEqual(["dpf-convert", "fixtures"]);
    expect(seen?.args).toEqual(
      expect.arrayContaining(["build", "--quiet", "--build-arg", "DPF_VERSION=v2026.08.21", "--tag", LOCAL_DOCTOOLS_TAG]),
    );
    expect(await readdir(scratchRoot)).toEqual([]);
  });

  it("refuses a clone without Dockerfile.doctools, without calling docker", async () => {
    const root = await clone(false);
    let called = false;
    const result = await buildLocalDoctoolsImage({
      sourceRoot: root,
      imageTag: "v2026.08.21",
      runDocker: async () => {
        called = true;
        return { exitCode: 0, stdout: IMAGE_ID, stderr: "" };
      },
    });
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  it("reports a failed or silent build, and still cleans up", async () => {
    const root = await clone();
    const scratchRoot = await mkdtemp(join(tmpdir(), "dpf-s9a-scratch-"));
    dirs.push(scratchRoot);
    const failed = await buildLocalDoctoolsImage({
      sourceRoot: root,
      imageTag: "v2026.08.21",
      scratchRoot,
      runDocker: async () => ({ exitCode: 1, stdout: "", stderr: "failed to resolve debian:trixie-slim" }),
    });
    expect(failed).toEqual({ ok: false, detail: "failed to resolve debian:trixie-slim" });
    const silent = await buildLocalDoctoolsImage({
      sourceRoot: root,
      imageTag: "v2026.08.21",
      scratchRoot,
      runDocker: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    });
    expect(silent.ok).toBe(false);
    expect(existsSync(scratchRoot) && (await readdir(scratchRoot)).length).toBe(0);
  });
});
