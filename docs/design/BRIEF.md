# Rich AI Chat — designer handoff

This brief is self-contained: you don't need the chat that produced it. Engineering context is in [ENGINEERING-ROADMAP.md](../ENGINEERING-ROADMAP.md), but you shouldn't need it.

## 1. The job

Design a **new chat interface for Rich AI Chat in the Kakkoi style**, and turn that style into a small, reusable theme for other Kakkoi projects.

The style already exists informally on **https://kakkoi.dev**, the owner's homepage. Your first task is to study it and write it down as a system. The owner's direction:

> "The less you add the better. Anyway most websites are gonna be used by AI agents."

Take both halves literally:

1. **Minimal.** Remove before you add. No decoration that doesn't carry meaning. No new colours unless a state needs one.
2. **Readable by people and by agents.** Real text, real headings, real labels, native controls, one obvious action per area. An AI agent driving the page through its accessibility tree should find it as easy as a person does. If a screen only works because of its visual layout, it isn't done.

## 2. The product

Rich AI Chat is a local-first assistant for **KakkoiSchool** classrooms. It runs on a Mac. People reach it in a browser and as an installed web app on their phones over a private network (Tailscale).

What it does today:

- answers questions, with web sources
- shows images, videos, charts, tables and diagrams
- builds and revises small apps and games that people play inside the chat

Coming next:

- open a generated app full screen
- download its source
- install it as its own app
- see an **Activity** log of what happened behind each reply
- keep a **Tasks** list with long-running jobs that resume later

There is **no native mobile app**. The phone experience is the installable web app.

People can choose the model: a hosted one (DeepSeek Flash) or local ones on the Mac (GPT-OSS 20B and the Gemma 4 family, down to E2B). Local models are slower and sometimes fail and retry. The interface must make waiting and failure **honest and calm**.

Principles:

- **Plain words**, in English and Japanese. Never say "tool call", "token", "artifact" or "service worker" to a user.
- **Honest status.** One search happened, so the log shows one search. System status is never presented as the model "thinking".
- **Untrusted content stays framed.** Web results, uploaded files and generated apps are third-party content. Generated apps always run inside a visible frame, with the chat's own controls outside it.
- **Private by default.** Say when text leaves the device. Today that happens only with the hosted model and with web search.

## 3. The Kakkoi style, as observed on kakkoi.dev (2026-11-07)

Measured from the live page:

| Element | Observed |
| --- | --- |
| Colour | Pure black text on pure white. No accent colour. Light grey for the decorative line drawing. |
| Headings | **Bebas Neue** 400: 80 px for the name, 28 px for section titles, slight letter-spacing. Bebas has capitals only. |
| Body | **Inter** (variable, 100–900): 16 px, weight 500 for statements. Navigation is 14 px. |
| Japanese | **Noto Sans JP** 400 (for example the katakana name under the title, and the 日本語 link). |
| Layout | One centred column with a 768 px maximum width, generous vertical space, and full-width hairline rules between sections. |
| Links | Black and underlined. The top-left "KAKKOIDEV" wordmark is set in Bebas Neue. |
| Motif | A large wireframe cube drawn in thin grey lines behind the hero, slowly animated in CSS 3D. |
| Targets | Links are 44 px tall. |
| Icons | A `favicon.ico` (48×48). No app icons and no web manifest. |
| Dark mode | None: the page stays white even when the system prefers dark. |

All three fonts are published under the SIL Open Font Licence, so they can be self-hosted. Confirm the exact files and licences in your hand-back.

What this suggests, for you to confirm or reject:

- a monochrome system where hierarchy comes from type, space and rules rather than colour
- colour reserved for meaning (error, success, focus) and kept rare
- the cube as the one brand motif, used sparingly (for example the empty state or the install icon), never behind content people need to read

## 4. Brand assets: what exists and what needs a decision

