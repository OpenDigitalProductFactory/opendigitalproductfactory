// Map a discovered package manager (as recorded on DiscoveredSoftwareEvidence) to the
// OSV ecosystem used to query advisories. Returns null when OSV cannot be queried
// reliably for it: OS package managers (dpkg/rpm/brew) need distribution context
// (e.g. "Debian:12") that host inventory does not capture today, so those are the
// native-manager adapter's job (Edge Node on-host "installed -> available"), not OSV's.

const OSV_ECOSYSTEM_BY_MANAGER: Record<string, string> = {
  npm: "npm",
  pip: "PyPI",
  pypi: "PyPI",
  gem: "RubyGems",
  cargo: "crates.io",
  go: "Go",
  composer: "Packagist",
  nuget: "NuGet",
  maven: "Maven",
  pub: "Pub",
  hex: "Hex",
};

/** OSV ecosystem for a package manager, or null when OSV is not a reliable source. */
export function osvEcosystemFor(packageManager: string | null | undefined): string | null {
  return OSV_ECOSYSTEM_BY_MANAGER[(packageManager ?? "").toLowerCase()] ?? null;
}
