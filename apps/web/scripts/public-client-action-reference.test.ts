import { describe, expect, it } from "vitest";
import { publicClientActionExport } from "./public-client-action-reference";

const id = "a".repeat(40), name = "getOrCreateThreadSnapshot";
const proxy = (callee = "(0, client.createServerReference)", actionId = id, exportName = name) =>
  `${callee}("${actionId}", client.callServer, void 0, client.findSourceMapURL, "${exportName}")`;

describe("public client action identity", () => {
  it("binds the exact observed ID and export in a public server-reference call", () => {
    expect(publicClientActionExport(`const action = ${proxy()};`, id)).toBe(name);
  });
  it("accepts the named and computed public helper forms", () => {
    expect(publicClientActionExport(proxy("createServerReference"), id)).toBe(name);
    expect(publicClientActionExport(proxy('(0, client["createServerReference"])'), id)).toBe(name);
  });
  it("does not treat an unrelated call with the same nearby name as a proxy", () => {
    expect(publicClientActionExport(proxy("unrelated"), id)).toBeNull();
  });
  it("does not bind an ID in a string to a neighboring call", () => {
    expect(publicClientActionExport(`const text = "${id}"; report(null, "${name}");`, id)).toBeNull();
  });
  it("requires the ID in the first argument of the same five-argument call", () => {
    expect(publicClientActionExport(`client.createServerReference("other", "${id}", null, null, "${name}")`, id)).toBeNull();
    expect(publicClientActionExport(`client.createServerReference("${id}", "${name}")`, id)).toBeNull();
  });
  it("rejects conflicting names for one ID", () => {
    expect(publicClientActionExport(`${proxy()}; ${proxy(undefined, id, "differentAction")}`, id)).toBeNull();
  });
  it("rejects malformed JavaScript and malformed action IDs", () => {
    expect(publicClientActionExport(`function broken( { ${proxy()};`, id)).toBeNull();
    expect(publicClientActionExport(proxy(undefined, "not-an-action-id"), "not-an-action-id")).toBeNull();
  });
  it("keeps duplicate identical proxies unambiguous and ignores another ID", () => {
    expect(publicClientActionExport(`${proxy()}; ${proxy()}; ${proxy(undefined, "b".repeat(40), "other")}`, id)).toBe(name);
  });
});
