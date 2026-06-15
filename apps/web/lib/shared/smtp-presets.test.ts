import { describe, expect, it } from "vitest";
import {
  SMTP_PRESETS,
  getSmtpPreset,
  domainFromEmailOrUrl,
  detectPresetByDomain,
  detectPresetByMxHosts,
} from "./smtp-presets";

describe("SMTP_PRESETS catalog", () => {
  it("every preset is internally consistent (id matches key, sane port/secure)", () => {
    for (const [key, p] of Object.entries(SMTP_PRESETS)) {
      expect(p.id).toBe(key);
      expect(p.host).toMatch(/\./);
      expect(p.port).toBeGreaterThan(0);
      expect(p.port).toBeLessThanOrEqual(65535);
      // implicit-TLS convention: secure ⇔ 465 for the providers we ship
      if (p.secure) expect(p.port).toBe(465);
      expect(p.credentialHint.length).toBeGreaterThan(10);
    }
  });

  it("getSmtpPreset returns the preset for a known id and null otherwise", () => {
    expect(getSmtpPreset("google-workspace")?.host).toBe("smtp.gmail.com");
    expect(getSmtpPreset("nope")).toBeNull();
  });
});

describe("domainFromEmailOrUrl", () => {
  it("extracts the domain from an email address", () => {
    expect(domainFromEmailOrUrl("Billing@Acme.com")).toBe("acme.com");
    expect(domainFromEmailOrUrl("a.b+tag@mail.example.co.uk")).toBe("mail.example.co.uk");
  });

  it("extracts the host from a website url and strips scheme/path/www/port", () => {
    expect(domainFromEmailOrUrl("https://www.acme.com/contact")).toBe("acme.com");
    expect(domainFromEmailOrUrl("http://acme.com:8080")).toBe("acme.com");
    expect(domainFromEmailOrUrl("acme.com")).toBe("acme.com");
  });

  it("returns null for empty/garbage/single-label input", () => {
    expect(domainFromEmailOrUrl(null)).toBeNull();
    expect(domainFromEmailOrUrl("")).toBeNull();
    expect(domainFromEmailOrUrl("   ")).toBeNull();
    expect(domainFromEmailOrUrl("localhost")).toBeNull();
    expect(domainFromEmailOrUrl("two words")).toBeNull();
  });
});

describe("detectPresetByDomain (consumer mailboxes)", () => {
  it("maps well-known consumer domains to their provider", () => {
    expect(detectPresetByDomain("gmail.com")?.id).toBe("google-workspace");
    expect(detectPresetByDomain("GMAIL.COM")?.id).toBe("google-workspace");
    expect(detectPresetByDomain("hotmail.com")?.id).toBe("outlook");
    expect(detectPresetByDomain("icloud.com")?.id).toBe("icloud");
  });

  it("returns null for a custom business domain (resolve those by MX)", () => {
    expect(detectPresetByDomain("acme.com")).toBeNull();
    expect(detectPresetByDomain(null)).toBeNull();
  });
});

describe("detectPresetByMxHosts (custom domains)", () => {
  it("detects Google Workspace from MX exchanges", () => {
    expect(
      detectPresetByMxHosts(["aspmx.l.google.com.", "alt1.aspmx.l.google.com."])?.id,
    ).toBe("google-workspace");
  });

  it("detects Microsoft 365 from the protection.outlook.com exchange", () => {
    expect(detectPresetByMxHosts(["acme-com.mail.protection.outlook.com"])?.id).toBe(
      "microsoft-365",
    );
  });

  it("detects GoDaddy and Namecheap by registrar mail hosts", () => {
    expect(detectPresetByMxHosts(["smtp.secureserver.net"])?.id).toBe("godaddy");
    expect(detectPresetByMxHosts(["mx1.privateemail.com"])?.id).toBe(
      "namecheap-privateemail",
    );
  });

  it("is case- and trailing-dot-insensitive and returns null when nothing matches", () => {
    expect(detectPresetByMxHosts(["MX.ZOHO.COM."])?.id).toBe("zoho");
    expect(detectPresetByMxHosts(["mail.some-unknown-host.net"])).toBeNull();
    expect(detectPresetByMxHosts([])).toBeNull();
  });
});
