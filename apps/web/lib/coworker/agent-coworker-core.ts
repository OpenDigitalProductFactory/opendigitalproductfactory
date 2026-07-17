// apps/web/lib/coworker/agent-coworker-core.ts
//
// Pure (no prisma / auth / Next.js) domain helpers for the agent-coworker
// server actions: portal-context path normalization, route/build/capsule id
// derivation from a route context, portal-context prompt-section formatting,
// and the substantive-output guard used before persisting a response artifact.
// Extracted verbatim from lib/actions/agent-coworker.ts (BI-OPT-FAT-ACTIONS,
// agent-coworker slice) so the deterministic domain logic lives in the coworker
// domain layer and is unit-testable on its own. Behavior-preserving relocation
// — identical bodies.

import type { PortalObjectAnchor } from "@/lib/portal-context";

export function formatPortalContextPromptSection(promptDigest: string, anchors: PortalObjectAnchor[]): string | null {
  const digest = promptDigest.trim();
  const anchorLine = anchors.length
    ? `Anchors: ${anchors.map((anchor) => `${anchor.kind}:${anchor.id}`).join(", ")}`
    : null;
  const lines = ["--- PORTAL CONTEXT ---", digest, anchorLine].filter((line): line is string => Boolean(line));
  return lines.length > 1 ? lines.join("\n") : null;
}

export function isSubstantiveCoworkerOutput(content: string): boolean {
  const trimmed = content.trim();
  if (trimmed.length < 40) return false;
  return !/^(?:ok|yes|no|thanks|thank you|sure|got it|hello|hi|hey)$/i.test(trimmed);
}

export function normalizePortalContextPathname(routeContext: string): string {
  return routeContext.split("#")[0]?.split("?")[0] || routeContext;
}

export function normalizePortalContextRoute(pathname: string): string {
  if (pathname === "/build" || pathname.startsWith("/build/")) {
    return pathname.startsWith("/build/work") ? "/build/work" : "/build";
  }
  return pathname;
}

export function isPortalContextSupportedPath(pathname: string): boolean {
  // /build and /build/work were the original surfaces. D29 (2026-05-23)
  // extends to /platform/ai/* so the coworker on the providers/configuration
  // pages gets the build-studio capability snapshot in its prompt and can
  // give concrete "connect this provider" advice instead of generic
  // "wait and try again" hedging.
  return (
    pathname === "/build" ||
    pathname.startsWith("/build/work") ||
    pathname === "/platform/ai" ||
    pathname.startsWith("/platform/ai/")
  );
}

export function resolveBuildIdFromRouteContext(routeContext: string): string | null {
  const hash = routeContext.match(/^\/build#([^?#/]+)$/);
  return hash?.[1] ? decodeURIComponent(hash[1]) : null;
}

export function resolveCapsuleIdFromPathname(pathname: string): string | null {
  const match = pathname.match(/^\/build\/work\/([^/]+)$/);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}
