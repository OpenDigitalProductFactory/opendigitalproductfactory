import path from "node:path";

const DEFAULT_PROJECT_NAME = "dpf";

const OPTIONS_WITH_VALUES = new Set([
  "-f",
  "--file",
  "-p",
  "--project-name",
  "--profile",
  "--env-file",
  "--project-directory",
  "--parallel",
  "--progress",
  "--ansi",
  "--log-level",
]);

export function deriveWorktreeComposeProjectName(worktreePath) {
  const base = path.basename(path.resolve(worktreePath || "."));
  let slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug || slug === DEFAULT_PROJECT_NAME) {
    slug = "worktree";
  }

  if (slug.startsWith("dpf-")) {
    return slug;
  }

  return `dpf-${slug}`;
}

export function isIsolatedProjectName(projectName) {
  if (!projectName) return false;
  const normalized = String(projectName).trim();
  return /^dpf-[a-z0-9][a-z0-9_.-]*$/i.test(normalized) && normalized.toLowerCase() !== DEFAULT_PROJECT_NAME;
}

function getOptionValue(args, index) {
  const current = args[index];
  if (current.includes("=")) {
    return current.slice(current.indexOf("=") + 1);
  }
  return args[index + 1] ?? "";
}

export function parseComposeIntent(args) {
  const profiles = [];
  let projectName;
  let command = "";
  let commandArgs = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "--") {
      continue;
    }

    if (arg === "--profile" || arg.startsWith("--profile=")) {
      profiles.push(getOptionValue(args, index));
      if (arg === "--profile") index += 1;
      continue;
    }

    if (arg === "--project-name" || arg === "-p" || arg.startsWith("--project-name=")) {
      projectName = getOptionValue(args, index);
      if (arg === "--project-name" || arg === "-p") index += 1;
      continue;
    }

    if (arg.startsWith("-p") && arg.length > 2) {
      projectName = arg.slice(2);
      continue;
    }

    if (arg.startsWith("-")) {
      if (OPTIONS_WITH_VALUES.has(arg)) {
        index += 1;
      }
      continue;
    }

    command = arg;
    commandArgs = args.slice(index + 1);
    break;
  }

  return {
    command,
    commandArgs,
    profiles,
    projectName,
  };
}

export function isVolumeDestructiveComposeIntent(intent) {
  if (intent.command !== "down") {
    return false;
  }

  return intent.commandArgs.some((arg) => arg === "--volumes" || arg === "-v" || arg.startsWith("--volumes="));
}

export function validateComposeSafety({ args, env = process.env } = {}) {
  const intent = parseComposeIntent(args ?? []);
  const projectName = (intent.projectName || env.COMPOSE_PROJECT_NAME || DEFAULT_PROJECT_NAME).trim();
  const errors = [];

  if (intent.profiles.includes("integration-test") && !isIsolatedProjectName(projectName)) {
    errors.push(
      "integration-test Compose runs must set COMPOSE_PROJECT_NAME to a unique dpf-* project, such as dpf-ci-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}.",
    );
  }

  if (
    isVolumeDestructiveComposeIntent(intent) &&
    projectName.toLowerCase() === DEFAULT_PROJECT_NAME &&
    env.DPF_ALLOW_DESTRUCTIVE_COMPOSE !== "1"
  ) {
    errors.push(
      "Refusing docker compose down --volumes because it would delete volumes in the root dpf project. Set a unique COMPOSE_PROJECT_NAME or DPF_ALLOW_DESTRUCTIVE_COMPOSE=1 for an intentional recovery/reinstall.",
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    intent,
    projectName,
  };
}
