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

// Compose subcommands that can (re)create containers and therefore (re)attach a
// service to its project volume. A root-project `up` is exactly what reverted
// the live DB on 2026-06-23: it attached postgres to the canonical `dpf_pgdata`
// volume, which had been a stale 8-day-old leftover (BI-B61779DB / BI-39543181).
const CONTAINER_CREATING_COMMANDS = new Set(["up", "create", "start", "restart", "run"]);

// The stateful data services whose volume identity is irreplaceable. Recreating
// any of these on the root project is the risky act; recreating a stateless
// service (portal, inngest) is not — that is the `redeploy-portal` / promoter
// `--no-deps portal` path, which must stay allowed.
const DATA_SERVICES = new Set(["postgres", "neo4j", "qdrant"]);

// `up`-family options that take a value, so the following token is NOT a service
// operand. Combined with the global OPTIONS_WITH_VALUES above.
const UP_OPTIONS_WITH_VALUES = new Set([
  "--scale",
  "--exit-code-from",
  "--attach",
  "--no-attach",
  "--timeout",
  "-t",
  "--wait-timeout",
  "--pull",
  "--scenario",
]);

/** Positional service operands of an up-family command (skips flags + their values). */
export function composeServiceOperands(commandArgs) {
  const services = [];
  for (let index = 0; index < commandArgs.length; index += 1) {
    const arg = commandArgs[index];
    if (arg === "--") continue;
    if (arg.startsWith("-")) {
      if (arg.includes("=")) continue; // --opt=value carries its own value
      if (OPTIONS_WITH_VALUES.has(arg) || UP_OPTIONS_WITH_VALUES.has(arg)) index += 1; // skip the value token
      continue;
    }
    services.push(arg);
  }
  return services;
}

/**
 * True when this intent would (re)create a stateful data service on the ROOT
 * `dpf` project — the act that can silently swap the live database onto a wrong
 * or stale volume. A targeted `--no-deps` up of only stateless services (the
 * redeploy/promoter path) is NOT flagged.
 */
export function isRootDataServiceRecreateIntent(intent, projectName) {
  if (String(projectName).trim().toLowerCase() !== DEFAULT_PROJECT_NAME) return false;
  if (!CONTAINER_CREATING_COMMANDS.has(intent.command)) return false;
  const services = composeServiceOperands(intent.commandArgs);
  const namesData = services.some((s) => DATA_SERVICES.has(s));
  const noDeps = intent.commandArgs.includes("--no-deps");
  // No service operands => a full `up` that brings up postgres et al.
  if (services.length === 0) return true;
  // Named a data service explicitly => always risky.
  if (namesData) return true;
  // Named only stateless services: risky only if deps are pulled in (without
  // --no-deps, `up portal` also starts postgres as a dependency).
  return !noDeps;
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

  if (
    isRootDataServiceRecreateIntent(intent, projectName) &&
    env.DPF_ALLOW_ROOT_COMPOSE_UP !== "1" &&
    env.DPF_ALLOW_DESTRUCTIVE_COMPOSE !== "1"
  ) {
    errors.push(
      `Refusing 'docker compose ${intent.command}' of a data service on the root dpf project. ` +
        "This recreates postgres/neo4j/qdrant and can silently attach the live database to a stale or wrong " +
        "volume — exactly the 2026-06-23 8-day data revert (BI-B61779DB). The governed portal update path is " +
        "/ops/self-upgrade (or scripts/redeploy-portal.* / promote.sh, which use --no-deps and never touch the " +
        "data services). For an intentional install/recovery, set DPF_ALLOW_ROOT_COMPOSE_UP=1; for worktrees/CI, " +
        "use a unique COMPOSE_PROJECT_NAME (dpf-<topic>).",
    );
  }

  return {
    ok: errors.length === 0,
    errors,
    intent,
    projectName,
  };
}
