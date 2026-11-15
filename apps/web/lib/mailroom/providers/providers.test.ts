// Provider adapters — design 2026-09-09 §4.4 (BI-13919D7E, AC-MAIL-PROVIDERS).

import { describe, expect, it, vi } from "vitest";

import { MAILBOX_PROVIDERS } from "@dpf/db/mailroom-enums";

import { createImapAdapter, normalizeParsedMail, type ImapClientPort, type ParsedMailPort } from "./imap";
import { createMicrosoft365Adapter, normalizeGraphMessage, type Microsoft365AdapterDeps } from "./microsoft365";
import { createMailboxProviderAdapters } from "./registry";
import { MAILROOM_FIRST_READ_LOOKBACK_DAYS, safeProviderError } from "./types";

function parsed(overrides: Partial<ParsedMailPort> = {}): ParsedMailPort {
  return {
    messageId: "<m1@example.test>",
    from: { value: [{ address: "Vet@Clinic.Example", name: "Dr Vet" }] },
    to: { value: [{ address: "vet@rescue.example" }] },
    subject: "Bloodwork for A-1234",
    text: "Results attached.",
    html: false,
    date: new Date("2026-09-09T09:00:00Z"),
    headers: new Map<string, unknown>([["auto-submitted", "no"]]),
    attachments: [{ filename: "results.pdf", contentType: "application/pdf", size: 1200 }],
    ...overrides,
  };
}

class FakeImap implements ImapClientPort {
  connected = false;
  released = 0;
  sinceQueries: Date[] = [];
  constructor(
    public uidValidity: number,
    public uids: number[],
    public sources: Record<number, Buffer> = {},
    /** Arrival date per UID; a UID with no entry counts as recent. */
    public arrived: Record<number, Date> = {},
  ) {}
  get mailbox() {
    const last = this.uids.length ? this.uids[this.uids.length - 1] : 0;
    return { uidValidity: this.uidValidity, exists: this.uids.length, uidNext: last + 1 };
  }
  async connect() {
    this.connected = true;
  }
  async logout() {
    this.connected = false;
  }
  async getMailboxLock() {
    return { release: () => void (this.released += 1) };
  }
  async search(query: { uid?: string; since?: Date }) {
    const since = query.since;
    if (since) this.sinceQueries.push(since);
    const recentEnough = (u: number) => !since || (this.arrived[u] ?? new Date()) >= since;
    if (!query.uid) return this.uids.filter(recentEnough);
    if (query.uid === "*") return this.uids.length ? [this.uids[this.uids.length - 1]] : [];
    if (since) {
      const from = Number(query.uid.split(":")[0]);
      return this.uids.filter((u) => u >= from && recentEnough(u));
    }
    const [start] = query.uid.split(":");
    const from = Number(start);
    const matched = this.uids.filter((u) => u >= from);
    // Real servers return the last message for `n:*` when n > UIDNEXT-1.
    return matched.length ? matched : this.uids.length ? [this.uids[this.uids.length - 1]] : [];
  }
  async fetchOne(seq: string) {
    const uid = Number(seq);
    return { uid, source: this.sources[uid] ?? Buffer.from(`uid-${uid}`), internalDate: new Date("2026-09-09T08:00:00Z") };
  }
}

