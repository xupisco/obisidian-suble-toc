# Subtle TOC

A floating, Capacities-style table of contents for [Obsidian](https://obsidian.md).

A discreet dashed **minimap** lives on the edge of your note. Hover (or click) it
and a **popover outline** slides out — the heading for the section you're reading
is highlighted, and clicking any heading jumps to it.

## Features

- **Floating popover** overlaid on the note (no sidebar pane needed).
- **Edge minimap** of dashes, one per heading, sized by heading level.
- **Active-heading tracking** in both Editing (Live Preview / Source) and Reading mode.
- **Click to navigate** with optional smooth scroll.
- Configurable side (left/right), open trigger (hover/click) and heading-level range.

## Install (manual / for development)

1. Build the plugin:
   ```bash
   npm install
   npm run build      # produces main.js
   ```
2. Copy `main.js`, `manifest.json` and `styles.css` into your vault at:
   ```
   <vault>/.obsidian/plugins/subtle-toc/
   ```
3. Reload Obsidian and enable **Subtle TOC** in *Settings → Community plugins*.

## Develop

```bash
npm install
npm run dev          # esbuild watch -> rebuilds main.js on change
```

Point the output at a test vault by symlinking the plugin folder, or copy the
three files after each build. Use the "Toggle TOC popover" command (assign a
hotkey) to open/close the outline from the keyboard.

## How it works

- Headings come from Obsidian's `metadataCache`, so the outline stays in sync as
  you type.
- Active-heading detection uses CodeMirror 6 line geometry in Editing mode and
  the preview scroll position in Reading mode.
- One overlay instance is bound to the active Markdown view at a time and rebuilt
  when you switch notes, panes or modes.

## License

MIT
