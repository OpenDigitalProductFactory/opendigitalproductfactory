// The head a Workroom's own commits produced (BI-A7797C2C).
//
// claim_backlog_item_for_work records headSha = baseSha, because nothing has
// been committed yet. Until the author re-adopts with a newer head, that value
// is the trunk commit the branch started from, not anything the room authored.
// Read as an authored head it misleads every consumer that keys on it:
//   - PR binding requires the PR head to equal the room head, so the room never
//     binds to the PR its branch produced (WC-54CCD56B stayed unbound for 19
//     days with PR #5979 merged);
//   - local git reachability finds the base on trunk and reports the room as
//     merged, so the reaper archived rooms as DELIVERED while their backlog
//     items were still open (17 such archives in 30 days on the operator
//     install, 3 for unfinished items).
// A head equal to the base therefore means "no authored head yet", exactly
// like a null head, and consumers take their existing headless path.

export function authoredHeadSha(room: { headSha?: string | null; baseSha?: string | null }): string | null {
  const head = room.headSha?.trim();
  if (!head) return null;
  const base = room.baseSha?.trim();
  return base && base.toLowerCase() === head.toLowerCase() ? null : head;
}
