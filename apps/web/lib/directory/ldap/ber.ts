// Minimal BER reader/writer for LDAP (EP-24741BBF · BI-F7317D65).
//
// Written rather than adopted because there is no maintained Node/TypeScript
// LDAP SERVER library: `ldapjs` is MIT but archived 2024-05-14 and formally
// decommissioned, and `ldapts` is a client. That absence is a load-bearing
// input to the epic's absorb-vs-adopt decision, recorded in the authentik
// evaluation — every adoptable server is a separate process in another
// language, which is the appendage the epic forbids.
//
// Scope is deliberately the subset RFC 4511 bind and search need. This is NOT a
// general ASN.1 library, and it should not grow into one: every byte it parses
// comes off an untrusted socket, so the smaller its surface the better.

/** BER tags used by LDAP. Application tags are context-specific + constructed. */
export const TAG = {
  BOOLEAN: 0x01,
  INTEGER: 0x02,
  OCTET_STRING: 0x04,
  NULL: 0x05,
  ENUMERATED: 0x0a,
  SEQUENCE: 0x30,
  SET: 0x31,
} as const;

export const APP = {
  BIND_REQUEST: 0x60,
  BIND_RESPONSE: 0x61,
  UNBIND_REQUEST: 0x42,
  SEARCH_REQUEST: 0x63,
  SEARCH_RESULT_ENTRY: 0x64,
  SEARCH_RESULT_DONE: 0x65,
  EXTENDED_REQUEST: 0x77,
  EXTENDED_RESPONSE: 0x78,
} as const;

/** Hard ceiling on any single element, so a malformed length cannot allocate. */
const MAX_ELEMENT_BYTES = 1_048_576;

export class BerReader {
  private offset = 0;

  constructor(private readonly buf: Buffer) {}

  get position(): number {
    return this.offset;
  }

  get remaining(): number {
    return this.buf.length - this.offset;
  }

  /** Peek the next tag without consuming it. */
  peekTag(): number | null {
    return this.remaining > 0 ? this.buf[this.offset]! : null;
  }

  /** Read a tag/length header, returning the value slice and advancing past it. */
  readElement(expectedTag?: number): { tag: number; value: Buffer } {
    if (this.remaining < 2) {
      throw new Error("BER: truncated element header");
    }
    const tag = this.buf[this.offset]!;
    if (expectedTag !== undefined && tag !== expectedTag) {
      throw new Error(
        `BER: expected tag 0x${expectedTag.toString(16)} but found 0x${tag.toString(16)}`,
      );
    }
    this.offset += 1;

    let length = this.buf[this.offset]!;
    this.offset += 1;
    if (length & 0x80) {
      const byteCount = length & 0x7f;
      if (byteCount === 0 || byteCount > 4) {
        // Indefinite length is not legal in LDAP's DER-ish encoding, and >4
        // bytes exceeds anything this server will ever accept.
        throw new Error("BER: unsupported length encoding");
      }
      if (this.remaining < byteCount) throw new Error("BER: truncated length");
      length = 0;
      for (let i = 0; i < byteCount; i += 1) {
        length = (length << 8) | this.buf[this.offset]!;
        this.offset += 1;
      }
    }
    if (length > MAX_ELEMENT_BYTES) {
      throw new Error(`BER: element of ${length} bytes exceeds the ${MAX_ELEMENT_BYTES} limit`);
    }
    if (this.remaining < length) throw new Error("BER: truncated element body");

    const value = this.buf.subarray(this.offset, this.offset + length);
    this.offset += length;
    return { tag, value };
  }

  readInteger(expectedTag: number = TAG.INTEGER): number {
    const { value } = this.readElement(expectedTag);
    if (value.length === 0 || value.length > 4) {
      throw new Error("BER: integer out of supported range");
    }
    let result = value[0]! & 0x80 ? -1 : 0;
    for (const byte of value) result = (result << 8) | byte;
    return result;
  }

  readString(expectedTag: number = TAG.OCTET_STRING): string {
    return this.readElement(expectedTag).value.toString("utf8");
  }

  readBoolean(): boolean {
    return this.readElement(TAG.BOOLEAN).value[0] !== 0;
  }

  /** A reader scoped to one constructed element's contents. */
  readConstructed(expectedTag?: number): BerReader {
    return new BerReader(this.readElement(expectedTag).value);
  }
}

/** Encode a tag/length/value triple. */
export function berElement(tag: number, value: Buffer): Buffer {
  const header =
    value.length < 0x80
      ? Buffer.from([tag, value.length])
      : (() => {
          const lengthBytes: number[] = [];
          let remaining = value.length;
          while (remaining > 0) {
            lengthBytes.unshift(remaining & 0xff);
            remaining >>= 8;
          }
          return Buffer.from([tag, 0x80 | lengthBytes.length, ...lengthBytes]);
        })();
  return Buffer.concat([header, value]);
}

export function berInteger(value: number, tag: number = TAG.INTEGER): Buffer {
  const bytes: number[] = [];
  let remaining = value;
  do {
    bytes.unshift(remaining & 0xff);
    remaining >>= 8;
  } while (remaining !== 0 && remaining !== -1);
  // Prepend a zero byte when the high bit would otherwise read as negative.
  if (value >= 0 && bytes[0]! & 0x80) bytes.unshift(0);
  return berElement(tag, Buffer.from(bytes));
}

export function berString(value: string, tag: number = TAG.OCTET_STRING): Buffer {
  return berElement(tag, Buffer.from(value, "utf8"));
}

export function berSequence(...parts: Buffer[]): Buffer {
  return berElement(TAG.SEQUENCE, Buffer.concat(parts));
}

export function berSet(...parts: Buffer[]): Buffer {
  return berElement(TAG.SET, Buffer.concat(parts));
}

/**
 * Split a stream buffer into whole LDAP messages, returning the parsed message
 * slices and whatever trailing bytes are still incomplete. TCP does not respect
 * message boundaries, so a server that assumes one read equals one message will
 * corrupt under load.
 */
export function frameMessages(buffer: Buffer): { messages: Buffer[]; rest: Buffer } {
  const messages: Buffer[] = [];
  let cursor = 0;
  while (cursor < buffer.length) {
    const reader = new BerReader(buffer.subarray(cursor));
    let element: { tag: number; value: Buffer };
    try {
      element = reader.readElement(TAG.SEQUENCE);
    } catch {
      break; // incomplete or not yet a whole message
    }
    const consumed = reader.position;
    messages.push(buffer.subarray(cursor, cursor + consumed));
    cursor += consumed;
    void element;
  }
  return { messages, rest: buffer.subarray(cursor) };
}
