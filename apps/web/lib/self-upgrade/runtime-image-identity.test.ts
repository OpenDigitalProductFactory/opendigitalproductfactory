import { describe, expect, it, vi } from "vitest";
import {
  parseContainerConfigDigest,
  readCurrentContainerConfigDigest,
} from "./runtime-image-identity";

describe("runtime image identity", () => {
  it("accepts only a Docker sha256 config digest", () => {
    const digest = `sha256:${"a".repeat(64)}`;
    expect(parseContainerConfigDigest(` ${digest}\n`)).toBe(digest);
    expect(parseContainerConfigDigest("latest")).toBeNull();
    expect(parseContainerConfigDigest("sha256:abc")).toBeNull();
  });

  it("reads the current container byte identity without inspecting a mutable tag", async () => {
    const digest = `sha256:${"b".repeat(64)}`;
    const runDocker = vi.fn().mockResolvedValue({ exitCode: 0, stdout: `${digest}\n`, stderr: "" });
    await expect(readCurrentContainerConfigDigest(runDocker, "portal-container")).resolves.toBe(digest);
    expect(runDocker).toHaveBeenCalledWith([
      "inspect",
      "--format",
      "{{.Image}}",
      "portal-container",
    ]);
  });

  it("returns null when Docker or the current container identity is unavailable", async () => {
    await expect(readCurrentContainerConfigDigest(
      vi.fn().mockResolvedValue({ exitCode: 1, stdout: "", stderr: "missing" }),
      "portal-container",
    )).resolves.toBeNull();
  });
});
