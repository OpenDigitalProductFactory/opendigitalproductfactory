# Federation outbox — reading a backlog correctly

How to tell an install that is **waiting** from one that is **broken**, when its
federation outbox has work in it.

Written 2026-09-15 after an install was found holding 2,011 queued deliveries and
1,323 failed ones. The operator was travelling, away from the peer on their home
LAN, and reasonably read the backlog as expected. The backlog *was* expected. The
three faults underneath it were not, and none of them was visible in the queue's
own health line.

## The two shapes of failure, and why they must not share a budget

`postToPeer` returns `status: 0` when the peer was never reached — the transport
threw, or the SSRF guard refused to dial the URL. Any other status is a real HTTP
reply from the peer.

That distinction decides everything downstream:

| Shape | Meaning | Correct handling |
|---|---|---|
| `status: 0` | We could not reach them. Says nothing about the payload. | Defer indefinitely. Never dead-letter. |
| `401` / `403` | They answered: your credentials are refused. Settled. | Quarantine the link. Stop dialing. |
| other `4xx` / `5xx` | They answered and something is wrong with this item or their side. | Retry to `MAX_ATTEMPTS`, then dead-letter. |

Before this was split, all three shared one budget: `MAX_ATTEMPTS` 8 against a
30s→30m backoff, which exhausts in **about an hour**. An install out of contact
with its peer for longer than that wrote off every queued item. Being away for a
weekend was recorded as permanent delivery failure.

## Reading the queue health line

`assessQueueHealth` reports three things that look similar and mean different
things:

- **`N items waiting`** — depth alone. Expected whenever a peer is unreachable.
- **`no completions with backlog`** — `throughput === 0`. Fires whether the
  consumer is running-and-failing or not running at all. On its own it tells you
  nothing about which.
- **`no attempt in Nh/Nd — consumer may have stopped`** — nothing has *tried* in
  over an hour. This is the one that means something is wrong with the platform
  rather than with the network.

The third exists because the second could not distinguish them. On the install
above, the last delivery **attempt** was twelve days before it was found, while
the queue reported only "no completions with backlog" — the same phrase a
perfectly healthy consumer produces while a peer is offline.

**Expected, while away from the peer:** depth climbing, `no completions with
backlog`, and a *recent* last attempt. The consumer is trying every cycle and
being told the peer is unreachable.

**Not expected:** depth climbing with no attempt for hours. Something stopped.

## Link quarantine

`FederationLink.quarantinedAt` takes a link out of the drain's selector. It is set
when an item that has already been retried is still refused on auth, so a token
caught mid-rotation gets one retry before the link is fenced.

A quarantined link stays quarantined until an operator clears it — that is
deliberate. The peer has refused these credentials; re-dialing on a timer would
bury the one signal that matters under thousands of identical rejections, which
is exactly what produced 1,083 of them on the install above.

## When you get back on the peer's network

A held outbox drains on its own once the peer is reachable: the items are intact,
`nextAttemptAt` has widened but still fires, and delivery resumes.

Two things are **not** yet automatic and want checking after a real flush:

- Items enqueued against links that were later **revoked** will never deliver.
  The producer does not currently check link state before enqueueing.
- The historical dead-lettered items from before the retry split are not
  recovered. They are visible as `syncStatus: "dead-letter"` and need a
  deliberate decision, not a silent replay.
