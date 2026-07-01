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

## Screenshots

![Popover outline open](subtle-toc-obsidian_open.png)

![Edge minimap](subtle-toc-obsidian_minimap.png)

## Install (Community plugins)

1. Open *Settings → Community plugins* in Obsidian.
2. Make sure **Restricted mode** is turned off (click **Turn on community plugins** if needed).
3. Click **Browse**, search for **Subtle TOC**, and open its page.
4. Click **Install**, then **Enable**.

## Install (BRAT — beta / before it's in the directory)

If the plugin isn't in the official Community plugins directory yet, you can
install it with [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Install **BRAT** from *Settings → Community plugins → Browse* and enable it.
2. Open the command palette and run **BRAT: Add a beta plugin for testing**.
3. Paste the repository URL:
   ```
   https://github.com/xupisco/obisidian-suble-toc
   ```
4. Confirm — BRAT downloads the latest release and keeps it up to date.
5. Enable **Subtle TOC** in *Settings → Community plugins*.

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
