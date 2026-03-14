import { spawnSync } from "node:child_process";
import os from "node:os";

import type {
  CollectorContext,
  CollectorOutput,
  DiscoveredSoftwareInput,
} from "../discovery-types";

type HostOsAdapter = {
  hostname: typeof os.hostname;
  platform: typeof os.platform;
  release: typeof os.release;
  arch: typeof os.arch;
  cpus: typeof os.cpus;
  totalmem: typeof os.totalmem;
  networkInterfaces: typeof os.networkInterfaces;
  installedSoftware: () => Promise<DiscoveredSoftwareInput[]>;
};

function parseJsonArray<T>(value: string): T[] {
  if (!value.trim()) {
    return [];
  }

  const parsed = JSON.parse(value) as T | T[];
  return Array.isArray(parsed) ? parsed : [parsed];
}

async function collectInstalledSoftware(): Promise<DiscoveredSoftwareInput[]> {
  if (process.platform === "win32") {
    const script = [
      "$paths = @(",
      "'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*',",
      "'HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*'",
      ")",
      "Get-ItemProperty $paths |",
      "Where-Object { $_.DisplayName } |",
      "Select-Object DisplayName, DisplayVersion, Publisher, InstallLocation |",
      "ConvertTo-Json -Compress",
    ].join(" ");
    const result = spawnSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8" });
    if (result.status !== 0 || !result.stdout.trim()) {
      return [];
    }

    return parseJsonArray<{
      DisplayName?: string;
      DisplayVersion?: string;
      Publisher?: string;
      InstallLocation?: string;
    }>(result.stdout).map((entry) => ({
      evidenceSource: "installed_software",
      ...(entry.DisplayName ? { rawProductName: entry.DisplayName } : {}),
      ...(entry.DisplayVersion ? { rawVersion: entry.DisplayVersion } : {}),
      ...(entry.Publisher ? { rawVendor: entry.Publisher } : {}),
      ...(entry.InstallLocation ? { installLocation: entry.InstallLocation } : {}),
    }));
  }

  const dpkg = spawnSync(
    "dpkg-query",
    ["-W", "-f=${Package}\\t${Version}\\n"],
    { encoding: "utf8" },
  );
  if (dpkg.status === 0 && dpkg.stdout.trim()) {
    return dpkg.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [name, version] = line.split("\t");
        return {
          evidenceSource: "host_packages",
          packageManager: "dpkg",
          ...(name ? { rawPackageName: name } : {}),
          ...(version ? { rawVersion: version } : {}),
        };
      });
  }

  const rpm = spawnSync(
    "rpm",
    ["-qa", "--queryformat", "%{NAME}\\t%{VERSION}-%{RELEASE}\\n"],
    { encoding: "utf8" },
  );
  if (rpm.status === 0 && rpm.stdout.trim()) {
    return rpm.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [name, version] = line.split("\t");
        return {
          evidenceSource: "host_packages",
          packageManager: "rpm",
          ...(name ? { rawPackageName: name } : {}),
          ...(version ? { rawVersion: version } : {}),
        };
      });
  }

  return [];
}

const defaultHostOsAdapter: HostOsAdapter = {
  hostname: os.hostname,
  platform: os.platform,
  release: os.release,
  arch: os.arch,
  cpus: os.cpus,
  totalmem: os.totalmem,
  networkInterfaces: os.networkInterfaces,
  installedSoftware: collectInstalledSoftware,
};

export async function collectHostDiscovery(
  ctx?: CollectorContext,
  osAdapter: HostOsAdapter = defaultHostOsAdapter,
): Promise<CollectorOutput> {
  const hostname = osAdapter.hostname();
  const software = (await osAdapter.installedSoftware()).map((entry) => ({
    ...entry,
    entityExternalRef: `host:${hostname}`,
  }));

  return {
    items: [
      {
        sourceKind: ctx?.sourceKind ?? "host",
        itemType: "host",
        name: hostname,
        externalRef: `host:${hostname}`,
        naturalKey: `hostname:${hostname}`,
        confidence: 1,
        attributes: {
          platform: osAdapter.platform(),
          release: osAdapter.release(),
          arch: osAdapter.arch(),
          cpuCount: osAdapter.cpus().length,
          totalMemoryBytes: osAdapter.totalmem(),
          networkInterfaces: osAdapter.networkInterfaces(),
        },
      },
    ],
    relationships: [],
    software,
  };
}
