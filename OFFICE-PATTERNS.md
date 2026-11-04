# Office app patterns

Apply the same model contract as game starters: select one proven pattern, expose editable data and settings, preserve tested behavior, and test the primary user action. These are candidates, not implemented office-suite replacements.

| Pattern | First playable workflow | Critical check |
|---|---|---|
| Calculator | Enter operands, calculate, clear | Decimals, divide by zero, clear |
| Spreadsheet | Edit grid, basic formulas, CSV import/export | Recalculate dependencies, detect cycles, round-trip data |
| Slides | Add, edit, reorder and present slides | Present in the saved order; verify export separately |
| Documents | Edit headings, lists and tables | Undo, save and reopen |
| Data dashboard | Filter a table and chart | Chart and totals match filtered rows |
| Tasks / kanban | Add and move cards | Moves persist and can be undone |
| Calendar / planner | Add and move an event | Correct date/time zone and no accidental duplicate |
| Timesheet / expenses | Enter rows and total them | Correct currency rounding and export |
| Forms / approvals | Fill, validate and review a form | No submission before explicit action |
| Notes / meeting minutes | Record notes and action items | Save, search and recover edits |
| Invoice / quote | Edit line items and preview totals | Correct tax and rounding; no automatic sending |
| Mail merge | Preview per-recipient draft | Test with sample contacts; send is separate |

## Playable prototypes

Open [Kanban](src/starters/kanban.html) or [Mini Spreadsheet](src/starters/spreadsheet.html) as a standalone browser page. Kanban supports add, move, remove and undo for the current session. The spreadsheet imports and exports CSV, recalculates basic arithmetic and references, and reports invalid or cyclic formulas. CSV preserves formula source; it does not support Excel workbooks. Open exported files only in spreadsheet software you trust to handle their formulas. For the browser check, run `node tests/e2e/office.cjs` with Playwright and Chromium available.
