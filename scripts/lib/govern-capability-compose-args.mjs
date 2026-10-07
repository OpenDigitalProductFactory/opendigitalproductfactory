import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

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

export function governCapabilityComposeEnvironment({ args, projection, composeProfiles = "" }) {
  const environmentRequests = String(composeProfiles)
    .split(",")
    .map((profile) => profile.trim())
    .filter(Boolean)
    .flatMap((profile) => ["--profile", profile]);
  const governedArgs = governCapabilityComposeArgs({ args: [...environmentRequests, ...args], projection });
  const normalizedProfiles = [];
  for (const request of requestedProfiles(governedArgs)) {
    if (!normalizedProfiles.includes(request.profile)) normalizedProfiles.push(request.profile);
  }
  return { args: governedArgs, composeProfiles: normalizedProfiles };
}

// BI-FFFEA4ED: daemon-visible binds for required-service reconciliation.
const within = (path, root) => path === root || path.startsWith(`${root}/`);
const trim = (path) => path.replace(/\/$/, '');
const mapStrings = (value, transform) => typeof value === 'string'
  ? transform(value)
  : Array.isArray(value) ? value.map((entry) => mapStrings(entry, transform))
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, mapStrings(entry, transform)]))
      : value;

// Compose volumes merge by container target. Emit only translated entries, with
// all options preserved, leaving host-owned binds and named volumes untouched.
export function mountOverride(config, mounts, { composeRoot, installRoot } = {}) {
  // `compose config` escapes literal dollars for round-tripping its output.
  // Decode that layer before mapping; re-escape once for the override file.
  config = mapStrings(config, (value) => value.replaceAll('$$', '$'));
  const bindings = mounts.filter((mount) => mount.Type === 'bind')
    .map((mount) => ({ ...mount, Destination: trim(mount.Destination) }))
    .sort((a, b) => b.Destination.length - a.Destination.length);
  const translate = (source) => {
    const binding = bindings.find((mount) => within(source, mount.Destination));
    return binding ? trim(binding.Source.replaceAll('\\', '/')) + source.slice(binding.Destination.length) : null;
  };
  const services = {};
  for (const [name, service] of Object.entries(config.services ?? {})) {
    const volumes = [];
    for (const volume of service.volumes ?? []) {
      if (volume.type !== 'bind') continue;
      let source = volume.source;
      if (installRoot && composeRoot && within(source, composeRoot)) {
        // Called after release identity commit: stable installed assets now own
        // these mounts. Backups can subsequently expire without breaking them.
        source = trim(installRoot) + source.slice(trim(composeRoot).length);
      }
      const hostSource = translate(source);
      if (hostSource) volumes.push(mapStrings({ ...volume, source: hostSource }, (value) => value.replaceAll('$', () => '$$')));
      else if (composeRoot && within(volume.source, trim(composeRoot))) {
        throw new Error(`unmapped promoter bind for service ${name}`);
      }
    }
    if (volumes.length) services[name] = { volumes };
  }
  return { services };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    // Promoter runtime: run with node by promote.sh, never through pnpm, so no
    // forwarded `--` can arrive. It must NOT import script-argv.mjs: the promoter
    // build context is staged by the already-deployed (N-1) portal from the file
    // list baked into ITS image, and SUR-F67B9933 died on exactly that import
    // (`Cannot find module /promoter/lib/script-argv.mjs`, BI-A04D61B9).
    const { positionals: [composeRoot, installRoot] } = parseArgs({ args: process.argv.slice(2), allowPositionals: true });
    const config = JSON.parse(readFileSync(0, 'utf8'));
    const hasBinds = Object.values(config.services ?? {}).some((service) => service.volumes?.some((volume) => volume.type === 'bind'));
    const mounts = hasBinds ? JSON.parse(execFileSync('docker', ['inspect', process.env.HOSTNAME, '--format', '{{json .Mounts}}'], { encoding: 'utf8' })) : [];
    process.stdout.write(JSON.stringify(mountOverride(config, mounts, {
      composeRoot, installRoot: installRoot || undefined,
    })) + '\n');
  } catch {
    // Rendered compose can contain credentials; never print it or subprocess output.
    process.stderr.write('Unable to resolve daemon-visible service mounts; reconciliation remains degraded.\n');
    process.exitCode = 1;
  }
}
