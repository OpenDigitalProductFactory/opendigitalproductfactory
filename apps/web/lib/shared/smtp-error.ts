// Turn a raw nodemailer/SMTP failure into something an operator can act on.
//
// Why this exists: a failed test-send used to throw the raw nodemailer error out
// of the "use server" action. In a production build Next.js redacts thrown
// server-action messages ("The specific message is omitted in production
// builds…"), so the operator saw a generic Server Components error instead of
// the real reason — e.g. a Microsoft 365 tenant with SMTP AUTH disabled. The fix
// is to CATCH the error server-side and RETURN it as ordinary data; this module
// is the pure interpretation step so the settings UI and any future caller share
// one mapping and it unit-tests without a live SMTP server.
//
// Pure + framework-free (no DB, no nodemailer import) — nodemailer error objects
// are plain objects with a documented, stable field shape (code/responseCode/
// command/response), so we read them structurally rather than by instanceof.

export type SmtpErrorInfo = {
  /** Friendly, actionable one-liner for the operator. */
  message: string;
  /** SMTP/enhanced response code when present (e.g. 535, 550). */
  responseCode?: number;
  /** nodemailer error code when present (e.g. "EAUTH", "ECONNECTION"). */
  code?: string;
  /** The SMTP command that failed (e.g. "AUTH LOGIN"). */
  command?: string;
  /** Raw server response line, shown verbatim so the operator can search it. */
  serverResponse?: string;
  /** A remediation link when we can identify one (extracted or well-known). */
  remediationUrl?: string;
};

function readString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function readNumber(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  // Some transports stringify the code; tolerate a numeric string.
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number.parseInt(v, 10);
  return undefined;
}

/** Pull the first http(s) URL out of a free-text SMTP response, if any. */
function firstUrl(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const m = text.match(/https?:\/\/[^\s"'<>)]+/i);
  // Trim a trailing period the server sometimes appends after the link.
  return m ? m[0].replace(/[.,]+$/, "") : undefined;
}

/**
 * Interpret a nodemailer/SMTP send failure into operator-facing detail.
 * Always returns something usable — falls back to the raw message when the
 * error shape is unfamiliar.
 */
export function interpretSmtpError(err: unknown): SmtpErrorInfo {
  const obj: Record<string, unknown> =
    err && typeof err === "object" ? (err as Record<string, unknown>) : {};

  const code = readString(obj, "code");
  const responseCode = readNumber(obj, "responseCode");
  const command = readString(obj, "command");
  const serverResponse = readString(obj, "response");
  const rawMessage =
    readString(obj, "message") ?? (typeof err === "string" ? err.trim() : undefined);

  const haystack = `${serverResponse ?? ""} ${rawMessage ?? ""}`.toLowerCase();
  let remediationUrl = firstUrl(serverResponse) ?? firstUrl(rawMessage);

  const isAuth = code === "EAUTH" || responseCode === 535 || responseCode === 534;
  const isConnection =
    code === "ECONNECTION" ||
    code === "ETIMEDOUT" ||
    code === "ESOCKET" ||
    code === "EDNS" ||
    code === "ECONNREFUSED";
  const isEnvelope =
    code === "EENVELOPE" || responseCode === 550 || responseCode === 553 || responseCode === 554;

  let message: string;

  if (isAuth && haystack.includes("smtpclientauthentication is disabled")) {
    // Microsoft 365 tenants disable Authenticated SMTP by default.
    message =
      "Your Microsoft 365 tenant has SMTP AUTH (Authenticated SMTP) disabled, so the mailbox can't sign in to send. Ask your Microsoft 365 admin to enable Authenticated SMTP for this mailbox, then send the test again.";
    remediationUrl = remediationUrl ?? "https://aka.ms/smtp_auth_disabled";
  } else if (isAuth) {
    message =
      "The mail server rejected the sign-in — the username or password is wrong, or this provider needs an app password instead of your normal password. Double-check the Username and Password above and try again.";
  } else if (isConnection) {
    message =
      "Couldn't reach the mail server. Check that the Host and Port are correct and that the server accepts connections (a firewall or the wrong TLS/SSL setting can also cause this).";
  } else if (isEnvelope) {
    message =
      "The mail server rejected the sender or recipient address. Make sure the From address is a mailbox this account is allowed to send as.";
  } else if (serverResponse) {
    message = `The mail server rejected the test send: ${serverResponse}`;
  } else {
    message = rawMessage ?? "The test email could not be sent.";
  }

  return {
    message,
    ...(responseCode !== undefined ? { responseCode } : {}),
    ...(code ? { code } : {}),
    ...(command ? { command } : {}),
    ...(serverResponse ? { serverResponse } : {}),
    ...(remediationUrl ? { remediationUrl } : {}),
  };
}
