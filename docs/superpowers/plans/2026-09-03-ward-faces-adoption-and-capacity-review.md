---
status: active
---

# Ward board: a face, a promise, and the decision nobody wants to make

**Backlog:** BI-FB73D0B5 · **Epic:** EP-5102F494 · **Route:** `/workspace/ward`

## Outcome

The ward board says where an animal is and whether there is room. It says nothing about what the
work is *for*. A shelter owner, looking at the running portal, asked for three things it was
missing, and none of them were structural:

> "real pictures would be needed, icons don't cut it" · "indicate if there is someone scheduled to
> adopt. A happy human basically, and happy pet" · "the ai coworker should bear that burden of
> selecting, and suggesting which one based on various logical criteria"

All three land here, and none needs a new table.

## Verified substrate — measured against `main`, 2026-09-03

| Need | Already exists | Verdict |
| --- | --- | --- |
| Photograph | `AdoptableAnimal.primaryPhotoAssetId`, served at `/api/media/<id>` | reach, not absence |
| Someone coming | `AnimalAdoptionApplication` + `AnimalAdoptionApplicationStatus` | reach, not absence |
| Time in care | `AnimalCustodyEpisode.openedAt` / `closedAt` | reach, not absence |
| Protected from review | `AnimalCustodyEpisode.legalHoldActive`, `currentStage` | reach, not absence |
| Euthanasia as a recorded fact | `AnimalOutcomeType.euthanasia` | exists; **never written here** |

No migration. Three pure projections and one presentation change.

## Phase 1 — photographs *(delivered)*

Occupied units render the animal's own photograph. A paw glyph on every tile tells a worker nothing
apart; a face is how you recognise the dog in the run. A unit whose animal has no photograph on
file shows the name alone — inventing a placeholder animal would be worse than showing none.

Accessibility is met by the alt text carrying the animal's name, and the list view still carries
name and state for anyone the map does not serve.

## Phase 2 — someone is coming *(delivered)*

`AnimalAdoptionApplication` already existed and the board ignored it. A unit with a person attached
is not the same as a full unit, and a shelter under pressure has to see the difference at a glance.

Live applications resolve to two levels. **Scheduled** (`approved`, `home-check`, `meet-and-greet`)
reads as a promise to a named person. **Interested** (`submitted`, `screening`) reads as an enquiry
nobody has answered yet. The split matters because only the first is a promise; putting a happy
badge on a fresh enquiry would be a lie told in the shelter's own voice. `declined`, `withdrawn`,
`waitlisted` and `placed` are nobody coming.

Where an animal has both, the better news wins — that is the one a worker must not miss. At the
same level the longest-waiting applicant wins.

## Phase 3 — the capacity review *(delivered)*

When a shelter runs out of room it has to decide who it can no longer hold. **That decision stays
with a person and always will.** What sits on that person unfairly is the *justification* —
assembling the criteria, applying them evenly, and being able to say afterwards why this animal and
not another. That is the part carried here.

Properties the tests pin:

- **It appears only when free units reach zero.** The list exists because the building is full, not
  because a screen had room for one.
- **Hard exclusions run before any scoring**, so a protected animal cannot be out-scored onto the
  list by any combination of factors. A legal hold, an approved adopter, an unanswered applicant, an
  open assessment, or an outcome already recorded removes an animal entirely. Each exclusion is
  tested against the worst possible ranking profile — waited longer than anyone — so the guarantee is
  proven rather than asserted.
- **Every exclusion is named with its reason**, so a worker can check the machine's work.
- **A stay that was never recorded is treated as unassessed, not as a candidate.** A gap in the
  record is not a fact about the animal.
- **Ranking is longest-waiting-first**, the criterion a shelter can defend out loud, with every
  contributing factor printed in the words a person would use.
- **The panel has no control that acts.** `AnimalOutcomeType.euthanasia` exists and nothing here
  writes it; nothing here writes at all.
- **When everyone is protected it says so** and asks the shelter to find room another way, rather
  than offering somebody up to fill the list.

Surface chosen through kernel scoring against a dedicated triage route and a cockpit card. The
composite is deliberately **not** the cited reason: the feature vectors were author-supplied and
ungrounded (`requireEvidence` was not set), so the score largely restates the author's own prior,
and its margin is inflated by retrieval that admitted plainly unrelated commandments — CAN-SPAM,
GDPR and double-entry bookkeeping were among the 49 principles applied to a question about where a
panel renders (BI-8B04594C). The organization's own mission contributed exactly zero, retrieved in
semantic mode with no dimension vector (BI-E98B8650).

What survives that scepticism is one differential, interpretable signal — the same one that decided
the map: **"Do the work; don't task the operator with what an agent can do"** scores *positive* for
inline (+0.148) and *negative* for both alternatives (−0.098 for a separate route, −0.146 for a
cockpit card). Sending a worker elsewhere to read a shortlist the agent already assembled, or
waiting for them to notice a card, is tasking the operator with the assembly. "Show the consequence
before the confirm" agrees, and no commandment opposed the choice.

The recorded interaction `DI-4E55C1354F74` resolves to a **deferral**, not a pick — the ux-design
corpus holds no material for this class, and `principle_decide` could not record its own outcome on
this install (profile-not-provisioned, BI-8BB292BE). Stated rather than dressed up, because a cited
id has to mean what it says. Manifest:
`docs/ux-fit/2026-09-03-ward-capacity-review-and-faces.ux-fit.json`.

## Backlog coverage

Covers BI-FB73D0B5 (the ward board's remaining owner-requested content) under EP-5102F494. No new
backlog item filed: this closes requests already carried by that item rather than opening scope.

Receipt: **blocked** — `record_plan_backlog_coverage` has a schema/handler mismatch on this install
(BI-CC9D5997), so the coverage is recorded here in the plan rather than through the tool.

## Not claimed

Writes remain the existing `manageHousingAction`; nothing here adds a write path. The review does
not notify anyone, does not persist a shortlist, and does not learn from what a human chose — each
of those is a decision about accountability that a shelter, not a plan, should make.
