import { describe, expect, it } from "vitest";
import {
  buildConverterCommand,
  CONVERTER_CONTAINER_UID,
  isPinnedImageReference,
} from "./command";

const DIGEST = `sha256:${"a".repeat(64)}`;
const IMAGE = `ghcr.io/opendigitalproductfactory/dpf-doctools:v2026.9.24@${DIGEST}`;

function build(overrides: Partial<Parameters<typeof buildConverterCommand>[0]> = {}) {
  return buildConverterCommand({
    image: IMAGE,
    containerName: "dpf-doctools-0123abcd",
    to: "pdf",
    from: "doc",
    maxInputBytes: 50 * 1024 * 1024,
    engineTimeoutSeconds: 105,
    ...overrides,
  });
}

/** The value that follows `flag` in argv. */
function valueAfter(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i === -1 ? undefined : args[i + 1];
}

describe("buildConverterCommand (AC-ODC-004)", () => {
  it("runs docker one-shot over stdin/stdout with every hardening flag", () => {
    const { command, args } = build();
    expect(command).toBe("docker");
    expect(args.slice(0, 3)).toEqual(["run", "--rm", "-i"]);
    expect(valueAfter(args, "--network")).toBe("none");
    expect(args).toContain("--read-only");
    expect(valueAfter(args, "--tmpfs")).toMatch(/^\/tmp:rw,.*size=512m/);
    expect(valueAfter(args, "--cap-drop")).toBe("ALL");
    expect(valueAfter(args, "--security-opt")).toBe("no-new-privileges");
    expect(valueAfter(args, "--memory")).toBe("1g");
    expect(valueAfter(args, "--memory-swap")).toBe("1g");
    expect(valueAfter(args, "--pids-limit")).toBe("256");
    expect(valueAfter(args, "--user")).toBe(`${CONVERTER_CONTAINER_UID}:${CONVERTER_CONTAINER_UID}`);
    expect(valueAfter(args, "--name")).toBe("dpf-doctools-0123abcd");
  });

  it("mounts nothing from the host and publishes no ports", () => {
    const { args } = build();
    for (const forbidden of ["-v", "--volume", "--mount", "-p", "--publish", "--privileged", "--cap-add"]) {
      expect(args).not.toContain(forbidden);
    }
  });

  it("passes the digest-pinned image, then only the dpf-convert arguments", () => {
    const { args } = build();
    const imageIndex = args.indexOf(IMAGE);
    expect(imageIndex).toBeGreaterThan(0);
    expect(args.slice(imageIndex + 1)).toEqual(["--to", "pdf", "--from", "doc"]);
  });

  it("hands the input cap and an inner timeout to dpf-convert", () => {
    const { args } = build({ maxInputBytes: 1234, engineTimeoutSeconds: 42 });
    expect(args).toContain("DPF_CONVERT_MAX_BYTES=1234");
    expect(args).toContain("DPF_CONVERT_TIMEOUT_SECONDS=42");
  });

  it("omits --from when the caller does not know the type", () => {
    const { args } = build({ from: undefined });
    expect(args.slice(args.indexOf(IMAGE) + 1)).toEqual(["--to", "pdf"]);
  });

  it("refuses an image that is not pinned by digest", () => {
    expect(() => build({ image: "dpf-doctools" })).toThrow(/pinned/);
    expect(() => build({ image: "ghcr.io/x/dpf-doctools:latest" })).toThrow(/pinned/);
    expect(() => build({ image: `dpf-doctools@sha256:${"a".repeat(63)}` })).toThrow(/pinned/);
  });

  it("refuses formats outside the dpf-convert tables and unsafe container names", () => {
    expect(() => build({ to: "exe" as never })).toThrow(/unsupported --to/);
    expect(() => build({ from: "sh" })).toThrow(/unsupported --from/);
    expect(() => build({ containerName: "dpf-doctools-x; rm -rf /" })).toThrow(/container name/);
    expect(() => build({ containerName: "other-container" })).toThrow(/container name/);
  });

  it("refuses non-positive limits", () => {
    expect(() => build({ maxInputBytes: 0 })).toThrow();
    expect(() => build({ engineTimeoutSeconds: 0 })).toThrow();
  });
});

describe("isPinnedImageReference", () => {
  it("accepts name@sha256, name:tag@sha256 and a bare content-addressed image id", () => {
    expect(isPinnedImageReference(`dpf-doctools@${DIGEST}`)).toBe(true);
    expect(isPinnedImageReference(IMAGE)).toBe(true);
    expect(isPinnedImageReference(DIGEST)).toBe(true);
  });

  it("rejects tags, bare names and malformed digests", () => {
    expect(isPinnedImageReference("dpf-doctools:latest")).toBe(false);
    expect(isPinnedImageReference("dpf-doctools")).toBe(false);
    expect(isPinnedImageReference(`dpf-doctools@sha256:${"A".repeat(64)}`)).toBe(false);
    expect(isPinnedImageReference(`--privileged@${DIGEST}`)).toBe(false);
    expect(isPinnedImageReference("")).toBe(false);
  });
});
