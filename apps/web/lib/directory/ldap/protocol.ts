// LDAP message decode/encode and the search engine (RFC 4511)
// — EP-24741BBF · BI-F7317D65.

import type { DirectoryEntry, DirectoryProjection } from "../projection";
import { dnEquals, isWithinSubtree } from "../dn";
import {
  APP,
  BerReader,
  TAG,
  berElement,
  berInteger,
  berSequence,
  berSet,
  berString,
} from "./ber";
import { decodeFilter, matchesFilter, type LdapFilter } from "./filter";

export const RESULT = {
  SUCCESS: 0,
  PROTOCOL_ERROR: 2,
  SIZE_LIMIT_EXCEEDED: 4,
  NO_SUCH_OBJECT: 32,
  INVALID_CREDENTIALS: 49,
  INSUFFICIENT_ACCESS: 50,
  UNWILLING_TO_PERFORM: 53,
} as const;

export const SCOPE = { BASE: 0, ONE_LEVEL: 1, SUBTREE: 2 } as const;

/** Hard ceiling on entries returned by one search — an unbounded search is a DoS. */
export const MAX_SEARCH_RESULTS = 500;

const SIMPLE_AUTH_TAG = 0x80;

export type BindRequest = {
  type: "bind";
  messageId: number;
  version: number;
  name: string;
  password: string;
};
export type SearchRequest = {
  type: "search";
  messageId: number;
  baseObject: string;
  scope: number;
  sizeLimit: number;
  filter: LdapFilter;
  attributes: string[];
};
export type UnbindRequest = { type: "unbind"; messageId: number };
export type UnknownRequest = { type: "unknown"; messageId: number; tag: number };
export type LdapRequest = BindRequest | SearchRequest | UnbindRequest | UnknownRequest;

/** Decode one framed LDAPMessage. */
export function decodeRequest(message: Buffer): LdapRequest {
  const envelope = new BerReader(message).readConstructed(TAG.SEQUENCE);
  const messageId = envelope.readInteger();
  const tag = envelope.peekTag();
  if (tag === null) throw new Error("LDAP: message with no protocol op");

  switch (tag) {
    case APP.BIND_REQUEST: {
      const body = envelope.readConstructed(APP.BIND_REQUEST);
      const version = body.readInteger();
      const name = body.readString();
      // Only simple authentication is accepted. SASL is a separate decision and
      // is refused rather than silently downgraded.
      const auth = body.readElement();
      if (auth.tag !== SIMPLE_AUTH_TAG) {
        return { type: "bind", messageId, version, name, password: "" };
      }
      return { type: "bind", messageId, version, name, password: auth.value.toString("utf8") };
    }
    case APP.SEARCH_REQUEST: {
      const body = envelope.readConstructed(APP.SEARCH_REQUEST);
      const baseObject = body.readString();
      const scope = body.readInteger(TAG.ENUMERATED);
      body.readInteger(TAG.ENUMERATED); // derefAliases — not honoured, read to stay framed
      const sizeLimit = body.readInteger();
      body.readInteger(); // timeLimit
      body.readBoolean(); // typesOnly
      const filter = decodeFilter(body);
      const attributes: string[] = [];
      if (body.remaining > 0) {
        const list = body.readConstructed(TAG.SEQUENCE);
        while (list.remaining > 0) attributes.push(list.readString());
      }
      return { type: "search", messageId, baseObject, scope, sizeLimit, filter, attributes };
    }
    case APP.UNBIND_REQUEST: {
      envelope.readElement(APP.UNBIND_REQUEST);
      return { type: "unbind", messageId };
    }
    default:
      return { type: "unknown", messageId, tag };
  }
}

function ldapMessage(messageId: number, protocolOp: Buffer): Buffer {
  return berSequence(berInteger(messageId), protocolOp);
}

export function encodeBindResponse(
  messageId: number,
  resultCode: number,
  diagnostic = "",
): Buffer {
  return ldapMessage(
    messageId,
    berElement(
      APP.BIND_RESPONSE,
      Buffer.concat([
        berInteger(resultCode, TAG.ENUMERATED),
        berString(""), // matchedDN
        berString(diagnostic),
      ]),
    ),
  );
}

