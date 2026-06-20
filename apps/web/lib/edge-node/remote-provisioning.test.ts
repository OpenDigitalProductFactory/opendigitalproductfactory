import { describe, it, expect } from "vitest";

import {
  assessAuthorityUrl,
  buildRemoteProvisioningPlan,
  isLoopbackAuthorityUrl,
  renderEdgeInstallCommands,
  DEFAULT_COMPOSE_REF,
  DEFAULT_REPO_SLUG,
} from "./remote-provisioning";

const TOKEN = "dpfboot_abc123XYZ";
const GOOD_URL = "https://dpf-authority.lan:443";

describe("isLoopbackAuthorityUrl", () => {
  it.each([
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://127.5.9.9:3000",
    "https://0.0.0.0",
    "http://host.docker.internal:3000",
    "http://[::1]:3000",
  ])("flags %s as loopback (unreachable from another machine)", (url) => {
    expect(isLoopbackAuthorityUrl(url)).toBe(true);
  });

  it.each([
    "http://192.168.1.10:3000",
    "http://10.0.0.5:3000",
    "http://172.16.4.4:3000",
    "https://dpf-authority.lan",
    "https://portal.example.com",
    "http://my-host.local:3000",
  ])("treats %s as a reachable remote target", (url) => {
    expect(isLoopbackAuthorityUrl(url)).toBe(false);
  });

  it("returns false (not loopback) for an unparseable URL — assess flags it as missing", () => {
    expect(isLoopbackAuthorityUrl("not a url")).toBe(false);
  });
});

describe("assessAuthorityUrl", () => {
  it("flags a missing URL", () => {
    expect(assessAuthorityUrl(null).issues).toEqual(["missing"]);
    expect(assessAuthorityUrl("").issues).toEqual(["missing"]);
    expect(assessAuthorityUrl("   ").issues).toEqual(["missing"]);
  });

  it("flags an unparseable URL as missing (no url returned)", () => {
    const r = assessAuthorityUrl("::::");
    expect(r.url).toBe("");
    expect(r.issues).toContain("missing");
  });

  it("flags loopback + insecure-http for http://localhost", () => {
    const r = assessAuthorityUrl("http://localhost:3000");
    expect(r.issues).toContain("loopback");
    expect(r.issues).toContain("insecure-http");
  });

  it("accepts an https LAN/DNS host with no issues and strips trailing slashes", () => {
    const r = assessAuthorityUrl("https://dpf-authority.lan:443///");
    expect(r.url).toBe("https://dpf-authority.lan:443");
    expect(r.issues).toEqual([]);
  });

  it("flags only insecure-http for a reachable private-IP over http", () => {
    const r = assessAuthorityUrl("http://192.168.1.5:3000");
    expect(r.issues).toEqual(["insecure-http"]);
  });
});

