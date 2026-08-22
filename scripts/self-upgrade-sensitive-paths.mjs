import { pathToFileURL } from "node:url";

const rule = (id, family, pattern) => Object.freeze({ id, family, pattern });

export const SELF_UPGRADE_SENSITIVE_PATH_RULES = Object.freeze([
  rule("promoter-artifacts", "promoter", /^(?:Dockerfile\.promoter|scripts\/(?:promote\.|build-promoter|repair-promoter).*)/),
  rule("self-upgrade-runtime", "selfUpgrade", /^apps\/web\/(?:lib|app\/api\/ops)\/self-upgrade(?:\/|\.|$)/),
  rule("self-upgrade-queue-actions", "selfUpgrade", /^apps\/web\/(?:lib\/queue\/functions\/self-upgrade|lib\/actions\/(?:self-upgrade|promotions))/),
  rule("compose-and-state", "composeState", /^(?:docker-compose(?:\.[^/]+)?\.ya?ml|scripts\/installer\/lib\/state\.(?:ps1|sh)|scripts\/compile-capability-service-catalog\.mjs)/),
  rule("installer-entrypoints", "installer", /^(?:(?:install|uninstall|dpf-reinstall)-dpf\.(?:ps1|sh)|dpf-reinstall\.(?:ps1|sh)|scripts\/(?:fresh-install\.ps1|setup\.sh|verify-install-|installer\/))/),
  rule("capability-catalog", "capabilities", /^(?:packages\/db\/data\/capability-service-catalog\.json|scripts\/(?:resolve|apply|compile)-.*capabilit)/),
  rule("promoter-contract", "contract", /^(?:(?:promoter-contract|scripts\/promoter-contract)(?:\.schema)?\.json|apps\/web\/lib\/self-upgrade\/promoter-contract|scripts\/promoter-contract(?:\.|\/)|Dockerfile\.promoter)/),
  rule("acceptance-workflow", "workflow", /^\.github\/workflows\/self-upgrade-acceptance\.yml$/),
  rule("n-minus-one-harness", "harness", /^scripts\/(?:self-upgrade-sensitive-paths|test-n-minus-one-upgrade)(?:\.test)?\.mjs$/),
  // Everything Dockerfile.promoter bakes into the promoter image decides whether
  // an install can upgrade, so changing any of it must run the acceptance gate.
  // The rules above missed most of this closure - including the generated
  // capability catalog and the profile resolver - which is how a change to the
  // capability projection reached main without the gate ever running
  // (BI-AA6FBAD0). The colocated test derives the closure from Dockerfile.promoter
  // and fails if a newly baked file is not owned here.
  rule("promoter-image-closure", "promoterClosure", /^(?:Dockerfile|scripts\/(?:capability-service-catalog\.generated\.json|promoter-migration-envelope\.mjs|runtime-transition-authority\.mjs|rotate-runtime-transition-secret\.mjs|governed-teardown\.mjs|salvage-sweep\.mjs)|scripts\/lib\/(?:transition-signing|resolve-capability-compose-profiles|govern-capability-compose-args|capability-state-hash)\.mjs)$/),
]);

export function normalizeRepositoryPath(path) {
  return String(path).replaceAll("\\", "/").replace(/^\.\//, "");
}

export function classifySensitivePath(path) {
  const normalized = normalizeRepositoryPath(path);
  for (const owner of SELF_UPGRADE_SENSITIVE_PATH_RULES) {
    if (owner.pattern.test(normalized)) return { id: owner.id, family: owner.family, path: normalized };
  }
  return null;
}

export function findUnownedLifecyclePaths(paths) {
  return paths.map(normalizeRepositoryPath).filter((path) => !classifySensitivePath(path)).sort();
}

export function changedPathsAreSensitive(paths) {
  return paths.some((path) => classifySensitivePath(path) !== null);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const sensitive = changedPathsAreSensitive(process.argv.slice(2));
  process.stdout.write(`sensitive=${sensitive}\n`);
}