export function encodeSearchResultEntry(
  messageId: number,
  dn: string,
  attributes: Record<string, string[]>,
): Buffer {
  const attrs = Object.entries(attributes).map(([name, values]) =>
    berSequence(berString(name), berSet(...values.map((value) => berString(value)))),
  );
  return ldapMessage(
    messageId,
    berElement(
      APP.SEARCH_RESULT_ENTRY,
      Buffer.concat([berString(dn), berSequence(...attrs)]),
    ),
  );
}

export function encodeSearchResultDone(
  messageId: number,
  resultCode: number,
  diagnostic = "",
): Buffer {
  return ldapMessage(
    messageId,
    berElement(
      APP.SEARCH_RESULT_DONE,
      Buffer.concat([
        berInteger(resultCode, TAG.ENUMERATED),
        berString(""),
        berString(diagnostic),
      ]),
    ),
  );
}

function inScope(entryDn: string, baseObject: string, scope: number): boolean {
  if (scope === SCOPE.BASE) return dnEquals(entryDn, baseObject);
  if (scope === SCOPE.ONE_LEVEL) {
    if (dnEquals(entryDn, baseObject)) return false;
    const suffix = `,${baseObject.trim().toLowerCase()}`;
    const lower = entryDn.trim().toLowerCase();
    if (!lower.endsWith(suffix)) return false;
    // Exactly one RDN deeper.
    return !lower.slice(0, lower.length - suffix.length).includes(",");
  }
  return isWithinSubtree(entryDn, baseObject);
}

/** Restrict an entry to the attributes the client asked for. */
function selectAttributes(
  attributes: Record<string, string[]>,
  requested: string[],
): Record<string, string[]> {
  // No list, or "*", means all PUBLISHED attributes — never more.
  if (requested.length === 0 || requested.includes("*")) return attributes;
  if (requested.includes("1.1")) return {}; // RFC 4511: no attributes
  const wanted = new Set(requested.map((name) => name.trim().toLowerCase()));
  const selected: Record<string, string[]> = {};
  for (const [name, values] of Object.entries(attributes)) {
    if (wanted.has(name.toLowerCase())) selected[name] = values;
  }
  return selected;
}

export type SearchOutcome =
  | { searched: true; entries: Array<{ dn: string; attributes: Record<string, string[]> }>; resultCode: number }
  | { searched: false; resultCode: number; diagnostic: string };

/**
 * Execute a search against the projection.
 *
 * Authorization is not optional and not an afterthought: an unauthenticated
 * connection cannot enumerate the tree. A directory that answers every search
 * identically is an information-disclosure surface, so this refuses before it
 * filters rather than returning a filtered-but-revealing subset.
 */
export function executeSearch(
  request: SearchRequest,
  projection: DirectoryProjection,
  session: { boundDn: string | null },
): SearchOutcome {
  if (!session.boundDn) {
    return {
      searched: false,
      resultCode: RESULT.INSUFFICIENT_ACCESS,
      diagnostic: "bind before searching; anonymous enumeration is not permitted",
    };
  }
  if (!isWithinSubtree(request.baseObject, projection.baseDn)) {
    return {
      searched: false,
      resultCode: RESULT.NO_SUCH_OBJECT,
      diagnostic: `base object is outside ${projection.baseDn}`,
    };
  }

  const limit =
    request.sizeLimit > 0 ? Math.min(request.sizeLimit, MAX_SEARCH_RESULTS) : MAX_SEARCH_RESULTS;

  const entries: Array<{ dn: string; attributes: Record<string, string[]> }> = [];
  let truncated = false;
  for (const entry of projection.entries as DirectoryEntry[]) {
    if (!inScope(entry.dn, request.baseObject, request.scope)) continue;
    if (!matchesFilter(request.filter, entry.attributes)) continue;
    if (entries.length >= limit) {
      truncated = true;
      break;
    }
    entries.push({ dn: entry.dn, attributes: selectAttributes(entry.attributes, request.attributes) });
  }

  return {
    searched: true,
    entries,
    resultCode: truncated ? RESULT.SIZE_LIMIT_EXCEEDED : RESULT.SUCCESS,
  };
}
