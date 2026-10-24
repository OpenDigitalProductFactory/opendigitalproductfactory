---
status: active
---

# Thread sensitivity visibility — telling an owner their conversation is pinned

- **Backlog item:** BI-706530B2
- **Sibling:** BI-88247CE2 (the narrow trigger, already landed)
- **Status:** design + implementation, this branch
- **Reproduced on:** `2cc284539`

## The defect, precisely

A coworker thread that once contained a governed-looking phrase routes to a
local model on **every subsequent turn**, forever. History is resent each turn
and the screen is recomputed over the whole payload, so an early match keeps
applying to questions that have nothing to do with it.

Reproduced in `apps/web/lib/inference/thread-sensitivity-pinning.test.ts`:
the same question measures `confidential`/`allow` in a fresh thread and
`restricted`/`local-only` when preceded by one unrelated earlier message.

Two properties make it worse than the routing itself:

- **Invisible.** Nothing tells the owner the thread is pinned, which message
  pinned it, or that the pin came from history rather than from what they just
  asked. The observable is a coworker that quietly got slower and less capable.
- **Apparently unclearable.** There is no offered action, and nothing suggests
  that a new conversation would restore normal routing.

## What this design does NOT change

**The routing.** History genuinely is sent to the provider. If an early message
holds a real salary figure, then turn 40 really does carry it off the box and
restricting is correct. Every clamp, floor and policy decision is untouched;
`measuredSensitivity` and `routeEffect` are read, never written.

This is deliberate scope. The BI's third candidate shape — ageing or window-
scoping the evidence so old history stops counting — genuinely changes the
egress property of the platform and is a kernel decision, not a code change to
make on the way past. It stays open.

## Research & benchmarking

- **Anthropic Claude Code / OpenAI Codex context notices.** Both surface
  context state to the operator as an inline, dismissible strip rather than a
  modal, and neither blocks input on it. Adopted: same shape, same placement
  directly under the panel header.
- **Chrome / Firefox permission and security chips.** Both pair a plain-language
  cause with exactly one remedy, and omit the remedy when none applies rather
  than offering a dead control. Adopted — this is the load-bearing rule below.
- **GDPR/CCPA "meaningful information about the logic involved".** Argues for
  naming the *category* of data that caused a decision, not the matched value.
  Adopted: the notice carries data classes and message indices, never content,
  so the receipt's `rawPayloadStored: false` guarantee survives the trip to the
  browser. Rejected: showing the matched phrase, which would be more useful and
  would put payload text into a surface that must not hold it.

## The one real judgement: when to offer the action

Offering "start a fresh conversation" when the trigger is in the message the
owner *just sent* costs them their entire thread and changes nothing — the new
thread re-triggers on its first message. So the offer is made on one condition:
every escalating match sits below the current turn.

That requires separating history from the current turn, which needs an anchor
the receipt did not carry. Hence `currentTurnStartIndex`.

## Deliverables, in order

1. **`currentTurnStartIndex` on the screen receipt** — the payload index of the
   last user-role message, computed in `screenInferencePayload`. An index, never
   content. Additive and optional; older receipts simply lack it.
2. **`deriveThreadSensitivityNotice`** (`lib/inference/thread-sensitivity-notice.ts`)
   — pure. Classifies the pin as `history` / `current-turn` / `mixed` /
   `outside-conversation` and attaches the action only for `history`.
   Instruction-origin matches are excluded: they set no floor and are not the
   owner's doing.
3. **`readThreadSensitivityReceipt`** (`lib/inference/thread-sensitivity-receipt.ts`)
   — the version boundary. Persisted receipts are opaque JSON written by older
   screeners; anything lacking the anchor or provenance returns null and the
   panel stays silent, which is what it does today.
4. **`getThreadSensitivityNotice`** (`lib/actions/thread-sensitivity.ts`) —
   server action, thread ownership enforced as in the thread snapshot.
5. **Index migration** `20260906070000_index_route_decision_by_agent_message` —
   the lookup is by `agentMessageId`, which had no index.
6. **`ThreadSensitivityNotice`** component, mounted under the panel header,
   wired to the existing clear-conversation confirm flow.

