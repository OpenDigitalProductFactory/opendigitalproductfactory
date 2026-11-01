import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async original => {
  const actual = await original<typeof import("node:fs")>();
  return { ...actual, readdirSync: vi.fn(actual.readdirSync), lstatSync: vi.fn(actual.lstatSync),
    readFileSync: vi.fn(actual.readFileSync), openSync: vi.fn(actual.openSync),
    fstatSync: vi.fn(actual.fstatSync), readSync: vi.fn(actual.readSync), closeSync: vi.fn(actual.closeSync) };
});

import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readdirSync, readSync } from "node:fs";
import { publicActionReference } from "./subscription-calibration-verification";

const id = "a".repeat(40), descriptor = 71;
const publicBytes = Buffer.from(`createServerReference("${id}", callServer, undefined, findSourceMapURL, "publicStatusAction")`);
const swappedPathBytes = `createServerReference("${id}", callServer, undefined, findSourceMapURL, "getOrCreateThreadSnapshot")`;
let cursor = 0;

beforeEach(() => {
  cursor = 0;
  vi.mocked(readdirSync).mockReturnValue(["public.js"] as never);
  vi.mocked(lstatSync).mockReturnValue({ isFile: () => true, size: publicBytes.length } as never);
  vi.mocked(readFileSync).mockReturnValue(swappedPathBytes as never);
  vi.mocked(openSync).mockReturnValue(descriptor);
  vi.mocked(fstatSync).mockReturnValue({ isFile: () => true, size: publicBytes.length } as never);
  vi.mocked(closeSync).mockImplementation(() => undefined);
  vi.mocked(readSync).mockImplementation(((fd: number, buffer: Buffer, offset: number, length: number) => {
    expect(fd).toBe(descriptor);
    const count = Math.min(length, publicBytes.length - cursor);
    publicBytes.copy(buffer, offset, cursor, cursor + count); cursor += count;
    return count;
  }) as typeof readSync);
});
afterEach(() => vi.resetAllMocks());

describe("public client metadata file reads", () => {
  it("reads the opened file when its pathname is replaced after inspection", () => {
    expect(publicActionReference(id)?.publicProxyExportName).toBe("publicStatusAction");
    expect(readFileSync).not.toHaveBeenCalled();
    expect(openSync).toHaveBeenCalledWith(expect.any(String), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    expect(closeSync).toHaveBeenCalledExactlyOnceWith(descriptor);
  });

  it("refuses a symlink instead of following it to another bundle", () => {
    vi.mocked(openSync).mockImplementation(() => { throw Object.assign(new Error("symlink"), { code: "ELOOP" }); });
    expect(publicActionReference(id)?.publicProxyExportName).toBeNull();
    expect(readSync).not.toHaveBeenCalled(); expect(readFileSync).not.toHaveBeenCalled();
  });

  it("closes an opened non-regular or oversized file without reading it", () => {
    for (const stat of [{ isFile: () => false, size: 10 }, { isFile: () => true, size: 8 * 1024 * 1024 + 1 }]) {
      vi.clearAllMocks(); vi.mocked(fstatSync).mockReturnValue(stat as never);
      expect(publicActionReference(id)?.publicProxyExportName).toBeNull();
      expect(readSync).not.toHaveBeenCalled(); expect(closeSync).toHaveBeenCalledExactlyOnceWith(descriptor);
    }
  });

  it("refuses growth beyond the opened size without an unbounded allocation or path read", () => {
    vi.mocked(readSync).mockImplementation(((fd: number, buffer: Buffer, offset: number, length: number) => {
      expect(fd).toBe(descriptor); expect(buffer.length).toBeLessThanOrEqual(publicBytes.length + 1);
      buffer.fill("x", offset, offset + length); return length;
    }) as typeof readSync);
    expect(publicActionReference(id)?.publicProxyExportName).toBeNull();
    expect(readFileSync).not.toHaveBeenCalled(); expect(closeSync).toHaveBeenCalledExactlyOnceWith(descriptor);
  });

  it("charges rejected growing files against the total read budget", () => {
    const size = 8 * 1024 * 1024;
    let requestedBytes = 0;
    vi.mocked(readdirSync).mockReturnValue(Array.from({ length: 20 }, (_, i) => `chunk-${i}.js`) as never);
    vi.mocked(fstatSync).mockReturnValue({ isFile: () => true, size: size - 1 } as never);
    vi.mocked(readSync).mockImplementation(((_fd: number, buffer: Buffer, offset: number, length: number) => {
      requestedBytes += length; buffer.fill("x", offset, offset + length); return length;
    }) as typeof readSync);
    expect(publicActionReference(id)?.publicProxyExportName).toBeNull();
    expect(openSync).toHaveBeenCalledTimes(4); expect(closeSync).toHaveBeenCalledTimes(4);
    expect(requestedBytes).toBe(32 * 1024 * 1024);
    expect(readFileSync).not.toHaveBeenCalled();
  });

  it("closes the descriptor when reading fails", () => {
    vi.mocked(readSync).mockImplementation(() => { throw new Error("read failed"); });
    expect(publicActionReference(id)?.publicProxyExportName).toBeNull();
    expect(closeSync).toHaveBeenCalledExactlyOnceWith(descriptor);
  });
});
