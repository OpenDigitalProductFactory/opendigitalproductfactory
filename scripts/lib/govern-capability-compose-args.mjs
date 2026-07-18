const EXPLICIT_OVERLAYS = new Set(["promote", "dev", "integration-test", "linux-monitoring", "linux-host-network"]);
const COMPATIBILITY_ALIASES = new Map([
  ["tts", "runtime-local-speech"],
  ["observability-ui", "runtime-deep-observability"],
]);

function requestedProfiles(args) {
  const result = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--profile") {
      result.push({ profile: args[index + 1], start: index, length: 2 });
      index += 1;
    } else if (arg.startsWith("--profile=")) {
      result.push({ profile: arg.slice("--profile=".length), start: index, length: 1 });
    }
  }
  return result;
}

export function governCapabilityComposeArgs({ args, projection }) {
  const resolved = new Set(projection.runtimeProfiles ?? []);
  const remove = new Set();
  for (const request of requestedProfiles(args)) {
    const canonical = COMPATIBILITY_ALIASES.get(request.profile) ?? (request.profile?.startsWith("runtime-") ? request.profile : undefined);
    if (canonical) {
      if (!resolved.has(canonical)) throw new Error(`capability_profile_not_enabled:${request.profile}`);
      for (let offset = 0; offset < request.length; offset += 1) remove.add(request.start + offset);
    } else if (!EXPLICIT_OVERLAYS.has(request.profile)) {
      throw new Error(`explicit_compose_profile_not_allowed:${request.profile}`);
    }
  }
  const remaining = args.filter((_, index) => !remove.has(index));
  return [...[...resolved].sort().flatMap((profile) => ["--profile", profile]), ...remaining];
}
