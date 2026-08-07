// Connection-readiness preflight for the federation pairing surface.
//
// A HTTP/LAN install needs THREE install-local `.env` values before it can
// pair with a peer, and getting one wrong fails the handshake with an opaque
// 401/"base URL not configured" rather than a legible message:
//   1. DPF_FEDERATION_EXCHANGE_ENABLED — the exchange surface itself.
//   2. PUBLIC_URL (or NEXT_PUBLIC_*) — the Authority URL this install advertises
//      to a peer during enroll; without it resolveAppBaseUrl() returns null in
//      production and enroll fails (BI-9D2E4F17).
//   3. DPF_FEDERATION_ALLOW_INSECURE_PEERS — required only when this install's
//      own address is http / a private-LAN host, otherwise the outbound peer
//      request is SSRF-blocked (safePeerRequestUrl in ./client.ts) and inbound
//      peer POSTs are refused.
//
// This module derives a legible checklist from the environment so the operator
// SEES which of the three is missing and the exact line to add — instead of
// discovering it through a failed pairing. Pure and env-injected for testing;
// the page computes it from process.env server-side. No secrets are read.

import { envFlagEnabled } from "@/lib/runtime/env-flags";

export type ConnectionReadinessItemStatus = "ok" | "action-required" | "not-applicable";

export interface ConnectionReadinessItem {
  key: "exchange" | "self-address" | "lan-peers";
  /** Short human label for the checklist row. */
  label: string;
  status: ConnectionReadinessItemStatus;
  /** One-line explanation of the current state. */
  detail: string;
  /** The exact `.env` line to add when action is required (operator-applied). */
  fix?: string;
}

export interface ConnectionReadiness {
  overall: "ready" | "action-required";
  items: ConnectionReadinessItem[];
}

/** Mirror of resolveAppBaseUrl()'s precedence, env-injected so the readiness
 *  check is pure and testable. Returns the trimmed self URL or null. */
function resolveSelfUrl(env: Record<string, string | undefined>): string | null {
  const configured =
    env.NEXT_PUBLIC_BASE_URL || env.NEXT_PUBLIC_APP_URL || env.PUBLIC_URL;
  if (configured && configured.trim()) return configured.trim().replace(/\/+$/, "");
  return null;
}

/** True when the self URL is a transport that needs allow-insecure to reach
 *  peers: plaintext http, or a loopback / private-LAN host on any scheme. */
function selfUrlNeedsInsecurePeers(selfUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(selfUrl);
  } catch {
    // Unparseable — treat conservatively as needing the flag; the self-address
    // row already flags the malformed value.
    return true;
  }
  if (url.protocol === "http:") return true;
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) return true;
  if (host === "::1" || host.startsWith("127.")) return true;
  // RFC1918 private ranges.
  if (host.startsWith("10.") || host.startsWith("192.168.")) return true;
  const m = /^172\.(\d{1,3})\./.exec(host);
  if (m) {
    const second = Number(m[1]);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}

/** Derive the pairing-readiness checklist from the environment. */
export function computeConnectionReadiness(
  env: Record<string, string | undefined>,
): ConnectionReadiness {
  const items: ConnectionReadinessItem[] = [];

  // 1. Exchange surface.
  const exchangeOn = envFlagEnabled(env, "DPF_FEDERATION_EXCHANGE_ENABLED");
  items.push(
    exchangeOn
      ? {
          key: "exchange",
          label: "Exchange enabled",
          status: "ok",
          detail: "Demand can cross a connection.",
        }
      : {
          key: "exchange",
          label: "Exchange enabled",
          status: "action-required",
          detail: "Exchange is off; nothing will cross a connection.",
          fix: "DPF_FEDERATION_EXCHANGE_ENABLED=1",
        },
  );

  // 2. Self address (Authority URL advertised during enroll).
  const selfUrl = resolveSelfUrl(env);
  items.push(
    selfUrl
      ? {
          key: "self-address",
          label: "This installation's address",
          status: "ok",
          detail: `Peers reach it at ${selfUrl}.`,
        }
      : {
          key: "self-address",
          label: "This installation's address",
          status: "action-required",
          detail: "No address is set for a peer to reach this installation.",
          fix: "PUBLIC_URL=http://<this installation's LAN address>:3000",
        },
  );

  // 3. LAN peers — only relevant when the self address is http / private-LAN.
  const allowInsecure = envFlagEnabled(env, "DPF_FEDERATION_ALLOW_INSECURE_PEERS");
  const insecureTransport = selfUrl ? selfUrlNeedsInsecurePeers(selfUrl) : true;
  if (selfUrl && !insecureTransport) {
    items.push({
      key: "lan-peers",
      label: "Local-network peers",
      status: "not-applicable",
      detail: "Not needed on HTTPS.",
    });
  } else {
    items.push(
      allowInsecure
        ? {
            key: "lan-peers",
            label: "Local-network peers",
            status: "ok",
            detail: "Local-network peers are allowed.",
          }
        : {
            key: "lan-peers",
            label: "Local-network peers",
            status: "action-required",
            detail: "Local-network (http) peers are blocked.",
            fix: "DPF_FEDERATION_ALLOW_INSECURE_PEERS=1",
          },
    );
  }

  const overall = items.some((i) => i.status === "action-required")
    ? "action-required"
    : "ready";
  return { overall, items };
}
