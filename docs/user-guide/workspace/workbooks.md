---
title: "Workbooks"
area: workspace
order: 4
relatedCode:
  - apps/web/components/workbooks/GridExportMenu.tsx
  - apps/web/components/workbooks/grid-office-export.ts
  - apps/web/lib/workbooks/export-fods.ts
  - apps/web/lib/workbooks/export-workbook.ts
---

## Use This Doc For

- `/workbooks`
- `/workbooks/[workbookId]`
- Exporting a Workbook table, or a platform grid, to a spreadsheet file

## Export

**Export** above the grid downloads the view you are looking at: the visible columns, in the current sort, with the current filters.

- **CSV (.csv)** writes the values as text.
- **Excel (.xlsx)** and **OpenDocument (.ods)** write a real spreadsheet:
  - numbers stay numbers, checkboxes become TRUE/FALSE and dates become dates;
  - column formats carry over: decimal places, currency symbols and percentages;
  - calculated columns keep their formulas, so the file still calculates when you edit it. A formula that only makes sense inside the platform, such as a count across the whole table or a lookup of a linked record, is written as its current value;
  - highlighting rules from **Format** carry over as conditional formatting;
  - when the summary panel is open as a chart, its bars are added on a second sheet, **Chart data**. The chart itself is not drawn in the file yet.

These files are made by the platform's document conversion. On an install where conversion is not set up, **Excel (.xlsx)** still downloads, with values only, and the grid says so. **OpenDocument (.ods)** needs conversion and says so when it is missing.
