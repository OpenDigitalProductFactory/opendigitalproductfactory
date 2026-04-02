// lib/integrate/sandbox/index.ts — Sandbox build environment isolation
// Note: sandbox.ts and sandbox-workspace.ts both export initializeSandboxWorkspace.
// Re-export sandbox-workspace explicitly to avoid the name collision.
export * from "./sandbox";
export * from "./sandbox-db";
export * from "./sandbox-pool";
export * from "./sandbox-promotion";
export {
  copySourceAndBaseline,
  installDepsAndStart,
  buildInstallCommands,
} from "./sandbox-workspace";
export * from "./sandbox-source-strategy";
