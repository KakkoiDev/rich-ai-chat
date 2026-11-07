# Kakkoi Chat — design hand-back

Answers the brief "Rich AI Chat — designer handoff" (7 Nov 2026).

## Links

**Design canvas (all frames):** https://claude.ai/code/artifact/41493272-af23-486c-b807-433f3e10ae3f

The canvas is private until its owner shares it (Share menu on the canvas). Its pages and artboards:

| Page | Artboard (file) | Brief section |
| --- | --- | --- |
| 1 · Kakkoi system | Main.dc.html: one-page style + decisions | §3, §9.1, §9.6 |
| | Tokens.dc.html: colour, chart roles, type scale, space, motion | §6 |
| | Brand.dc.html: wordmark, mark, icons, app-icon template | §4, §9.3 |
| | Components.dc.html: state sheet, dialog, toast, tooltip | §6 |
| 2 · Chat, composer, replies | ChatDesktop.dc.html: shell, desktop, EN | §5.1 |
| | ChatPhones.dc.html: welcome EN, answer JA, keyboard open, dark | §5.1 |
| | Composer.dc.html: attach, model, dictate ×6, stop, unreachable | §5.2 |
| | Replies.dc.html: reply rules, chart, form before/after, long table on phone | §5.3 |
| 3 · Activity | Activity.dc.html: the eight cases | §5.4 |
| | LogDesktop.dc.html: full log, filter, export, delete | §5.4 |
| | ActivityPhones.dc.html: long log on phone, JA dark retry | §5.4 |
| 4 · Generated apps | AppCards.dc.html: card v1 → v2, saved apps | §5.5.1, §5.5.5 |
| | Fullscreen.dc.html: desktop full screen, iPhone overlay portrait + landscape | §5.5.2 |
| | Install.dc.html: download, install sheet, Android page, iOS steps (JA) | §5.5.3–4 |
| 5 · Tasks | Tasks.dc.html: panel, job card, conflict | §5.6 |
| | TasksPhones.dc.html: JA sheet, job card states | §5.6 |
| 6 · Connection & edge states | Connection.dc.html: offline, unreachable, Tailscale off, reconnecting, reconnected, loading model | §5.7 |
| | EdgeStates.dc.html: storage full, error, empty, 320 px, 200% text, long content | §7 |
| 7 · Copy deck | CopyDeck.dc.html: every string, EN/JA | §9.5 |

**Brief:** `docs/design/BRIEF.md` once saved (see below). **Engineering context:** `ENGINEERING-ROADMAP.md`.

## What is in this pack

| File | What |
| --- | --- |
| `KAKKOI-STYLE.md` | The style in words an agent can apply, plus decisions |
| `kakkoi-tokens.json` | Basecoat token values, light + dark, type, space, motion, contrast ratios |
| `kakkoi.css` | Theme + primitives (buttons, fields, chips, badges, status) |
| `kakkoi-inline.css` | 2.7 KB subset the host adds to every generated app |
| `svg/` | Wordmarks (outlined), lockup, master + mono mark, app icon light/dark, maskable icon, generated-app template + example |
| `fonts/` | Bebas Neue TTF and the OFL licence for all three families |
| `copy-deck.json` | 68 status and error strings, EN/JA |
| `design-source/` | The canvas's own files (`canvas.json` + one `.dc.html` per artboard): source of record, not a runnable page |

## Saving the design in the repos

The theme is shared, so it goes in **visual-core**. The screens, copy and frames belong to the product, so they go in the **Rich AI Chat** repo.

### 1. visual-core: the theme

```
visual-core/
  themes/kakkoi/
    README.md            ← copy of KAKKOI-STYLE.md
    kakkoi-tokens.json
    kakkoi.css
    kakkoi-inline.css
    svg/                 ← all SVGs from this pack
    fonts/
      BebasNeue-Regular.ttf
      Inter[opsz,wght].ttf          ← add (step below)
      NotoSansJP[wght].ttf          ← add (step below)
      OFL-bebasneue.txt  OFL-inter.txt  OFL-notosansjp.txt
```

```sh
cd visual-core
git switch -c theme/kakkoi
mkdir -p themes/kakkoi
unzip ~/Downloads/kakkoi-theme.zip -d /tmp/kk
cp -R /tmp/kk/kakkoi-theme/{kakkoi-tokens.json,kakkoi.css,kakkoi-inline.css,svg,fonts} themes/kakkoi/
cp /tmp/kk/kakkoi-theme/KAKKOI-STYLE.md themes/kakkoi/README.md
# the two variable fonts not bundled here (OFL, google/fonts):
curl -L -o "themes/kakkoi/fonts/Inter[opsz,wght].ttf" "https://raw.githubusercontent.com/google/fonts/main/ofl/inter/Inter%5Bopsz%2Cwght%5D.ttf"
curl -L -o "themes/kakkoi/fonts/NotoSansJP[wght].ttf" "https://raw.githubusercontent.com/google/fonts/main/ofl/notosansjp/NotoSansJP%5Bwght%5D.ttf"
git add themes/kakkoi
git commit -m "Add Kakkoi theme: tokens, CSS, inline subset, marks, fonts"
```

Before shipping, subset the fonts to woff2 (Inter: Latin; Noto Sans JP: unicode-range slices) with `pyftsubset`, and export the PNG icon sizes (16/32/180/192/512) from `svg/` as the brief says.

### 2. Rich AI Chat: the screens

```
docs/design/
  BRIEF.md               ← the designer brief
  HANDOFF.md             ← this file
  copy-deck.json         ← strings; i18n files are generated from it
  frames/                ← PNG or PDF export of each artboard
  canvas/                ← design-source/ from this pack
```

```sh
cd rich-ai-chat
git switch -c design/kakkoi-handback
mkdir -p docs/design/frames docs/design/canvas
cp /tmp/kk/kakkoi-theme/{HANDOFF.md,copy-deck.json} docs/design/
cp -R /tmp/kk/kakkoi-theme/design-source/. docs/design/canvas/
# save the brief you were given as docs/design/BRIEF.md
git add docs/design
git commit -m "Add Kakkoi Chat design hand-back"
```

**Frames:** open the canvas link, then use the canvas's Share › Export to save each page as PDF or PNG into `docs/design/frames/`, named after the artboard (for example `Activity.png`). Commit them with the rest. Re-export whenever the canvas changes, and note the date in the commit message.

### Keeping them in step

- The canvas is where designs change; the repo holds dated snapshots. Link the canvas from the PR description.
- If the canvas and `kakkoi-tokens.json` disagree, the JSON wins: fix the canvas.
- `.dc.html` files load the canvas runtime and uploaded assets (`/_blob/…`), so they render only inside the canvas. Keep them as the source record, and use `frames/` for viewing on GitHub.
