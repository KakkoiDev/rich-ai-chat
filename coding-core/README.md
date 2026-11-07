# coding-core in this repository

A pinned copy of [coding-core](https://github.com/KakkoiDev/coding-core)'s self-contained JavaScript modules (the
commit is in `MANIFEST.json`). Do not edit `js/` here: change coding-core, then run its
`tools/adopt.py THIS_REPO --update`. This README is the project's.

- `js/task-states.mjs`: guarded transition table (`transition`, `allowedEvents`, `taskTransitions`, `hasEvidence`).
- `js/sqlite.mjs`: `openDatabase`, `transaction`, `migrate` over node:sqlite (Node 22.13+).
- `js/receipts.mjs`: idempotent operation receipts (`operationKey`, `createReceipts`).

Check the copy: `python3 coding-core/adopt.py --verify coding-core`.
