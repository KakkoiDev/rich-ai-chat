# Action recording primitives

Initial reusable layer for Pi Workbench task 333. No dependencies, installation, automatic disk writes or network
requests. The host imports `recorder.mjs` into the app and supplies `post(steps)`; the library observes user actions
and submits Recorder-shaped step objects. Redacted input values are an explicit privacy extension, not directly import-ready Chrome Recorder JSON; supply synthetic values before external replay. The host must normalize posted flows with `flows.clean_flow` before storing
or attaching them to model context. Do not trust client JSON just because it came from this script.

```js
import { installRecorder } from './recorder.mjs';
const recorder = installRecorder({ post: steps => hostDelivery({ steps }), enabled: consent });
await recorder.flush();
recorder.setEnabled(false);
recorder.stop();
```

`post` is the host's callback, not a bundled transport. Delivery failures are dropped, never thrown into the app.
Only one delivery is in flight and the pending queue has at most `maxSteps` items (200 by default). Disabling or
stopping clears queued steps and detaches listeners on stop. A delivery already handed to the callback cannot be
recalled: the host must enforce disable/consent at its storage boundary too. `flush()` waits for the current delivery;
it is not a guarantee of durable storage or a drain of future events.

Privacy defaults deliberately trade replay fidelity for safety:

- Never retain raw typed text, even in memory for later export. Input is a redaction marker and Unicode character count.
- Skip password/token/OTP fields and descendants marked `data-secret` or `data-private`.
- Focus/blur transitions and clicks on non-interactive surfaces (including canvas) use the same private-target exclusions. Navigation-key releases are observed from actual keyup events, not invented at keydown.
- Selectors contain structural tag/nth-of-type paths only, never accessible names, IDs, data values or visible DOM text.
- No printable-key shortcuts, error messages, console arguments, URL queries, fragments or route text are captured.
- Python normalization accepts loopback navigation only and reduces it to its origin. It drops unknown fields and step
  types and bounds step counts. Routes containing personal data therefore cannot enter context through this boundary.
- Hosts enforce request/body/storage byte limits before parsing; this library does not provide a network service.

Selectors can become stale when a page changes. Closed/open shadow DOM events are omitted by this initial recorder
rather than assigned misleading page selectors. Select changes, scroll, navigation and error capture are not yet
implemented in the browser producer (the Python boundary accepts some Recorder steps from other producers).

```python
from recording.flows import clean_flow, convert
flow = clean_flow(posted_json)
source = convert(flow, target='python')  # or javascript
```

Generated tests use a host-provided Python `page`/`base` fixture or JavaScript `@playwright/test` `baseURL`. They always
fail with “Add the expected outcome” until a person/agent writes an assertion. Redacted inputs need synthetic test
values; they are not replayed as strings. Generated code is a draft, never proof of the application's behavior. The
converter never installs a browser or runs the generated source.

Remaining task 333 work belongs to the host adapter: guarded Preview injection, per-project storage and retention,
problem-intent classification/context attachment, and reviewed report drafting. No Report a Problem UI, raw-text
consent/export, automatic issue creation, storage rotation or diagnostic error collection is shipped in this slice.
The library does not infer consent or bypass any phase/guardrail.

Tests: `python3 -m unittest discover -s tests -p test_recording.py`; `python -m pytest tests/test_adopt.py`;
`PI_TEST_CHROME=<existing Chromium> ./node_modules/.bin/playwright test tests/js/recording.spec.js`.
