import { expect, it, vi } from "vitest";

const ports = vi.hoisted(() => ({ resolve: vi.fn(), spawn: vi.fn(), active: vi.fn() }));
vi.mock("@dpf/db", () => ({ prisma: { mcpApiToken: { findFirst: ports.active } } }));
vi.mock("@/lib/auth/workroom-session-token", () => ({ resolveWorkroomSessionToken: ports.resolve }));
vi.mock("node:child_process", () => ({ spawn: ports.spawn }));

import { createSandboxSessionActuator, readWorkroomSessionOwner } from "./sandbox-session-actuator";

const owner = { provider: "codex", capsuleId: "WC-RUNTIME", token: `dpfroom_${"x".repeat(32)}`, cwd: "/workspace/.builds/FB-PROOF" };

it("allows only provider data and a workspace-relative working directory", () => {
  expect(readWorkroomSessionOwner(owner)).toEqual(owner);
  for (const invalid of [
    { ...owner, script: "not a provider recipe" },
    { ...owner, cwd: "/workspace/../outside" },
    { ...owner, containerId: "foreign" },
    { ...owner, provider: "claude", flags: "--resume aabbccdd --permission-mode allow",
      credential: { name: "DOCKER_HOST", value: "peer" } },
  ]) expect(() => readWorkroomSessionOwner(invalid)).toThrow("workroom_runtime_admission_unproven");
});

it("never resolves an execution target for a different room's token", async () => {
  ports.resolve.mockResolvedValue({ workroomRef: "WC-SOMEONE-ELSE", tokenId: "fixture-token" });
  const observe = vi.fn();
  await expect(createSandboxSessionActuator()(owner, observe)).rejects.toThrow("workroom_runtime_admission_unproven");
  expect(observe).not.toHaveBeenCalled();
  expect(ports.spawn).not.toHaveBeenCalled();
});

it("holds the launch when token revocation wins during sandbox verification", async () => {
  ports.resolve.mockResolvedValue({ workroomRef: owner.capsuleId, tokenId: "fixture-token" });
  ports.active.mockResolvedValue(null);
  await expect(createSandboxSessionActuator()(owner, async () => ({ containerId: "a".repeat(64), running: true })))
    .rejects.toThrow("workroom_runtime_admission_unproven");
  expect(ports.spawn).not.toHaveBeenCalled();
});