describe("IMAP adapter", () => {
  it("first fetch with no cursor reads the recent messages and sets the cursor", async () => {
    const client = new FakeImap(7, [3, 4, 5]);
    const adapter = createImapAdapter({ createClient: () => client, parse: async (src) => parsed({ subject: src.toString() }) });
    const result = await adapter.fetchNew({ host: "h", port: 993, secure: true, user: "u" }, { password: "p" }, null);
    expect(result.messages.map((m) => m.providerMessageId)).toEqual(["3", "4", "5"]);
    expect(result.cursor).toMatchObject({ uidValidity: "7", lastUid: 5 });
    expect(client.released).toBe(1);
    expect(client.connected).toBe(false);
  });

  // BI-D1D4FE9B: an established inbox (years of mail) must not be read oldest-first.
  // The first read is bounded to the shared lookback window, as Microsoft 365 is.
  it("first fetch on an established inbox skips old mail and reads only the lookback window", async () => {
    const now = Date.now();
    const old = new Date(now - 400 * 86_400_000);
    const recent = new Date(now - 3 * 86_400_000);
    const uids = Array.from({ length: 120 }, (_, i) => i + 1);
    const arrived: Record<number, Date> = {};
    for (const uid of uids) arrived[uid] = uid > 117 ? recent : old;
    const client = new FakeImap(7, uids, {}, arrived);
    const adapter = createImapAdapter({ createClient: () => client, parse: async () => parsed() });
    const result = await adapter.fetchNew({ host: "h", port: 993, secure: true, user: "u" }, { password: "p" }, null);
    expect(result.messages.map((m) => m.providerMessageId)).toEqual(["118", "119", "120"]);
    expect(result.cursor).toMatchObject({ uidValidity: "7", lastUid: 120 });
    expect(result.cursor?.since).toBe(client.sinceQueries[0]?.toISOString());
    const since = client.sinceQueries[0];
    expect(since).toBeDefined();
    expect(Math.round((now - since!.getTime()) / 86_400_000)).toBe(MAILROOM_FIRST_READ_LOOKBACK_DAYS);
  });

  // Review finding 1 (TR-GATE-FAAD270E): a server that omits UIDNEXT must not seed the cursor at 0.
  it("first fetch with nothing recent and no UIDNEXT looks up the newest UID instead of seeding at 0", async () => {
    const old = new Date(Date.now() - 400 * 86_400_000);
    const client = new FakeImap(7, [10, 11, 12], {}, { 10: old, 11: old, 12: old });
    Object.defineProperty(client, "mailbox", { get: () => ({ uidValidity: 7, exists: 3 }) });
    const adapter = createImapAdapter({ createClient: () => client, parse: async () => parsed() });
    const result = await adapter.fetchNew({ host: "h", port: 993, secure: true, user: "u" }, { password: "p" }, null);
    expect(result.messages).toEqual([]);
    expect(result.cursor).toMatchObject({ uidValidity: "7", lastUid: 12 });
  });

  // Review finding 2 (TR-GATE-FAAD270E): UIDs are not ordered by date, so a truncated first
  // read must not let a later poll reach old mail between the processed UIDs.
  it("after a truncated first read, later polls keep the window floor and never route old mail", async () => {
    const now = Date.now();
    const old = new Date(now - 400 * 86_400_000);
    const recent = new Date(now - 2 * 86_400_000);
    // 3 and 4 are recent-dated with low UIDs (copied in); 5 and 6 are old; 7..9 are recent.
    const arrived: Record<number, Date> = { 1: old, 2: old, 3: recent, 4: recent, 5: old, 6: old, 7: recent, 8: recent, 9: recent };
    const client = new FakeImap(7, [1, 2, 3, 4, 5, 6, 7, 8, 9], {}, arrived);
    const adapter = createImapAdapter({ createClient: () => client, parse: async () => parsed() });
    const first = await adapter.fetchNew({ host: "h", port: 993, secure: true, user: "u" }, { password: "p" }, null, { limit: 2 });
    expect(first.messages.map((m) => m.providerMessageId)).toEqual(["3", "4"]);
    const second = await adapter.fetchNew({ host: "h", port: 993, secure: true, user: "u" }, { password: "p" }, first.cursor);
    expect(second.messages.map((m) => m.providerMessageId)).toEqual(["7", "8", "9"]);
  });

  it("first fetch with nothing recent starts the cursor at the newest message, so old mail is never read", async () => {
    const old = new Date(Date.now() - 400 * 86_400_000);
    const client = new FakeImap(7, [1, 2, 3], {}, { 1: old, 2: old, 3: old });
    const adapter = createImapAdapter({ createClient: () => client, parse: async () => parsed() });
    const result = await adapter.fetchNew({ host: "h", port: 993, secure: true, user: "u" }, { password: "p" }, null);
    expect(result.messages).toEqual([]);
    expect(result.cursor).toMatchObject({ uidValidity: "7", lastUid: 3 });
  });

  it("second fetch returns nothing new and keeps the cursor", async () => {
    const client = new FakeImap(7, [3, 4, 5]);
    const adapter = createImapAdapter({ createClient: () => client, parse: async () => parsed() });
    const result = await adapter.fetchNew({ host: "h", port: 993, secure: true, user: "u" }, { password: "p" }, { uidValidity: "7", lastUid: 5 });
    expect(result.messages).toEqual([]);
    expect(result.cursor).toEqual({ uidValidity: "7", lastUid: 5 });
  });

  it("a changed UIDVALIDITY resets the cursor and re-reads without throwing", async () => {
    const client = new FakeImap(9, [1, 2]);
    const adapter = createImapAdapter({ createClient: () => client, parse: async () => parsed() });
    const result = await adapter.fetchNew({ host: "h", port: 993, secure: true, user: "u" }, { password: "p" }, { uidValidity: "7", lastUid: 5 });
    expect(result.messages.map((m) => m.providerMessageId)).toEqual(["1", "2"]);
    expect(result.cursor).toMatchObject({ uidValidity: "9", lastUid: 2 });
  });

  it("probe reports a safe error on bad credentials", async () => {
    const adapter = createImapAdapter({
      createClient: () => ({
        ...new FakeImap(1, []),
        connect: async () => {
          throw new Error("Invalid credentials (password: hunter2)");
        },
      }) as unknown as ImapClientPort,
    });
    const result = await adapter.probe({ host: "h", port: 993, secure: true, user: "u" }, { password: "hunter2" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toContain("hunter2");
      expect(result.error).toContain("[redacted]");
    }
  });

  it("normalises threading headers, addresses, and attachment metadata", () => {
    const mail = normalizeParsedMail(parsed({ inReplyTo: "<m0@example.test>", references: "<m0@example.test> <mx@example.test>" }), 42, undefined);
    expect(mail.providerMessageId).toBe("42");
    expect(mail.messageIdHeader).toBe("<m1@example.test>");
    expect(mail.inReplyTo).toBe("<m0@example.test>");
    expect(mail.references).toEqual(["<m0@example.test>", "<mx@example.test>"]);
    expect(mail.from).toEqual({ address: "vet@clinic.example", name: "Dr Vet" });
    expect(mail.to).toEqual([{ address: "vet@rescue.example", name: null }]);
    expect(mail.headers["auto-submitted"]).toBe("no");
    expect(mail.attachments).toEqual([{ filename: "results.pdf", contentType: "application/pdf", size: 1200 }]);
    expect(mail.receivedAt.toISOString()).toBe("2026-09-09T09:00:00.000Z");
  });
});

describe("Microsoft 365 adapter", () => {
  const settings = { tenantId: "t", clientId: "c", mailboxUserPrincipalName: "adopt@rescue.example" };
  const exchange = vi.fn(async () => ({ accessToken: "tok", tokenType: "Bearer", expiresAt: new Date() }));

  it("honours the deltaLink cursor and returns the new one", async () => {
    const calls: string[] = [];
    const graphGet = vi.fn(async <T,>(url: string, _token: string): Promise<T> => {
      calls.push(url);
      return {
        value: [
          { id: "g1", internetMessageId: "<g1@x>", subject: "Hi", receivedDateTime: "2026-09-09T10:00:00Z", from: { emailAddress: { address: "A@B.example", name: "A" } }, body: { contentType: "text", content: "hello" } },
          { id: "gone", "@removed": { reason: "deleted" } },
        ],
        "@odata.deltaLink": "https://graph/delta?token=next",
      } as unknown as T;
    });
    const adapter = createMicrosoft365Adapter({ graphGet: graphGet as Microsoft365AdapterDeps["graphGet"], exchange });
    const result = await adapter.fetchNew(settings, { clientSecret: "s" }, { deltaLink: "https://graph/delta?token=prev" });
    expect(calls).toEqual(["https://graph/delta?token=prev"]);
    expect(result.messages.map((m) => m.providerMessageId)).toEqual(["g1"]);
    expect(result.cursor).toEqual({ deltaLink: "https://graph/delta?token=next" });
  });

  it("first fetch without a cursor bounds the read to recent mail", async () => {
    const graphGet = vi.fn(async <T,>(url: string, _token: string): Promise<T> => {
      expect(url).toContain("/mailFolders/Inbox/messages/delta");
      expect(url).toContain("receivedDateTime ge ");
      return { value: [], "@odata.deltaLink": "https://graph/delta?token=first" } as unknown as T;
    });
    const adapter = createMicrosoft365Adapter({ graphGet: graphGet as Microsoft365AdapterDeps["graphGet"], exchange });
    const result = await adapter.fetchNew(settings, { clientSecret: "s" }, null);
    expect(result.cursor).toEqual({ deltaLink: "https://graph/delta?token=first" });
  });

  it("normalises internetMessageId and threading headers; html bodies keep the preview as text", () => {
    const mail = normalizeGraphMessage({
      id: "g2",
      internetMessageId: "<g2@x>",
      subject: "Re: Scout",
      receivedDateTime: "2026-09-09T10:00:00Z",
      from: { emailAddress: { address: "adopter@example.test", name: null } },
      toRecipients: [{ emailAddress: { address: "adopt@rescue.example" } }],
      body: { contentType: "html", content: "<p>hi</p>" },
      bodyPreview: "hi",
      hasAttachments: true,
      internetMessageHeaders: [
        { name: "In-Reply-To", value: "<g1@x>" },
        { name: "References", value: "<g0@x> <g1@x>" },
        { name: "Auto-Submitted", value: "no" },
      ],
    });
    expect(mail.messageIdHeader).toBe("<g2@x>");
    expect(mail.inReplyTo).toBe("<g1@x>");
    expect(mail.references).toEqual(["<g0@x>", "<g1@x>"]);
    expect(mail.textBody).toBe("hi");
    expect(mail.htmlBody).toBe("<p>hi</p>");
    expect(mail.attachments).toHaveLength(1);
    expect(mail.headers["auto-submitted"]).toBe("no");
  });

  it("probe reports a safe error when the token exchange fails", async () => {
    const adapter = createMicrosoft365Adapter({
      graphGet: async () => ({}) as never,
      exchange: async () => {
        throw new Error("invalid Microsoft 365 credentials");
      },
    });
    const result = await adapter.probe(settings, { clientSecret: "s" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("invalid Microsoft 365 credentials");
  });
});

describe("provider registry", () => {
  it("carries an adapter for every declared provider", () => {
    const adapters = createMailboxProviderAdapters();
    for (const provider of MAILBOX_PROVIDERS) {
      expect(adapters[provider].provider).toBe(provider);
    }
    expect(adapters["postmark-inbound"].pollable).toBe(false);
    expect(adapters.imap.pollable).toBe(true);
  });

  it("safeProviderError redacts secret-shaped fragments", () => {
    expect(safeProviderError(new Error("login failed token=abc123"))).toBe("login failed token: [redacted]");
  });
});
