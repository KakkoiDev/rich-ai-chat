# Design frames

One PNG per artboard of the design canvas, at its exact canvas size, rendered on 7 Nov 2026 for viewing on GitHub. The
canvas is the source of record (https://claude.ai/code/artifact/41493272-af23-486c-b807-433f3e10ae3f, private to its
owner), and `../canvas/` holds its artboard sources.

They were rendered in headless Chromium from the `.dc.html` sources in `../canvas/` with the canvas's own runtime
(`support.js`) and its uploaded assets (the Kakkoi stylesheet and SVG marks), fonts from Google Fonts. Re-render them
whenever the canvas changes, and note the date in the commit.

These are the designer's frames as handed back. Where the owner decided otherwise later, the
[roadmap](../../ENGINEERING-ROADMAP.md) wins. For example, anyone may choose any model (the frames show a teacher-only
picker), and the Activity line sits above the reply until the Kakkoi shell is rebuilt.

| Page | Frames |
| --- | --- |
| 1 · Kakkoi system | [Main](Main.png) · [Tokens](Tokens.png) · [Brand](Brand.png) · [Components](Components.png) |
| 2 · Chat, composer, replies | [ChatDesktop](ChatDesktop.png) · [ChatPhones](ChatPhones.png) · [Composer](Composer.png) · [Replies](Replies.png) |
| 3 · Activity | [Activity](Activity.png) · [LogDesktop](LogDesktop.png) · [ActivityPhones](ActivityPhones.png) |
| 4 · Generated apps | [AppCards](AppCards.png) · [Fullscreen](Fullscreen.png) · [Install](Install.png) |
| 5 · Tasks | [Tasks](Tasks.png) · [TasksPhones](TasksPhones.png) |
| 6 · Connection & edge states | [Connection](Connection.png) · [EdgeStates](EdgeStates.png) |
| 7 · Copy deck | [CopyDeck](CopyDeck.png) |
