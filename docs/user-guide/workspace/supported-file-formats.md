---
title: "Supported File Formats"
area: workspace
order: 5
relatedCode:
  - apps/web/lib/shared/office-conversion.ts
  - apps/web/lib/shared/file-parsers.ts
  - apps/web/lib/shared/file-upload.ts
  - apps/web/lib/workbooks/sheet-import.ts
---

## Use This Doc For

- Attaching a file to an AI coworker conversation
- Uploading a business plan or key document during onboarding
- Importing a spreadsheet into a Workbook, or a team roster during onboarding

## Which files are read

| Kind | Read directly | Read through the document converter |
|---|---|---|
| Documents | `.docx`, `.pdf`, `.txt`, `.md` | Word 97-2003 `.doc`, Rich Text `.rtf`, OpenDocument `.odt` |
| Spreadsheets | `.xlsx`, `.csv`, `.tsv` | Excel 97-2003 `.xls`, OpenDocument `.ods` |
| Presentations | — | `.pptx`, PowerPoint 97-2003 `.ppt`, OpenDocument `.odp` (the slide text) |

The platform checks what a file actually contains, not only its name. A `.docx`
that was renamed `.doc` is read as the `.docx` it really is.

Files in the right-hand column are first converted into the format in the middle
column, then read the same way. An `.xls` or `.ods` therefore imports into a
Workbook exactly as an `.xlsx` does. Presentations contribute their slide text
to the coworker and to onboarding; they do not become a Workbook table.

Size limits do not change with the format. A coworker attachment is limited to
10 MB.

## When the converter is off

The document converter is part of the platform, but not every installation has
it switched on. When it is off, a file from the right-hand column is still
stored, and the page says in plain words that its content could not be read,
along with the format to save it in instead (for example, save an `.xls` as
`.xlsx` or CSV). Nothing is stored as garbled text.

When a conversion is attempted but does not finish, because the file is too
large, takes too long, or is damaged or password-protected, the message says
which of these happened.

OpenDocument files can carry embedded objects, such as a chart. The converter
does not open embedded objects, for safety. A normal `.odt` or `.ods` with a
chart is still read: its text and numbers come through, and its PDF copy shows
the chart as a picture. If the converter refuses a file because of its embedded
objects, the message says that the file contains embedded objects (such as
charts) that the platform does not open. Save a copy without them, or as PDF,
and upload that instead.

For the technical detail behind the converter, see the platform-support
watchlist entry D18 in the install documentation.
