# Step 2: Extract reusable PLH tool guardrails

Start after the standalone rich-ai-chat prototype has demonstrated a DeepSeek Flash response, a live search with sources, and safe rendering of a diagram and an image.

Use the harness-next checkout as the initial reference. Preserve its malformed tool JSON recovery and ensure recovery never replays an executed call.

- Define a provider-independent interface for proposed calls, validated arguments, bounded results, and audit events. Keep model adapters, search credentials, and rendering outside the module.
- For the classroom profile, register only web_search. Accept a short validated query, check for obvious personal data, send no chat history, and allow one search per turn. Enforce time and result-size limits.
- Label snippets as untrusted data. Keep source links separate from model text. Reject unsafe URL schemes and avoid model-controlled network fetches. Route student-triggered search through the same controls.
- Test unsupported tools, malformed arguments, duplicate calls, timeouts, and hostile snippets. Verify decisions against the same prompt set on DeepSeek Flash and the intended local 4B model, tracking missed and unnecessary searches separately.
- Integrate the module into rich-ai-chat and one more consumer. Use those integrations to decide whether to publish it separately as local-ai-core.

Done when both consumers can use the same policy without copying enforcement logic, and the model comparison records actual end-to-end results.
