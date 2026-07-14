import { describe, it, expect } from "vitest";

import { buildMentionRoster, mentionNotifyRecipients } from "./mention-notify";
import { resolveMentions } from "./mentions";

describe("buildMentionRoster", () => {
  it("keys users by their email local-part, lowercased", () => {
    const roster = buildMentionRoster([{ id: "u1", email: "Ada.Lovelace@example.com" }], []);
    expect(roster["ada.lovelace"]).toEqual({ type: "user", id: "u1" });
  });

  it("keys agents by agentId, slugId, and a normalized display name", () => {
    const roster = buildMentionRoster(
      [],
      [{ id: "a1", agentId: "AgentOne", slugId: "sales-bot", name: "Ada Lovelace (AI)" }],
    );
    expect(roster["agentone"]).toEqual({ type: "agent", id: "a1" });
    expect(roster["sales-bot"]).toEqual({ type: "agent", id: "a1" });
    expect(roster["ada-lovelace-ai"]).toEqual({ type: "agent", id: "a1" });
  });

  it("omits the slugId key when the agent has none", () => {
    const roster = buildMentionRoster(
      [],
      [{ id: "a1", agentId: "solo", slugId: null, name: "Solo Agent" }],
    );
    expect(roster["solo"]).toEqual({ type: "agent", id: "a1" });
    expect(roster["solo-agent"]).toEqual({ type: "agent", id: "a1" });
  });

  it("skips empty / whitespace handles", () => {
    const roster = buildMentionRoster(
      [{ id: "u1", email: "@nolocalpart.com" }],
      [{ id: "a1", agentId: "  ", slugId: "", name: "***" }],
    );
    expect(roster).toEqual({});
  });

  it("does not let a later key overwrite an earlier non-empty one", () => {
    const roster = buildMentionRoster(
      [{ id: "u1", email: "ada@example.com" }],
      // agentId collides with the user's "ada" handle — user (added first) wins.
      [{ id: "a1", agentId: "ada", slugId: null, name: "Ada" }],
    );
    expect(roster["ada"]).toEqual({ type: "user", id: "u1" });
  });
});

describe("mentionNotifyRecipients", () => {
  it("keeps only user targets, deduped, in first-seen order", () => {
    const recipients = mentionNotifyRecipients([
      { handle: "ada", type: "user", id: "u1" },
      { handle: "bot", type: "agent", id: "a1" },
      { handle: "grace", type: "user", id: "u2" },
      { handle: "ada2", type: "user", id: "u1" },
    ]);
    expect(recipients).toEqual(["u1", "u2"]);
  });

  it("excludes the commenter", () => {
    const recipients = mentionNotifyRecipients(
      [
        { handle: "ada", type: "user", id: "u1" },
        { handle: "grace", type: "user", id: "u2" },
      ],
      { excludeUserId: "u1" },
    );
    expect(recipients).toEqual(["u2"]);
  });

  it("drops agent targets entirely", () => {
    const recipients = mentionNotifyRecipients([{ handle: "bot", type: "agent", id: "a1" }]);
    expect(recipients).toEqual([]);
  });
});

describe("body → roster → recipients (end to end)", () => {
  it("notifies mentioned teammates, excluding the author, ignoring agents and typos", () => {
    const roster = buildMentionRoster(
      [
        { id: "u1", email: "ada@example.com" },
        { id: "u2", email: "grace@example.com" },
      ],
      [{ id: "a1", agentId: "sales-bot", slugId: null, name: "Sales Bot" }],
    );
    const body = "Thanks @grace and @sales-bot — cc @ada. @nobody please ignore.";
    const targets = resolveMentions(body, roster);
    const recipients = mentionNotifyRecipients(targets, { excludeUserId: "u1" });
    expect(recipients).toEqual(["u2"]);
  });
});
