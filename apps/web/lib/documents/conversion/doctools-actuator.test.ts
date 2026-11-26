import { beforeEach, describe, expect, it, vi } from "vitest";

const ports = vi.hoisted(() => ({ resolveImage: vi.fn(), run: vi.fn() }));
vi.mock("./image", () => ({ resolveDoctoolsImage: ports.resolveImage }));
vi.mock("@/lib/shared/run-process-with-budget", () => ({ runProcessWithBudget: ports.run }));

import { createDoctoolsActuator } from "./doctools-actuator";

const image = `ghcr.io/test/doctools@sha256:${"a".repeat(64)}`;
const bytes = Buffer.from([0xfe, 0x00, 0xff]);

beforeEach(() => {
  vi.resetAllMocks();
  ports.resolveImage.mockResolvedValue({ status: "pinned", image });
  ports.run.mockResolvedValue({ exitCode: 0, stdout: "", stdoutBytes: bytes, stderr: "", outputLimitExceeded: false });
});

describe("the private document engine owner", () => {
  it("refuses invalid formats before resolving an image or contacting Docker", async () => {
    const owner = createDoctoolsActuator("owned");
    await expect(owner.run({ kind: "convert", to: "sh" }, bytes)).resolves.toMatchObject({ exitCode: 2 });
    expect(ports.resolveImage).not.toHaveBeenCalled();
    expect(ports.run).not.toHaveBeenCalled();
  });

  it("uses the owner-resolved pin and the existing restricted binary recipe", async () => {
    const owner = createDoctoolsActuator("owned");
    await expect(owner.run({ kind: "convert", from: "docx", to: "pdf" }, bytes)).resolves.toMatchObject({ stdoutBytes: bytes });
    expect(ports.run).toHaveBeenCalledWith("docker", expect.arrayContaining([
      "--network", "none", "--read-only", "--cap-drop", "ALL", image, "--to", "pdf", "--from", "docx",
    ]), expect.objectContaining({ stdin: bytes, binaryStdout: true, maxStderrChars: 3_072 }));
    const args: string[] = ports.run.mock.calls[0][1];
    expect(args).not.toContain("--mount");
    expect(args).not.toContain("--privileged");
    expect(args[2]).toMatch(/^dpf\.doctools-action=owned\/[a-f0-9]{32}$/);
    ports.resolveImage.mockResolvedValue({ status: "unpinned", image: "untrusted:latest" });
    await expect(owner.run({ kind: "render" }, bytes)).resolves.toMatchObject({ exitCode: 125 });
    expect(ports.run).toHaveBeenCalledTimes(1);
  });
});
