import { describe, expect, it } from "vitest";
import { interpretSmtpError } from "./smtp-error";

describe("interpretSmtpError", () => {
  it("maps a Microsoft 365 SMTP-AUTH-disabled 535 to actionable guidance + link", () => {
    // The live shape nodemailer throws for the M365 tenant case (BI-6AA848A7).
    const err = Object.assign(new Error("Invalid login: 535 5.7.139 Authentication unsuccessful"), {
      code: "EAUTH",
      responseCode: 535,
      command: "AUTH LOGIN",
      response:
        "535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled for the Tenant. Visit https://aka.ms/smtp_auth_disabled",
    });

    const info = interpretSmtpError(err);

    expect(info.responseCode).toBe(535);
    expect(info.code).toBe("EAUTH");
    expect(info.command).toBe("AUTH LOGIN");
    expect(info.message).toMatch(/SMTP AUTH/i);
    expect(info.message).toMatch(/admin/i);
    expect(info.serverResponse).toContain("SmtpClientAuthentication is disabled");
    // Link is extracted from the server response (trailing punctuation trimmed).
    expect(info.remediationUrl).toBe("https://aka.ms/smtp_auth_disabled");
  });

  it("falls back to the well-known M365 link when the response omits the URL", () => {
    const err = Object.assign(new Error("auth failed"), {
      code: "EAUTH",
      responseCode: 535,
      response: "535 5.7.139 Authentication unsuccessful, SmtpClientAuthentication is disabled",
    });
    expect(interpretSmtpError(err).remediationUrl).toBe("https://aka.ms/smtp_auth_disabled");
  });

  it("gives a generic credential hint for a plain auth rejection", () => {
    const err = Object.assign(new Error("Invalid login"), {
      code: "EAUTH",
      responseCode: 535,
      command: "AUTH LOGIN",
      response: "535 Incorrect authentication data",
    });
    const info = interpretSmtpError(err);
    expect(info.message).toMatch(/username or password/i);
    expect(info.message).toMatch(/app password/i);
    expect(info.remediationUrl).toBeUndefined();
  });

  it("explains a connection failure (bad host/port)", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNECTION" });
    expect(interpretSmtpError(err).message).toMatch(/Host and Port/i);
  });

  it("explains an envelope rejection (bad sender/recipient)", () => {
    const err = Object.assign(new Error("bad sender"), {
      code: "EENVELOPE",
      responseCode: 550,
      response: "550 5.7.1 Sender address rejected",
    });
    expect(interpretSmtpError(err).message).toMatch(/sender or recipient/i);
  });

  it("echoes the raw server response for an unclassified rejection", () => {
    const err = Object.assign(new Error("nope"), {
      responseCode: 421,
      response: "421 Service not available",
    });
    const info = interpretSmtpError(err);
    expect(info.message).toContain("421 Service not available");
    expect(info.responseCode).toBe(421);
  });

  it("tolerates a bare Error with no SMTP fields", () => {
    const info = interpretSmtpError(new Error("kaboom"));
    expect(info.message).toBe("kaboom");
    expect(info.responseCode).toBeUndefined();
  });

  it("tolerates a non-error value", () => {
    expect(interpretSmtpError("just a string").message).toBe("just a string");
    expect(interpretSmtpError(undefined).message).toBe("The test email could not be sent.");
  });

  it("tolerates a stringified responseCode", () => {
    const err = Object.assign(new Error("x"), { code: "EAUTH", responseCode: "535" });
    expect(interpretSmtpError(err).responseCode).toBe(535);
  });
});
