// The LDAP listener (EP-24741BBF · BI-F7317D65).
//
// Read-only by construction: it implements bind, search and unbind, and NOTHING
// else. Add, modify and delete are not merely unimplemented — they are refused
// with `unwillingToPerform`, because the directory is authoritative for being
// DERIVED from the Principal spine, not for being a second place to edit
// identity.

import { createServer, type Server, type TLSSocket } from "node:tls";

import type { DirectoryProjection } from "../projection";
import { frameMessages } from "./ber";
import {
  RESULT,
  decodeRequest,
  encodeBindResponse,
  encodeSearchResultDone,
  encodeSearchResultEntry,
  executeSearch,
} from "./protocol";
import type { LdapTlsMaterial } from "./tls";

/** Verifies a bind credential. Injected so the server never owns password logic. */
export type BindVerifier = (input: {
  bindDn: string;
  password: string;
  /** Subject CN of a presented client certificate, when the bind is mTLS. */
  clientCertificateSubject: string | null;
}) => Promise<{ bound: boolean; principalId?: string; reason?: string }>;

export type LdapServerOptions = {
  tls: LdapTlsMaterial;
  /** Rebuilt per connection so a bind never serves a stale tree. */
  loadProjection: () => Promise<DirectoryProjection>;
  verifyBind: BindVerifier;
  /** Require a client certificate. mTLS is the stronger posture; default off so
   *  password binds from ordinary clients still work. */
  requireClientCertificate?: boolean;
};

type SessionState = { boundDn: string | null; principalId: string | null };

/** Handle one framed message, returning the bytes to write back. */
export async function handleMessage(
  message: Buffer,
  session: SessionState,
  options: Pick<LdapServerOptions, "loadProjection" | "verifyBind">,
  clientCertificateSubject: string | null,
): Promise<{ response: Buffer | null; close: boolean }> {
  let request;
  try {
    request = decodeRequest(message);
  } catch {
    // A malformed PDU has no reliable messageId, so answer on 0 and close:
    // continuing to parse an unframed stream is how a parser gets confused.
    return { response: encodeBindResponse(0, RESULT.PROTOCOL_ERROR, "malformed request"), close: true };
  }

  switch (request.type) {
    case "unbind":
      return { response: null, close: true };

    case "bind": {
      if (request.version !== 3) {
        return {
          response: encodeBindResponse(request.messageId, RESULT.PROTOCOL_ERROR, "LDAPv3 required"),
          close: false,
        };
      }
      const verdict = await options.verifyBind({
        bindDn: request.name,
        password: request.password,
        clientCertificateSubject,
      });
      if (!verdict.bound) {
        session.boundDn = null;
        session.principalId = null;
        return {
          response: encodeBindResponse(
            request.messageId,
            RESULT.INVALID_CREDENTIALS,
            verdict.reason ?? "invalid credentials",
          ),
          close: false,
        };
      }
      session.boundDn = request.name;
      session.principalId = verdict.principalId ?? null;
      return { response: encodeBindResponse(request.messageId, RESULT.SUCCESS), close: false };
    }

    case "search": {
      const projection = await options.loadProjection();
      const outcome = executeSearch(request, projection, session);
      if (!outcome.searched) {
        return {
          response: encodeSearchResultDone(request.messageId, outcome.resultCode, outcome.diagnostic),
          close: false,
        };
      }
      const parts = outcome.entries.map((entry) =>
        encodeSearchResultEntry(request.messageId, entry.dn, entry.attributes),
      );
      parts.push(encodeSearchResultDone(request.messageId, outcome.resultCode));
      return { response: Buffer.concat(parts), close: false };
    }

    default:
      // Add / modify / delete and everything else: refused, not ignored.
      return {
        response: encodeSearchResultDone(
          request.messageId,
          RESULT.UNWILLING_TO_PERFORM,
          "this directory is a read-only projection of the Principal spine",
        ),
        close: false,
      };
  }
}

/** Create the LDAPS listener. Call `.listen(port)` to start it. */
export function createLdapServer(options: LdapServerOptions): Server {
  return createServer(
    {
      key: options.tls.key,
      cert: options.tls.cert,
      ca: options.tls.ca,
      requestCert: true,
      rejectUnauthorized: options.requireClientCertificate ?? false,
    },
    (socket: TLSSocket) => {
      const session: SessionState = { boundDn: null, principalId: null };
      const peer = socket.getPeerCertificate?.();
      // A certificate CN may be a string OR an array when the subject repeats
      // the attribute. Take the first, so a multi-CN cert cannot smuggle a
      // second identity past the bind comparison.
      const rawCn = peer && Object.keys(peer).length > 0 ? peer.subject?.CN : undefined;
      const clientCertificateSubject =
        (Array.isArray(rawCn) ? rawCn[0] : rawCn) ?? null;
      // Explicitly `Buffer` (ArrayBufferLike): Buffer.concat widens the type
      // relative to Buffer.alloc, so an inferred binding rejects the reassignment.
      let buffered: Buffer = Buffer.alloc(0);

      socket.on("data", (chunk: Buffer) => {
        buffered = Buffer.concat([buffered, chunk]);
        const { messages, rest } = frameMessages(buffered);
        buffered = rest;
        void (async () => {
          for (const message of messages) {
            const { response, close } = await handleMessage(
              message,
              session,
              options,
              clientCertificateSubject,
            );
            if (response) socket.write(response);
            if (close) {
              socket.end();
              return;
            }
          }
        })().catch(() => socket.destroy());
      });

      socket.on("error", () => socket.destroy());
    },
  );
}
