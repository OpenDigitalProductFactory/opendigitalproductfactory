---
name: create-office-document
description: "Produce and revise branded reports, letters, sheets and diagrams."
# Agent Skills standard fields (Surface A: Claude Code)
disable-model-invocation: false
user-invocable: true
allowed-tools: mcp__dpf__create_report mcp__dpf__create_letter mcp__dpf__create_sheet mcp__dpf__create_drawing mcp__dpf__doc_load mcp__dpf__doc_version_list

# DPF fields (Surface B: in-portal seed loader)
category: operations
assignTo: ["finance-controller", "admin-assistant", "ea-architect"]
capability: null
taskType: "conversation"
triggerPattern: "report|board pack|letter|spreadsheet|workbook|excel|xlsx|docx|word document|diagram|flowchart|drawing"
userInvocable: true
agentInvocable: true
allowedTools: ["create_report", "create_letter", "create_sheet", "create_drawing", "doc_load", "doc_version_list", "mcp__dpf__create_report", "mcp__dpf__create_letter", "mcp__dpf__create_sheet", "mcp__dpf__create_drawing", "mcp__dpf__doc_load", "mcp__dpf__doc_version_list"]
composesFrom: []
contextRequirements: ["organization brand"]
riskBand: low

enforces:
  - kernel/principles/never-fabricate
  - kernel/principles/single-source-of-truth
  - kernel/principles/outbound-actions-require-explicit-go
---

# Create an office document

Turn a request for a report, a letter, a spreadsheet or a diagram into a
branded office file, a PDF and page previews, saved as a document the person
can review, download and share. Decks are the separate `create_presentation`.

You write an **outline**: what the document says. The platform lays it out in
the organization's brand and produces the files. You never write or edit the
file itself.

## Pick the tool

| The person wants | Tool | Files |
| --- | --- | --- |
| A report, brief or board pack | `create_report` | .docx, PDF |
| A letter to a named person | `create_letter` | .docx, PDF |
| A table of figures, a budget, a workbook | `create_sheet` | .xlsx, PDF |
| A flowchart, org chart or process diagram | `create_drawing` | .odg, .svg, PDF |

## Steps

1. **Gather the content first.** Use the figures and facts from your own
   workspace reads or from the person. Ask at most one round of questions,
   for what you cannot find: usually the audience, the recipient, or the
   period the figures cover.
2. **Draft the outline.**
   - Report: `title`, optional `summary` and `purpose`, then `sections`, each
     a `heading` with `paragraphs`, `bullets`, a `table`, a `chart` or an
     `image`.
   - Letter: `recipient` (`name`, address `lines`), `subject`, `paragraphs`,
     `signatureName` and `signatureTitle`. The date, "Dear <name>," and
     "Yours sincerely," are filled in unless you give them. Leave `sender`
     out: the letterhead carries the organization.
   - Sheet: `title` plus `columns` and `rows`, or several `sheets`. A total is
     a formula cell, `{ "formula": "=SUM(B2:B13)" }`; formulas cannot reach
     outside the workbook.
   - Drawing: `title`, `shapes` (each an `id` and a `label`) and `connectors`
     (`from` and `to` shape ids). Leave out positions and the shapes are
     placed on a grid in order.
3. **Call the tool.** Keep the outline you sent: you need it to revise.
4. **Report back** with the link from the result (`/workspace/documents/...`)
   and anything you assumed.

## Revising

Change the outline you kept, or `doc_load` the document to recover its text,
then call the same tool with the **whole** outline and the document's
`documentId`. That saves the next version of the same document. Never create
a second document for a revision. `doc_version_list` shows the history.

## When it fails

`invalid-outline` names the field to fix, such as
`sheets.0.rows.3.1.formula`; fix exactly that and call again.
`wrong-document-kind` means the documentId was made by another tool; omit it
to start a new document. `converter-unavailable` means this install cannot
produce office files right now: tell the person and give the outline as text.
Nothing is saved when a call fails.

## What it will not do

- It does not invent figures, names or addresses. A gap is stated, not filled.
- It does not send a letter or publish a report. Sending is the person's
  decision.
- It does not edit the file. A person who edits it in their own office suite
  uploads it back as a new version.

## Enforces

- `kernel/principles/never-fabricate`: every figure comes from a workspace
  read or the person.
- `kernel/principles/single-source-of-truth`: a revision is the next version of
  the same document.
- `kernel/principles/outbound-actions-require-explicit-go`: producing a letter
  is not sending it.