| Asset | Status | Decision needed |
| --- | --- | --- |
| Wordmark "KAKKOIDEV" (Bebas Neue text) | Exists on kakkoi.dev as live text | Is "KAKKOI" the shared brand? How do KakkoiSchool and Rich Chat sit under it? Provide an SVG wordmark. |
| Product name | "KakkoiSchool Rich Chat" in code | Final name, plus a home-screen label of 12 characters or fewer. |
| Logo mark or app icon | Not available: only the 48 px favicon on kakkoi.dev; nothing in any local project | **Yes.** One master SVG (the cube is the obvious candidate), plus a maskable version with a safe zone and a monochrome version. Engineering exports 16/32/180/192/512 px. |
| Icon for each generated app | — | **Yes.** An automatic template, for example the app's initial in Bebas on the cube tile. |
| Palette | Black and white only | **Yes.** Semantic roles (§6). Decide dark mode: a straight inversion, or none. |
| Fonts | Bebas Neue, Inter and Noto Sans JP on kakkoi.dev | Confirm. Decide Japanese headings, since Bebas has no Japanese glyphs. Decide whether generated apps get web fonts or system fonts only (see §6). |
| Icons | visual-core already vendors 50 Lucide 1.59.0 icons | Confirm Lucide, or text-only buttons where possible. List any needed: full screen, exit, download, install, activity, tasks, retry, offline. |
| kakkoi.dev source | Not found locally; study the live site | — |
| Current app UI | `docs/walkthrough-preview.png`, `docs/walkthrough.webm` | Reference only; it's being replaced. |

## 5. Screens and flows to design

Design each one for a **phone** (390×844, touch, safe areas, keyboard open) and a **desktop** (1280×800 and wider, keyboard and mouse), in **English and Japanese**, and in dark mode if you keep it.

### 5.1 Chat shell (new)

Today's shell is OpenUI's stock agent interface: a collapsible icon rail with new chat and history, a centred thread, and the composer at the bottom. Engineering will rebuild the shell to your design and keep the underlying chat logic (threads, streaming, rendered replies), so you're free to rethink the layout.

Needs:

- thread list: new chat, rename, delete
- a header with the chat title, plus Activity and Tasks entry points
- the welcome or empty state, with a few starter prompts
- the connection indicator

### 5.2 Composer

Contents:

- the message field
- **attach** (up to 3 text files, 12 KB each, shown as removable chips)
- the **model choice**, showing where it runs ("On this Mac" or "Hosted: text leaves this device") and a speed hint
- **dictate**: idle, waiting for the microphone, recording, transcribing on the Mac, error, permission denied
- **send / stop**

Errors appear under the field. Design the disabled state while the Mac is unreachable.

### 5.3 Replies

Replies are rendered from a fixed catalogue of about 80 components:

- text and Markdown with sources
- image galleries and video links
- charts (bar, line, area, pie, radar, scatter)
- tables, including editable ones
- tabs, accordion, steps and modals
- forms: input, select, date, slider, checkbox, radio, switch, chips, option cards
- callouts, tags and metrics

You don't need to draw all of them. Define the **rules**: type roles, spacing, rules and borders, the chart palette (monochrome patterns or a minimal set of distinguishable tones), table density, and form field states. Then draw these as the reference set:

- a sourced answer
- a chart
- a long table on a phone
- a form before and after it's submitted (the submit button becomes "Sent" and can't be pressed twice)

### 5.4 Activity: a complete, readable log

Each reply gets a collapsed **Activity** line, for example "1 search · 2.4 s". Expanded, it is a timeline:

- each real action with its status and elapsed time: search, clock, image or video search, app build, check
- a one-line result ("4 sources from 3 sites")
- retries with a plain reason ("No answer for 22 s, trying again")
- recoveries ("Answered from the sources already found")

The owner wants a **complete log for debugging**, so also design a **full log view**: every event of a chat in order, with timestamps, filterable by reply. It needs an **Export log** action, which downloads a file for analysis, and a **Delete** action.

Cases to draw:

- live
- complete
- failed
- retry, which must still show **one** search
- cancelled
- nothing happened (a direct answer)
- "reasoning summary not available for this model"
- a long log on a phone

Log text comes from the system, never from the model. Tool results are untrusted plain text.

### 5.5 Generated app: preview → full screen → download → install

1. **Card in the thread.** Title, version (v1, v2…), Run or Restart, Stop, Source, **Full screen**, **Download**, **Install**, and a "What should change?" field with **Request revision**. Pick one primary action. A revision appears as a new card, and the previous version stays above it.
2. **Full screen.**
   - On desktop and iPad this uses the browser's real full screen.
   - **On iPhone it's a full-window overlay**, because iPhone browsers can't make page elements full screen.
   - Design a slim strip outside the app with the title, **Exit** (always visible, 44 px or more; Escape also works), and an overflow menu with download and restart.
   - Respect safe areas and rotation. Exiting keeps the app's state.
3. **Download.** A single HTML file that works offline. Show a short confirmation with the file name.
4. **Install.**
   - The app is installed from its own separate address, not from the chat.
   - On Chrome and Android there's an install button.
   - **On iOS there is no install button.** Show illustrated steps: Share → Add to Home Screen.
   - Mark apps that need the internet.
   - Make clear that the installed app is separate from the chat and its data.
