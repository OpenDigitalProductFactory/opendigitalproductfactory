import { describe, expect, it } from "vitest";

import { admitDoctoolsReference, createDoctoolsImageOperator, doctoolsDockerThroughActuator, doctoolsOperationFor } from "./doctools-image-actuator";

const owner = "opendigitalproductfactory";
const tagged = `ghcr.io/${owner}/dpf-doctools:v2026.11.25-release.1`;
const pinned = `ghcr.io/${owner}/dpf-doctools@sha256:${"a".repeat(64)}`;

describe("admitDoctoolsReference", () => {
  it("admits only the install's own converter repository, by immutable tag or digest", () => {
    expect(admitDoctoolsReference(tagged, owner, "resolve")).toBe(tagged);
    expect(admitDoctoolsReference(pinned, owner, "pull")).toBe(pinned);
    expect(admitDoctoolsReference(tagged, owner, "present")).toBe(tagged);
    for (const [reference, operation] of [
      [pinned, "resolve"],
      [`ghcr.io/attacker/dpf-doctools:v1`, "pull"],
      [`ghcr.io/${owner}/dpf-portal:v1`, "pull"],
      [`docker.io/library/alpine:latest`, "pull"],
      [`ghcr.io/${owner}/dpf-doctools:v1 --all-tags`, "pull"],
      [`ghcr.io/${owner}/dpf-doctools@sha256:abc`, "present"],
    ] as const) {
      expect(() => admitDoctoolsReference(reference, owner, operation)).toThrow("doctools_image_admission_refused");
    }
    expect(() => admitDoctoolsReference(tagged, undefined, "pull")).toThrow();
  });
});

describe("createDoctoolsImageOperator", () => {
  it("builds the fixed argv itself and refuses anything else before Docker", async () => {
    const calls: string[][] = [];
    const operate = createDoctoolsImageOperator({ ghcrOwner: owner, run: async (args) => { calls.push(args); return { exitCode: 0, stdout: "ok", stderr: "" }; } });
    await expect(operate({ operation: "pull", reference: pinned })).resolves.toEqual({ exitCode: 0, stdout: "ok", stderr: "" });
    expect(calls).toEqual([["pull", pinned]]);
    await expect(operate({ operation: "run", reference: pinned })).rejects.toThrow();
    await expect(operate({ operation: "pull", reference: pinned, args: ["--platform"] })).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });
});

describe("portal routing", () => {
  it("recognizes only the three fixed argv shapes", () => {
    expect(doctoolsOperationFor(["buildx", "imagetools", "inspect", tagged, "--format", "{{json .Manifest}}"])).toEqual({ operation: "resolve", reference: tagged });
    expect(doctoolsOperationFor(["image", "inspect", "--format", "{{.Id}}", pinned])).toEqual({ operation: "present", reference: pinned });
    expect(doctoolsOperationFor(["pull", tagged])).toEqual({ operation: "pull", reference: tagged });
    expect(doctoolsOperationFor(["build", "-t", "dpf-doctools:local", "."])).toBeNull();
  });

  it("stays local without the actuator, refuses builds with it, and never forwards argv", async () => {
    const bodies: unknown[] = [];
    const send = async (body: unknown) => { bodies.push(body); return { exitCode: 0, stdout: "x", stderr: "" }; };
    await expect(doctoolsDockerThroughActuator(["pull", tagged], async () => false, send)).resolves.toBeNull();
    await expect(doctoolsDockerThroughActuator(["build", "."], async () => true, send)).resolves.toMatchObject({ exitCode: 1 });
    await expect(doctoolsDockerThroughActuator(["pull", tagged], async () => true, send)).resolves.toEqual({ exitCode: 0, stdout: "x", stderr: "" });
    expect(bodies).toEqual([{ operation: "pull", reference: tagged }]);
  });
});
