# Verify app behavior, then make repairs resumable

The current revision route checks generated source and retries, but source checks cannot show whether the behavior the user asked for actually works. A revision can pass those checks and still introduce a timer that starts unexpectedly. The current background worker has leases and receipt-backed checkpoints, but its generation steps do not yet run the artifact revision pipeline.

## Behavior checks before accepting a revision

Start with a closed set of actions: locate a control by role/name, click, type, advance a virtual clock, and check visibility, text, or value. Ask the model to propose the checks from the user's request before generating edits, validate the checks against the schema, and keep the checks unchanged across retries. Evaluate the old and candidate previews so a check that already passes can detect a regression. Surface which behaviors were checked and which could not be expressed. Do not run model-authored test code. Execute the candidate in an isolated browser with no network, credentials, or shared storage. Keep the existing preview on failure and feed the first failed check back into the next repair attempt. Show the action and failure in Activity; capture a local trace on opt-in.

Start with synthetic revisions that change a visible control and preserve disabled automation, then add a randomized tool and a keyboard-driven game. Use the same checks across DeepSeek Flash, GPT-OSS 20B, Gemma 4 12B, E4B, and E2B. Include intentionally broken candidates to confirm the checks reject them.

The first verification pass is implemented. Set `RICH_CHAT_VERIFICATION_CHROMIUM` to an absolute path to a trusted Chromium executable. The same plan is reused for all candidates in one request. Activity distinguishes a rejected candidate, a smoke check with no behavior assertions, and a skipped browser check. Bundled engine previews and trace capture are still out of scope for this pass. The elapsed-time action uses the real browser clock and is bounded. Test the runner with:

```sh
node tests/e2e/revision-browser.mjs
```

## Resumable repair jobs

Reuse the existing task worker in `src/lib/tasks/jobs.ts` and `src/lib/tasks/worker.ts`. Move revision work behind a job handler with a durable payload: source revision and hash, requested changes, fixed behavior checks, last candidate reference, completed checks, and the next repair strategy. Checkpoint after each completed attempt. Keep generated artifacts and traces outside the task summary. Publish a candidate only after verification and only if its original source revision still matches; otherwise offer it separately. Make cancel and resume available in Tasks. Model changes remain visible in Activity and follow the user's model settings.

Test by terminating the worker after a failed check, then restarting it. The job should continue with the next strategy, retain the original preview until a candidate passes, and publish the result only once. Repeat with a newer user edit and with cancellation.

## Article access handoff

The public reader extracts readable text without credentials. Add a user-initiated handoff for sites that require sign-in or consent. Keep the browser session local and pass only the selected article text back to the chat. Exercise the flow on synthetic public, preview-only, and authenticated pages; a preview alone must never be presented as the full article.