5. **Saved apps.** A list of saved apps with their versions. Reopen one into a new chat to revise it.

### 5.6 Tasks and background jobs

- A panel with the objective and open and done items. Each item has a status: queued, running, blocked (with the reason), done, failed or cancelled. Also show the latest checkpoint, links to outputs, and the evidence for verified items.
- The user can add, reorder, rename and cancel items. Show the conflict state when the agent edits at the same time.
- A job card shows progress, "waiting for the local model", and "resumed after restart". Make clear that **closing the tab doesn't stop a job and Cancel does**.

### 5.7 Connection states

Design these states:

- **Offline**: the shell opens.
- **Mac unreachable**: retry.
- **Tailscale is off on this phone**: how to turn it on.
- **Reconnecting** and **reconnected**: an interrupted reply is labelled as such.
- **The Mac is loading a model**: "Loading Gemma 4 12B…"

## 6. Theme deliverable (shared, lives in visual-core)

visual-core is the shared design-system repository. It vendors **Basecoat** 1.0.2, a minimal CSS component kit, whose components read semantic tokens:

`--background --foreground --card --popover --primary --primary-foreground --secondary --accent --muted --muted-foreground --border --input --ring --destructive --radius`

Deliver the Kakkoi theme as values for those tokens (light, plus dark if kept), plus success, warning, info, focus and the chart roles. Engineering derives everything else from them, including the chat's component theme. Keep the role list short. If two roles end up with the same value, that's fine, and it's in keeping with the style.

Also deliver:

- the type scale (display, heading 1–3, body, small, label, code, tabular numbers) with sizes and line heights
- spacing and radius (kakkoi.dev looks square-edged; confirm the radius)
- the rule (hairline) style
- motion, kept minimal, with reduced-motion versions
- a state sheet for button, input, select, checkbox, radio, switch, tabs, chip, dialog, toast, tooltip, badge, progress, skeleton and list row: default, hover, focus, pressed, disabled, loading, error and selected
- an **inline subset** for generated apps (page, text, button, input, result box and focus) under 4 KB of CSS, which the host adds to every generated app

Generated apps are capped at about 32 KB, so web fonts probably don't fit. Decide whether they use the system font stack or a tiny subset.

## 7. States checklist (every surface)

Draw each surface in these states:

- empty
- loading (long waits are normal with local models, so keep it calm)
- error with a way out
- offline
- Mac unreachable
- storage full (couldn't save)
- permission denied (microphone)
- very long content

## 8. Acceptance criteria

The design is accepted when:

1. Text contrast is at least 4.5:1 (3:1 for large text), and controls and focus are at least 3:1, in every mode you deliver.
2. Focus is always visible, different from hover, at least 2 px, and not shown by colour alone.
3. Touch targets are at least 44×44 px with at least 8 px between them.
4. Status always has text or an icon, never colour alone.
5. Every motion has a reduced-motion version; the cube stays still when reduced motion is requested.
6. Layouts work at 320 px wide with no sideways page scroll (wide tables scroll inside their own area), at 200% text size, and with the keyboard open.
7. Full screen and the overlay keep focus inside, always show Exit, and return focus to where it was.
8. Live changes (streaming, Activity, connection) state what a screen reader announces, politely and without repeating.
9. English and Japanese labels fit, or wrap correctly, everywhere.
10. **Agent check:** every screen can be completed using only its accessibility tree. Every control has a role and an accessible name, headings outline the page, and no meaning lives only in layout or imagery.

## 9. Hand-back

1. A one-page **Kakkoi style description** (§3, confirmed and corrected), in words an agent can apply.
2. The token values (§6) as JSON, the type scale, and the font files with their licences.
3. SVGs: wordmark, mark, maskable mark, monochrome mark, and the generated-app icon template.
4. Frames for §5.1–5.7: phone and desktop, EN and JA, with the states from §7. Use Figma or PNG/SVG.
5. A copy deck (EN/JA) for every status and error string.
6. Answers to these questions:
   - Brand hierarchy: KAKKOI, KakkoiSchool and Rich Chat.
   - Dark mode: yes or no.
   - Do generated apps carry Kakkoi styling or stay neutral?
   - Should students see the model choice?

Out of scope: marketing pages, app-store assets (there's no native app), and the styling of each generated app's own content beyond the inline subset.