describe("renderEdgeInstallCommands — Linux/macOS (works today, no clone)", () => {
  it("renders a single bash container one-liner with URL + token inlined", () => {
    const [cmd] = renderEdgeInstallCommands({ authorityUrl: GOOD_URL, bootstrapToken: TOKEN, os: "linux" });
    expect(cmd.kind).toBe("container");
    expect(cmd.shell).toBe("bash");
    expect(cmd.worksToday).toBe(true);
    // no repo clone — fetch the single compose file by URL
    expect(cmd.command).toContain("curl -fsSL");
    expect(cmd.command).toContain(
      `https://raw.githubusercontent.com/${DEFAULT_REPO_SLUG}/${DEFAULT_COMPOSE_REF}/docker-compose.edge-standalone.yml`,
    );
    // no .env edit — env passed inline, single-quoted
    expect(cmd.command).toContain(`DPF_AUTHORITY_URL='${GOOD_URL}'`);
    expect(cmd.command).toContain(`DPF_BOOTSTRAP_TOKEN='${TOKEN}'`);
    expect(cmd.command).toContain("docker compose -f docker-compose.edge-standalone.yml up -d");
  });

  it("omits DPF_EDGE_NODE_NAME when no name is given, includes it when given", () => {
    const without = renderEdgeInstallCommands({ authorityUrl: GOOD_URL, bootstrapToken: TOKEN, os: "linux" })[0];
    expect(without.command).not.toContain("DPF_EDGE_NODE_NAME");
    const withName = renderEdgeInstallCommands({
      authorityUrl: GOOD_URL,
      bootstrapToken: TOKEN,
      os: "linux",
      nodeName: "warehouse-2",
    })[0];
    expect(withName.command).toContain(`DPF_EDGE_NODE_NAME='warehouse-2'`);
  });

  it("labels macOS as enrollment-proof with a VM caveat", () => {
    const [cmd] = renderEdgeInstallCommands({ authorityUrl: GOOD_URL, bootstrapToken: TOKEN, os: "macos" });
    expect(cmd.shell).toBe("bash");
    expect(cmd.note?.toLowerCase()).toContain("vm");
  });

  it("honors repoSlug + composeRef overrides (pin to a release tag)", () => {
    const [cmd] = renderEdgeInstallCommands({
      authorityUrl: GOOD_URL,
      bootstrapToken: TOKEN,
      os: "linux",
      repoSlug: "acme/dpf",
      composeRef: "v1.2.3",
    });
    expect(cmd.command).toContain("https://raw.githubusercontent.com/acme/dpf/v1.2.3/docker-compose.edge-standalone.yml");
  });

  it("escapes a single quote in the token so the shell command stays safe", () => {
    const [cmd] = renderEdgeInstallCommands({
      authorityUrl: GOOD_URL,
      bootstrapToken: "dpfboot_a'b",
      os: "linux",
    });
    expect(cmd.command).toContain(`DPF_BOOTSTRAP_TOKEN='dpfboot_a'\\''b'`);
  });
});

describe("renderEdgeInstallCommands — Windows (PowerShell)", () => {
  it("renders a PowerShell container command with Invoke-WebRequest + env", () => {
    const [cmd] = renderEdgeInstallCommands({ authorityUrl: GOOD_URL, bootstrapToken: TOKEN, os: "windows" });
    expect(cmd.shell).toBe("powershell");
    expect(cmd.command).toContain("Invoke-WebRequest");
    expect(cmd.command).toContain(`$env:DPF_AUTHORITY_URL = '${GOOD_URL}'`);
    expect(cmd.command).toContain(`$env:DPF_BOOTSTRAP_TOKEN = '${TOKEN}'`);
    expect(cmd.command).toContain("docker compose -f docker-compose.edge-standalone.yml up -d");
  });

  it("escapes single quotes for PowerShell by doubling them", () => {
    const [cmd] = renderEdgeInstallCommands({
      authorityUrl: GOOD_URL,
      bootstrapToken: "dpfboot_a'b",
      os: "windows",
    });
    expect(cmd.command).toContain(`$env:DPF_BOOTSTRAP_TOKEN = 'dpfboot_a''b'`);
  });
});

describe("buildRemoteProvisioningPlan", () => {
  it("returns a clean plan for a reachable https URL", () => {
    const plan = buildRemoteProvisioningPlan({
      resolvedAuthorityUrl: GOOD_URL,
      bootstrapToken: TOKEN,
      os: "linux",
    });
    expect(plan.authorityUrl).toBe(GOOD_URL);
    expect(plan.authorityUrlIssues).toEqual([]);
    expect(plan.commands).toHaveLength(1);
    expect(plan.approveHint).toMatch(/pending/i);
    expect(plan.nativeBinaryNote).toMatch(/native/i);
  });

  it("flags a loopback URL but still renders a usable command shape", () => {
    const plan = buildRemoteProvisioningPlan({
      resolvedAuthorityUrl: "http://localhost:3000",
      bootstrapToken: TOKEN,
      os: "linux",
    });
    expect(plan.authorityUrlIssues).toContain("loopback");
    expect(plan.commands).toHaveLength(1);
    // the (unreachable) URL is still shown so the operator can swap the host
    expect(plan.commands[0].command).toContain("http://localhost:3000");
  });

  it("falls back to a visible placeholder host when no URL is configured", () => {
    const plan = buildRemoteProvisioningPlan({
      resolvedAuthorityUrl: null,
      bootstrapToken: TOKEN,
      os: "linux",
    });
    expect(plan.authorityUrlIssues).toEqual(["missing"]);
    expect(plan.authorityUrl).toContain("<your-portal-host>");
  });
});
