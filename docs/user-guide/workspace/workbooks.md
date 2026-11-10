---
title: "Workbooks"
area: workspace
order: 4
relatedCode:
  - apps/web/components/workbooks/GridExportMenu.tsx
  - apps/web/components/workbooks/grid-office-export.ts
  - apps/web/lib/workbooks/export-fods.ts
  - apps/web/lib/workbooks/export-workbook.ts
  - apps/web/components/workbooks/WorkbookViewTabs.tsx
  - apps/web/lib/workbooks/workbook-authoring.ts
  - apps/web/lib/mcp/packs/workbooks-pack.ts
---

## Use This Doc For

- `/workbooks`
- `/workbooks/[workbookId]`
- Exporting a Workbook table, or a platform grid, to a spreadsheet file
- Opening a board (kanban view) of a table
- Asking a coworker to build a tracker

## Export

**Export** above the grid downloads the view you are looking at: the visible columns, in the current sort, with the current filters.

- **CSV (.csv)** writes the values as text.
- **Excel (.xlsx)** and **OpenDocument (.ods)** write a real spreadsheet:
  - numbers stay numbers, checkboxes become TRUE/FALSE and dates become dates;
  - column formats carry over: decimal places, currency symbols and percentages;
  - calculated columns keep their formulas, so the file still calculates when you edit it. A formula that only makes sense inside the platform, such as a count across the whole table or a lookup of a linked record, is written as its current value;
  - highlighting rules from **Format** carry over as conditional formatting;
  - when the summary panel is open as a chart, its bars are added on a second sheet, **Chart data**, with the bar chart drawn below them.

These files are made by the platform's document conversion. On an install where conversion is not set up, **Excel (.xlsx)** still downloads, with values only, and the grid says so. **OpenDocument (.ods)** needs conversion and says so when it is missing.

## Boards

A table can have boards: kanban views that put each row on a card, in one lane per option of a select column such as **Status**.

- When a table has a board, tabs appear above it: **Grid** and one tab per board.
- Drag a card to another lane to change that row's value. It saves like an edit in the grid.
- If the column a board groups by is deleted, the board's tab opens the grid instead.

## Ask a Coworker to Build a Tracker

The Documentation Specialist can build a Workbook from a brief, for example "a launch tracker with owner, due date, status and estimate, and a board by status".

- The workbook it creates is yours: you are its owner, and you can share, edit or delete it as if you had made it.
- It adds typed columns: text, numbers, dates, select lists, links to records you can see, and formulas over other columns.
- It refuses what you could not do yourself: building in a workbook you can only view, or linking to records you are not allowed to see.
- When it is done it gives you a link that opens the table, or straight onto its board.
