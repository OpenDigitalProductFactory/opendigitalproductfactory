import { afterEach, describe, expect, it, vi } from "vitest";

import { createClientOperationId } from "./client-operation-id";

describe("createClientOperationId", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses randomUUID when the secure-context API is available", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "12345678-1234-4234-9234-123456789abc",
    });

    expect(createClientOperationId()).toBe("12345678-1234-4234-9234-123456789abc");
  });

  it("creates a UUID-shaped identifier from getRandomValues on HTTP installs", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(7),
    });

    expect(createClientOperationId()).toBe("07070707-0707-4707-8707-070707070707");
  });

  it("fails explicitly rather than creating a collision-prone identifier without Web Crypto", () => {
    vi.stubGlobal("crypto", undefined);

    expect(() => createClientOperationId()).toThrow(
      "Web Crypto is required to create client operation identifiers",
    );
  });
});
