import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";

export function assertSafeSandboxPath(candidate, sandboxRoot) {
  if (!candidate || !sandboxRoot) throw new Error("sandbox path must be resolved");
  const target = resolve(candidate);
  const root = resolve(sandboxRoot);
  const rel = relative(root, target);
  if (!isAbsolute(target) || target === root || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`path escapes fixture sandbox: ${target}`);
  if (target === resolve(homedir()) || target === resolve(target, "..")) throw new Error(`unsafe canonical path: ${target}`);
  return target;
}

export function assertSafeComposeCommand(argv, sandboxRoot) {
  const projectAt = argv.findIndex((arg) => arg === "-p" || arg === "--project-name");
  const project = projectAt >= 0 ? argv[projectAt + 1] : process.env.COMPOSE_PROJECT_NAME;
  const destructive = argv.includes("--volumes") || argv.includes("-v") || argv.some((arg) => /^(?:rm|remove|cleanup)$/.test(arg));
  if (destructive && (!project || !/^dpf-test-[a-z0-9-]+$/i.test(project))) throw new Error("destructive fixture command requires an isolated dpf-test project");
  for (const arg of argv) {
    if (arg.includes(":")) {
      const hostPath = arg.split(":", 1)[0];
      if (/^(?:[A-Za-z]:[\\/]|\/)/.test(hostPath)) assertSafeSandboxPath(hostPath, sandboxRoot);
    }
  }
  return { project, destructive };
}
