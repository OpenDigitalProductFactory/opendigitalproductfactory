import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readPrometheusConfig(name: string): string {
  return readFileSync(new URL(`../../../../monitoring/prometheus/${name}`, import.meta.url), "utf8");
}

function readRepoFile(path: string): string {
  return readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
}

describe("Prometheus substrate configs", () => {
  it("keeps Linux-only exporters out of the default scrape config", () => {
    const config = readPrometheusConfig("prometheus.yml");

    expect(config).toContain('job_name: "windows-host"');
    expect(config).not.toContain('targets: ["cadvisor:8080"]');
    expect(config).not.toContain('targets: ["node-exporter:9100"]');
  });

  it("keeps Linux exporter scrape targets in the Linux config", () => {
    const config = readPrometheusConfig("prometheus.linux.yml");

    expect(config).toContain('targets: ["cadvisor:8080"]');
    expect(config).toContain('targets: ["node-exporter:9100"]');
  });

  it("keeps the Windows-only windows-host job out of the macOS scrape config", () => {
    const config = readPrometheusConfig("prometheus.macos.yml");

    // windows_exporter is a native Windows service with no macOS equivalent;
    // scraping it would always fail and fire a false ContainerDown CRITICAL.
    expect(config).not.toContain('job_name: "windows-host"');
    // Linux-only exporters cannot run on macOS either.
    expect(config).not.toContain('targets: ["cadvisor:8080"]');
    expect(config).not.toContain('targets: ["node-exporter:9100"]');
    // Cross-platform jobs must still be scraped.
    expect(config).toContain('job_name: "portal"');
    expect(config).toContain('job_name: "postgres"');
    expect(config).toContain('job_name: "prometheus"');
  });

  it("mounts the macOS scrape config on the macOS overlay", () => {
    const config = readRepoFile("docker-compose.macos.yml");

    expect(config).toContain(
      "./monitoring/prometheus/prometheus.macos.yml:/etc/prometheus/prometheus.yml:ro",
    );
  });

  it("does not page optional Linux exporter jobs through the default ContainerDown rule", () => {
    const config = readPrometheusConfig("alerts.yml");

    expect(config).toContain('expr: up{job!~"cadvisor|node-exporter"} == 0');
    expect(config).not.toContain("expr: up == 0");
  });

  it("starts Linux exporter containers when the Linux scrape config is mounted", () => {
    const config = readRepoFile("docker-compose.linux.yml");

    expect(config.match(/profiles: !reset \[\]/g)).toHaveLength(2);
  });
});
