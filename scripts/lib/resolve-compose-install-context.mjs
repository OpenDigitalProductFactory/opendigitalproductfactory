import { dirname, resolve } from "node:path";

export function resolveDpfStatePath({ env = process.env, home }) {
  if (env.DPF_INSTALL_STATE_PATH) return resolve(env.DPF_INSTALL_STATE_PATH);
  if (env.DPF_STATE_DIR) return resolve(env.DPF_STATE_DIR, "install-state.json");
  if (env.XDG_STATE_HOME) return resolve(env.XDG_STATE_HOME, "dpf", "install-state.json");
  return resolve(home, ".dpf", "install-state.json");
}

function optionValues(args, shortName, longName) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === shortName || arg === longName) {
      if (index + 1 >= args.length) throw new Error(`compose_option_value_missing:${arg}`);
      values.push(args[index + 1]);
      index += 1;
    } else if (arg.startsWith(`${longName}=`)) {
      values.push(arg.slice(longName.length + 1));
    }
  }
  return values;
}

export function resolveComposeInstallContext({ args, cwd }) {
  const projectDirectories = optionValues(args, "--project-directory", "--project-directory").map((value) => resolve(cwd, value));
  const uniqueProjectDirectories = [...new Set(projectDirectories)];
  if (uniqueProjectDirectories.length > 1) throw new Error("compose_project_root_ambiguous");

  const composeRoots = optionValues(args, "-f", "--file").map((value) => dirname(resolve(cwd, value)));
  const uniqueComposeRoots = [...new Set(composeRoots)];
  if (uniqueComposeRoots.length > 1) throw new Error("compose_project_root_ambiguous");

  const projectDirectory = uniqueProjectDirectories[0];
  const composeRoot = uniqueComposeRoots[0];
  if (projectDirectory && composeRoot && projectDirectory !== composeRoot) throw new Error("compose_project_root_mismatch");
  return { projectRoot: projectDirectory ?? composeRoot ?? resolve(cwd) };
}
