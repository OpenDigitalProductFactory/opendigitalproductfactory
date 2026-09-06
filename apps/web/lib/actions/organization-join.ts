"use server";

// EP-ZERO-CONFIG-FEDERATION — the session-gated boundary for connecting an
// organization's own installations. Both acts are portal-mediated (spec
// docs/superpowers/specs/2026-09-03-portal-mediated-organization-membership-design.md
// §5.2–5.3): the authority portal mints the join file itself and the member
// portal certifies itself through the authority's portal. The edge-node host
// actions that used to carry this (BI-A8399604) are retired from the page;
// no browser code executes a host command.

import { revalidatePath } from "next/cache";

import { auth } from "@/lib/auth";
import { importOrganizationJoinFile } from "@/lib/federation/organization-join-import";
import { issueOrganizationJoinFile } from "@/lib/federation/organization-join-issue";
import { resolveLocalFederationAuthorityUrl } from "@/lib/federation/self-authority";
import { can } from "@/lib/permissions";
import { ok, type ActionSuccess } from "@/lib/shared/action-result";

const CONNECTIONS_PATH = "/platform/federation-links";
const JOIN_FILE_MAX_BYTES = 64 * 1024;

export type OrganizationJoinActionFailure = {
  ok: false;
  error: "unauthorized" | "forbidden" | "invalid_input" | "not_ready" | "conflict" | "internal_error";
  message: string;
};

async function assertManagePlatform(): Promise<OrganizationJoinActionFailure | null> {
  const session = await auth();
  if (!session?.user?.id) return { ok: false, error: "unauthorized", message: "Sign in required" };
  if (!can({ platformRole: session.user.platformRole, isSuperuser: session.user.isSuperuser }, "manage_platform")) {
    return { ok: false, error: "forbidden", message: "Platform management access is required" };
  }
  return null;
}

export interface OrganizationJoinFileIssued {
  fileName: string;
  content: string;
  intendedPeer: string;
  expiresAt: string;
}

/**
 * The authority portal mints the join file itself — no edge node, no host
 * script. Returned once; the browser downloads it and it expires in 30 minutes.
 */
export async function issueOrganizationJoinFileAction(input: { intendedPeer: string }): Promise<
  ActionSuccess<OrganizationJoinFileIssued> | OrganizationJoinActionFailure
> {
  const refused = await assertManagePlatform();
  if (refused) return refused;
  const intendedPeer = typeof input?.intendedPeer === "string" ? input.intendedPeer.trim() : "";
  if (!intendedPeer) return { ok: false, error: "invalid_input", message: "Choose the installation the file is for" };
  const requestHost = await resolveLocalFederationAuthorityUrl();
  const result = await issueOrganizationJoinFile({ intendedPeer, requestHost });
  if (!result.issued) return joinIssueFailure(result.reason, result.detail);
  revalidatePath(CONNECTIONS_PATH);
  return ok({ fileName: result.fileName, content: result.packageText, intendedPeer: result.intendedPeer, expiresAt: result.expiresAt });
}

export interface OrganizationJoinImported {
  authorityUrl: string;
  intendedPeer: string;
  message: string;
}

/**
 * Choosing the join file is the whole act: the portal generates a key, has the
 * organization CA sign it through the authority's portal, keeps the material
 * in the federation state directory, and the next federation tick records the
 * link trusted on both sides.
 */
export async function importOrganizationJoinFileAction(fileText: string): Promise<
  ActionSuccess<OrganizationJoinImported> | OrganizationJoinActionFailure
> {
  const refused = await assertManagePlatform();
  if (refused) return refused;
  if (typeof fileText !== "string" || !fileText.trim() || Buffer.byteLength(fileText, "utf8") > JOIN_FILE_MAX_BYTES) {
    return { ok: false, error: "invalid_input", message: "This is not a valid DPF organization join file" };
  }
  const requestHost = await resolveLocalFederationAuthorityUrl();
  const result = await importOrganizationJoinFile({ fileText, requestHost });
  if (!result.imported) return joinImportFailure(result.reason, result.detail);
  revalidatePath(CONNECTIONS_PATH);
  return ok({
    authorityUrl: result.authorityUrl,
    intendedPeer: result.intendedPeer,
    message: `Joined the organization at ${new URL(result.authorityUrl).host}. The connection appears here trusted within a few minutes.`,
  });
}

function joinIssueFailure(reason: string, detail?: string): OrganizationJoinActionFailure {
  switch (reason) {
    case "not-the-authority":
      return { ok: false, error: "not_ready", message: "Only the organization installation (the one that holds the organization's certificate authority) can create join files" };
    case "invalid-intended-peer":
      return { ok: false, error: "invalid_input", message: "The installation name is not a valid host name or address" };
    case "own-address-unknown":
      return { ok: false, error: "not_ready", message: "Open this page at the installation's network address (not localhost) so the file can name it" };
    case "ca-unreachable":
    case "provisioner-missing":
    case "provisioner-key-locked":
      return { ok: false, error: "not_ready", message: `The organization's certificate authority could not issue the file${detail ? ` (${detail})` : ""}` };
    default:
      return { ok: false, error: "internal_error", message: "The join file could not be created" };
  }
}

function joinImportFailure(reason: string, detail?: string): OrganizationJoinActionFailure {
  switch (reason) {
    case "join-package-expired":
      return { ok: false, error: "invalid_input", message: "The join file has expired. Create a new one on the organization installation" };
    case "intended-for-another-host":
      return { ok: false, error: "invalid_input", message: "The join file was created for another installation" };
    case "authority-unreachable":
      return { ok: false, error: "not_ready", message: `The organization installation could not be reached${detail ? ` (${detail})` : ""}` };
    case "authority-refused":
      return { ok: false, error: "conflict", message: `The organization installation refused the join file${detail ? ` (${detail})` : ""}. Create a new one and try again` };
    case "chain-untrusted":
      return { ok: false, error: "conflict", message: "The certificate the organization installation returned does not match the join file's trust fingerprint" };
    case "material-not-writable":
      return { ok: false, error: "not_ready", message: `This installation's state directory is not writable${detail ? ` (${detail})` : ""}` };
    default:
      return { ok: false, error: "invalid_input", message: "This is not a valid DPF organization join file" };
  }
}
