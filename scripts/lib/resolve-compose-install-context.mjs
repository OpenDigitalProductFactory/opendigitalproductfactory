import { delimiter, dirname, resolve } from "node:path";

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

export function resolveComposeInstallContext({ args, cwd, env = process.env, pathDelimiter = delimiter }) {
  const projectDirectories = optionValues(args, "--project-directory", "--project-directory").map((value) => resolve(cwd, value));
  const uniqueProjectDirectories = [...new Set(projectDirectories)];
  if (uniqueProjectDirectories.length > 1) throw new Error("compose_project_root_ambiguous");

  const cliFiles = optionValues(args, "-f", "--file").map((value) => resolve(cwd, value));
  const environmentFiles = env.COMPOSE_FILE ? String(env.COMPOSE_FILE).split(pathDelimiter).filter(Boolean).map((value) => resolve(cwd, value)) : [];
  if (cliFiles.length > 0 && environmentFiles.length > 0 && (
    cliFiles.length !== environmentFiles.length || cliFiles.some((file, index) => file !== environmentFiles[index])
  )) throw new Error("compose_file_sources_mismatch");
  const selectedFiles = cliFiles.length > 0 ? cliFiles : environmentFiles;
  const composeRoots = selectedFiles.map((value) => dirname(value));
  const uniqueComposeRoots = [...new Set(composeRoots)];
  if (uniqueComposeRoots.length > 1) throw new Error("compose_project_root_ambiguous");

  const projectDirectory = uniqueProjectDirectories[0];
  const composeRoot = uniqueComposeRoots[0];
  if (projectDirectory && composeRoot && projectDirectory !== composeRoot) throw new Error("compose_project_root_mismatch");
  const projectRoot = projectDirectory ?? composeRoot ?? resolve(cwd);
  return { projectRoot, composeFiles: selectedFiles.length > 0 ? selectedFiles : [resolve(projectRoot, "docker-compose.yml")] };
}

export function canonicalizeComposeFileArgs({ args, composeFiles }) {
  const remaining = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-f" || arg === "--file") {
      index += 1;
      continue;
    }
    if (arg.startsWith("--file=")) continue;
    remaining.push(arg);
  }
  return [...composeFiles.flatMap((file) => ["-f", file]), ...remaining];
}
