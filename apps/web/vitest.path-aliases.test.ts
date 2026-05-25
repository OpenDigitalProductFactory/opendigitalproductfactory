import { describe, expect, it } from "vitest";

import { buildNodeModuleAliases } from "./vitest.path-aliases";

describe("buildNodeModuleAliases", () => {
  it("prefers app-local node_modules when root package links are absent", () => {
    const aliases = buildNodeModuleAliases({
      webDir: "/workspace/apps/web",
      rootDir: "/workspace",
      resolvePath: (...parts) => parts.join("/").replace(/\/+/g, "/"),
      existsSync: (path) => path.startsWith("/workspace/apps/web/node_modules/"),
    });

    expect(aliases.find((alias) => alias.find === "react")?.replacement).toBe(
      "/workspace/apps/web/node_modules/react/index.js",
    );
    expect(aliases.find((alias) => alias.find === "react-dom/server")?.replacement).toBe(
      "/workspace/apps/web/node_modules/react-dom/server.node.js",
    );
    expect(aliases.find((alias) => alias.find === "react/jsx-runtime")?.replacement).toBe(
      "/workspace/apps/web/node_modules/react/jsx-runtime.js",
    );
  });
});
