---
name: create-presentation
description: "Produce and revise branded presentations."
# Agent Skills standard fields (Surface A: Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: mcp__dpf__get_marketing_summary mcp__dpf__get_campaign_plan mcp__dpf__create_presentation mcp__dpf__doc_load mcp__dpf__doc_version_list

# DPF fields (Surface B: in-portal seed loader)
category: customer
assignTo: ["marketing-specialist"]
capability: "view_marketing"
taskType: "conversation"
triggerPattern: "presentation|slide deck|deck|slides|pitch deck|powerpoint|pptx|keynote"
userInvocable: true
agentInvocable: true
allowedTools: ["get_marketing_summary", "get_campaign_plan", "create_presentation", "doc_load", "doc_version_list", "mcp__dpf__get_marketing_summary", "mcp__dpf__get_campaign_plan", "mcp__dpf__create_presentation", "mcp__dpf__doc_load", "mcp__dpf__doc_version_list"]
composesFrom: []
contextRequirements: ["storefront archetype", "marketing playbook", "organization brand"]
riskBand: low

enforces:
  - kernel/principles/never-fabricate
  - kernel/principles/single-source-of-truth
  - kernel/principles/outbound-actions-require-explicit-go
---

# Create a presentation

Turn a request for a deck ("six slides for the board on the spring adoption
drive") into a branded PowerPoint file, a PDF and a preview of every slide,
saved as a document the person can review, download and share.

You write an **outline**: what each slide says. The platform lays it out in the
organization's brand (its colours, fonts, logo and name come from the brand
record) and produces the files. You never write or edit the file itself.

## Steps

1. **Load the context before asking anything.** Call `get_marketing_summary`
   for the business type, audience vocabulary, playbook and live campaigns.
   When the deck is about one campaign, call `get_campaign_plan` for its
   objective, audience, offer, proof and KPIs.
2. **Ask at most one round of questions**, and only for what the context cannot
   answer: usually the audience, the decision you want from them, and the slide
   count. If something is still missing, choose a sensible default and say so
   in the reply.
3. **Draft the outline.** One outline slide is one slide in the deck, so a
   six-slide request gets exactly six slides:
   - the first slide is the title slide (title and a subtitle);
   - each content slide gets a short title and up to five bullets, or a chart,
     or a table, or an image;
   - put what the presenter should say in `notes`, not on the slide;
   - use a `section` slide to open a new part of a longer deck.
4. **Call `create_presentation`** with `title`, `audience`, `goal` and
   `slides`. Keep the outline you sent: you need it to revise.
5. **Report back** with the link from the result (`/workspace/documents/...`),
   the slide count, and anything you assumed. The person reviews the slide
   previews on that page and downloads the `.pptx` for final edits in their
   own office suite.

## Revising

When the person asks for changes ("make slide 3 a chart", "shorter bullets on
slides 4 and 5"):

1. Change those slides in the outline you kept. If you no longer have it,
   `doc_load` the presentation: its text holds every slide's words.
2. Call `create_presentation` again with the **whole** outline and the
   presentation's `documentId`. This saves the next version of the same
   document, so the history stays in one place. Never create a second document
   for a revision.
3. Say which version you produced and what changed. `doc_version_list` shows
   the history if the person asks.

## Charts, tables and images

- A chart is `{ type: "column" | "bar" | "line" | "pie" | "area", categories,
  series: [{ name, values }] }` with exactly one value per category. Use only
  numbers you can point to: the marketing summary, a campaign's KPIs, or
  figures the person gave you.
- A table is `{ columns, rows }`. Keep it to what fits on a slide (about six
  rows).
- An image is a stored image document, `{ documentId, alt }`, or inline base64
  with its MIME type. Always give alt text that says what the image shows.

## When it fails

The tool returns a plain message and a reason. `invalid-outline` names the
field to fix, for example `slides.2.chart.series.0.values`; fix exactly that and
call again. `converter-unavailable` means this install cannot produce office
files right now: tell the person, and offer the outline as text so nothing is
lost. Nothing is saved when a call fails.

## What it will not do

- It does not invent figures, quotes, logos or customer names. A slide without
  a grounded number says what is missing instead.
- It does not send, publish or post the deck anywhere. Sharing it is the
  person's decision.
- It does not edit the file's XML, and it does not store a hand-edited copy.
  A person who edits the `.pptx` in their own suite uploads it back as a new
  version of the document.

## Worked example

A rescue's operator asks: "Six slides for Thursday's board meeting on the
spring adoption drive."

`get_marketing_summary` shows a nonprofit-community playbook (adopters, donors,
volunteers) and a live "Spring adoption drive" campaign; `get_campaign_plan`
gives its goal of 60 adoptions in six weeks and last quarter's 42. The outline
sent to `create_presentation`:

- `title`: "Spring adoption drive", `audience`: "Board", `goal`: "Approve the
  six-week plan and budget"
- slides: a title slide; "Where we are" (bullets: 42 adoptions last quarter,
  12 foster homes); "Adoptions by month" (a column chart of the quarter's
  figures); "The plan" (section); "Channels and budget" (a table); "The ask"
  (bullets: approve the budget, name a volunteer lead).

The reply links the new document and notes that the channel budget came from
the campaign plan. When the board chair asks for the budget as a chart, the
coworker changes slide 5 to a chart and calls `create_presentation` again with
the same `documentId`, producing version 2.

## Enforces

- `kernel/principles/never-fabricate`: every number on a slide comes from the
  marketing workspace or the person.
- `kernel/principles/single-source-of-truth`: a revision is the next version of
  one document, and the brand comes from the organization's record.
- `kernel/principles/outbound-actions-require-explicit-go`: producing a deck
  never shares it.