`isClearDisabled` moved from the panel to `composer-state.ts` to stay inside the
panel's module-size ratchet rather than loosening it.

## Acceptance, against the BI

| BI acceptance | Status |
|---|---|
| A thread pinned by an early false positive returns to normal routing without the owner abandoning it | **Partial by design.** The owner is told the pin is historical and offered a supported fresh start. Automatic un-pinning is shape 3 and stays open. |
| A thread carrying a genuine governed value keeps routing restricted while it is still sent | **Held.** No routing logic changed. |
| The owner can see that a thread is restricted, and has an action | **Met.** |

## Docs impact

User-visible behaviour change (a new notice in the coworker panel) with no
change to routing, permissions or install. Recorded here; no runbook or install
doc is made stale by it.

---

## Addendum, 2026-09-07 — the structural half, ratified

The third shape is settled. Kernel `DI-B60AD9E7746F` (stakes: high, 49
principles):

| option | composite |
|---|---|
| keep-full-history-evidence | 11.938 |
| redact-the-span-from-the-payload | 11.839 |
| age-the-evidence-recency-window | **3.042** |

**Struck outright: the recency window.** Scoring sensitivity over only the last
N turns while still transmitting the older history lost by a factor of four,
penalised hardest on data privacy, least-privilege, "outbound and irreversible
actions require explicit go", and blast radius. It would knowingly dispatch
governed content to a cloud provider that the screen had decided to stop
looking at. That is not a fix, it is a hole, and it is removed from the item.

**The top two tied** (margin 0.099 < 0.2, confidence low, `autonomyEligible:
false`). Per the tool's own advisory the choice was ratified by the operator on
2026-09-07 rather than auto-executed: **redact the span from the payload**.

### The principle

Do not age the *evidence*. Age the *payload*. A thread pinned by old history
recovers by no longer **sending** that history — never by deciding to stop
looking at it. The screen keeps scoring the whole payload exactly as before;
the payload simply becomes smaller. What is screened stays what is dispatched.

### The load-bearing detail

A coworker thread reintroduces its own past through **three independent doors**,
and a boundary honoured by only some of them is worse than none — it would
report normal routing while the withheld text still travelled:

1. **the raw recency window** — bounded by `createdAt >= boundary`;
2. **the rolling checkpoint** — a persisted summary of turns older than the
   window, i.e. precisely the withheld span, rewritten. A summary of governed
   text is still governed text, so it is suppressed wholesale rather than
   regenerated (regenerating it would mean dispatching the withheld turns to do
   it);
3. **semantic recall** — vector lookup over the thread's own messages, which
   already excludes the live window and would therefore treat withheld turns as
   the rows it is *most* free to return.

`lib/tak/thread-history-withholding.ts` owns all three so a fourth door has one
obvious place to be wired, and `thread-history-withholding.test.ts` tests them
door by door.

### Deliverables

1. `AgentThread.historyWithheldBefore` (nullable) + migration
   `20260907030000_agent_thread_history_withholding`. Null everywhere until an
   owner asks.
2. `resolveWithheldHistory` — one call site, three door-specific answers.
3. `withholdEarlierThreadHistory` server action. Owner-scoped. It can only ever
   shrink the payload, so it needs no approval beyond owning the thread; there
   is deliberately no un-withhold, because reversing it *would* widen egress.
4. The notice's existing control changes meaning: "Continue without the earlier
   messages" instead of "Start a fresh conversation". The thread and its visible
   record survive; only dispatch narrows.

`getKnowledgePointersForRoute` moved to `lib/actions/route-knowledge-pointers.ts`
to stay inside `agent-coworker.ts`'s size ratchet rather than loosening it.

### Acceptance, restated

| BI acceptance | Status |
|---|---|
| A thread pinned by an early false positive returns to normal routing without the owner abandoning it | **Met.** The thread survives; the pin clears because the text is no longer sent. |
| A thread carrying a genuine governed value keeps routing restricted while that value is still sent | **Held.** Untouched — and still true after withholding, because withholding removes the value from the payload rather than from the scoring. |
| The owner can see that a thread is restricted, and has an action | **Met** (shipped in PR #5114). |
