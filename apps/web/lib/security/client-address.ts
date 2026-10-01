// Rate-limit and audit key for the client behind an inbound request.
//
// X-Forwarded-For is appended to by each proxy on the way in, so its LEFTMOST
// entry is whatever the client chose to send and its RIGHTMOST entry was
// written by the proxy nearest the portal (a tunnel connector or reverse
// proxy). Keying a per-client limit on the leftmost entry lets a caller rotate
// it to dodge the limit; the rightmost entry is the address the nearest proxy
// actually saw. With no proxy in front (a LAN client talking to the portal
// directly) every forwarding header is client-supplied, so this is a best-effort
// key either way and is never an authentication or authorization signal.

const MAX_KEY_LENGTH = 80;

/** Address key for per-client rate limits and audit fields. */
export function clientAddressKey(headers: Pick<Headers, "get">): string {
  const forwarded = headers
    .get("x-forwarded-for")
    ?.split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const nearestProxyView = forwarded && forwarded.length > 0 ? forwarded[forwarded.length - 1] : undefined;
  const value = nearestProxyView || headers.get("x-real-ip")?.trim() || "unknown";
  return value.length <= MAX_KEY_LENGTH ? value : value.slice(0, MAX_KEY_LENGTH);
}
