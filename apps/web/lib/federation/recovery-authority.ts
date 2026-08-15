export type RecoveryAuthorityResult =
  | { ok: true; authorityUrl: string }
  | { ok: false; enteredValue: string; message: string };

/** Forgiving only about human formatting. The resulting value is still an
 * origin and is passed through the federation client's SSRF gate before use. */
export function normalizeRecoveryAuthority(value: string): RecoveryAuthorityResult {
  const enteredValue = value.trim();
  if (!enteredValue) {
    return { ok: false, enteredValue, message: "Enter the installation host, IP address, or full HTTPS origin." };
  }
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(enteredValue)
    ? enteredValue
    : `https://${enteredValue}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, enteredValue, message: "Enter a valid host, IP address, or HTTPS origin." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, enteredValue, message: "Recovery connections support only HTTPS or HTTP origins." };
  }
  if (url.username || url.password) {
    return { ok: false, enteredValue, message: "Do not include a username or password in the installation address." };
  }
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
    return {
      ok: false,
      enteredValue,
      message: "Enter only the installation host or origin, without a path, query, or fragment.",
    };
  }
  return { ok: true, authorityUrl: url.origin };
}
