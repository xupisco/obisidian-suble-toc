import { MarkdownView } from "obsidian";
import { EditorView } from "@codemirror/view";
import { HeadingItem, NavTarget } from "./types";

/** Pixels below the viewport top a heading must cross to count as "active". */
const ACTIVE_THRESHOLD = 60;
/** Margin kept above a heading when scrolling it to the top. */
const SCROLL_MARGIN = 12;
/** How long to keep `is-flashing` before removing it (covers Obsidian's animation). */
const FLASH_MS = 3000;
/** Max animation frames to wait for the target line to render before flashing. */
const FLASH_MAX_FRAMES = 45;

/** Briefly add Obsidian's `is-flashing` highlight to an element. */
function flashElement(el: HTMLElement): void {
	el.classList.add("is-flashing");
	window.setTimeout(() => el.classList.remove("is-flashing"), FLASH_MS);
}

/**
 * Flash the line at `pos`. The target may not be rendered yet (CodeMirror only
 * mounts visible lines, and smooth scroll arrives a few frames later), so retry
 * across frames until the DOM node exists.
 */
function flashEditorLine(cm: EditorView, pos: number): void {
	const attempt = (frame: number) => {
		let line: HTMLElement | null = null;
		try {
			const node = cm.domAtPos(pos).node;
			const host = node instanceof HTMLElement ? node : node.parentElement;
			line = host?.closest(".cm-line") ?? null;
		} catch {
			line = null;
		}
		if (line) flashElement(line);
		else if (frame < FLASH_MAX_FRAMES) requestAnimationFrame(() => attempt(frame + 1));
	};
	attempt(0);
}

/** Best-effort flash of a rendered heading in Reading mode (matched by text). */
function flashPreviewHeading(view: MarkdownView, text: string): void {
	const root = view.contentEl.querySelector<HTMLElement>(".markdown-preview-view");
	if (!root) return;
	const target = text.trim();
	const attempt = (frame: number) => {
		const headings = root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6");
		const match = Array.from(headings).find((h) => h.textContent?.trim() === target);
		if (match) flashElement(match);
		else if (frame < FLASH_MAX_FRAMES) requestAnimationFrame(() => attempt(frame + 1));
	};
	attempt(0);
}

/** Best-effort flash of a rendered task in Reading mode (matched by its text). */
function flashPreviewTask(view: MarkdownView, text: string): void {
	const root = view.contentEl.querySelector<HTMLElement>(".markdown-preview-view");
	if (!root) return;
	const target = text.trim();
	// A task's own text, excluding any nested sub-list items.
	const ownText = (li: HTMLElement): string => {
		const clone = li.cloneNode(true) as HTMLElement;
		clone.querySelectorAll("ul, ol").forEach((n) => n.remove());
		return clone.textContent?.trim() ?? "";
	};
	const attempt = (frame: number) => {
		const items = root.querySelectorAll<HTMLElement>("li.task-list-item");
		const match = Array.from(items).find((li) => ownText(li) === target);
		if (match) flashElement(match);
		else if (frame < FLASH_MAX_FRAMES) requestAnimationFrame(() => attempt(frame + 1));
	};
	attempt(0);
}

/** The underlying CodeMirror 6 view backing the editor, when available. */
function getEditorView(view: MarkdownView): EditorView | null {
	const cm = (view.editor as unknown as { cm?: EditorView } | undefined)?.cm;
	return cm ?? null;
}

/** The mode-specific scroll handler exposed by Obsidian (preview/source). */
interface ModeScroll {
	applyScroll?(line: number): void;
	getScroll?(): number;
}

function getCurrentModeScroll(view: MarkdownView): ModeScroll | null {
	return (view.currentMode as unknown as ModeScroll) ?? null;
}

/** The scrollable element for the current mode, used to bind scroll listeners. */
export function getScroller(view: MarkdownView): HTMLElement | null {
	if (view.getMode() === "preview") {
		return view.contentEl.querySelector<HTMLElement>(".markdown-preview-view");
	}
	const cm = getEditorView(view);
	return cm ? cm.scrollDOM : null;
}

/** Smoothly animate an element's scrollTop to a target value. */
function animateScrollTop(
	el: HTMLElement,
	to: number,
	duration = 280,
	onDone?: () => void,
): void {
	const start = el.scrollTop;
	const delta = to - start;
	if (Math.abs(delta) < 2) {
		el.scrollTop = to;
		onDone?.();
		return;
	}
	const startTime = performance.now();
	const step = (now: number) => {
		const t = Math.min(1, (now - startTime) / duration);
		// easeInOutCubic
		const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
		el.scrollTop = start + delta * eased;
		if (t < 1) requestAnimationFrame(step);
		else onDone?.();
	};
	requestAnimationFrame(step);
}

/**
 * Smoothly scroll a CodeMirror editor so the line at `pos` sits near the top.
 * Unlike animateScrollTop, the destination is recomputed on every frame: for a
 * far line that CodeMirror hasn't rendered yet, lineBlockAt().top is only an
 * estimate, and it converges to the real value as the intervening lines scroll
 * into view and get measured. Easing toward a single precomputed target would
 * therefore land in the wrong place — the heading ends up mid/bottom screen
 * instead of at the top. The final frame snaps to the now-accurate position.
 */
function animateScrollToLine(
	cm: EditorView,
	pos: number,
	duration: number,
	onDone?: () => void,
): void {
	const el = cm.scrollDOM;
	const start = el.scrollTop;
	const targetTop = () => Math.max(0, cm.lineBlockAt(pos).top - SCROLL_MARGIN);
	const startTime = performance.now();
	const step = (now: number) => {
		const t = Math.min(1, (now - startTime) / duration);
		// easeInOutCubic
		const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
		el.scrollTop = start + (targetTop() - start) * eased;
		if (t < 1) requestAnimationFrame(step);
		else {
			el.scrollTop = targetTop();
			onDone?.();
		}
	};
	requestAnimationFrame(step);
}

/** Scroll the note so the given target line sits near the top of the viewport. */
export function scrollToTarget(
	view: MarkdownView,
	target: NavTarget,
	smooth: boolean,
	kind: "heading" | "task" = "heading",
): void {
	try {
		if (view.getMode() === "preview") {
			const mode = getCurrentModeScroll(view);
			if (mode?.applyScroll) {
				const flash = () => {
					if (kind === "task") flashPreviewTask(view, target.text);
					else flashPreviewHeading(view, target.text);
				};
				const scroller = getScroller(view);
				if (smooth && scroller) {
					// applyScroll jumps instantly, so use it only to discover the
					// destination: snap there, read it, restore the original
					// position, then animate the preview's own scrollTop to it.
					const from = scroller.scrollTop;
					mode.applyScroll(target.line);
					const to = scroller.scrollTop;
					scroller.scrollTop = from;
					animateScrollTop(scroller, to, 280, flash);
				} else {
					mode.applyScroll(target.line);
					flash();
				}
				return;
			}
		}

		const cm = getEditorView(view);
		if (!cm) return;

		const pos = cm.state.doc.line(target.line + 1).from;

		if (smooth) {
			// Placing the cursor is deferred to the end: Obsidian scrolls the
			// selection into view instantly, so doing it up front would jump past
			// the animation. The destination is recomputed each frame (see
			// animateScrollToLine) because for a far, unrendered line the geometry
			// starts as an estimate and only firms up as it scrolls into view.
			animateScrollToLine(cm, pos, 280, () => {
				cm.dispatch({ selection: { anchor: pos } });
			});
		} else {
			cm.dispatch({
				selection: { anchor: pos },
				effects: EditorView.scrollIntoView(pos, { y: "start", yMargin: SCROLL_MARGIN }),
			});
		}

		flashEditorLine(cm, pos);
	} catch (e) {
		console.error("Subtle TOC: failed to scroll to heading", e);
	}
}

/** Leading list marker + open checkbox, capturing everything up to the space. */
const OPEN_TASK_MARKUP = /^(\s*(?:[-*+]|\d+[.)])\s+\[) (\])/;

/** Column of the space inside `[ ]` on an open-task line, or -1 if not one. */
function openTaskCheckboxCh(text: unknown): number {
	if (typeof text !== "string") return -1;
	const m = OPEN_TASK_MARKUP.exec(text);
	return m ? m[1].length : -1;
}

/**
 * Complete the task on `line` (0-based) by flipping `[ ]` -> `[x]`. In edit/live
 * preview it goes through the editor (so it's undoable); in reading mode the
 * editor is a detached buffer whose edits don't persist, so the file is written
 * directly instead. Returns false if that line isn't an open task.
 */
export function completeTask(view: MarkdownView, line: number): boolean {
	try {
		if (view.getMode() !== "preview") {
			const editor = view.editor;
			if (editor) {
				const ch = openTaskCheckboxCh(editor.getLine(line));
				if (ch < 0) return false;
				editor.replaceRange("x", { line, ch }, { line, ch: ch + 1 });
				return true;
			}
		}

		// Reading mode (or no editor): rewrite the file atomically.
		const file = view.file;
		if (!file || openTaskCheckboxCh(view.getViewData().split("\n")[line]) < 0) return false;
		void view.app.vault
			.process(file, (data) => {
				const lines = data.split("\n");
				const ch = openTaskCheckboxCh(lines[line]);
				if (ch >= 0) lines[line] = lines[line].slice(0, ch) + "x" + lines[line].slice(ch + 1);
				return lines.join("\n");
			})
			.catch((e) => console.error("Subtle TOC: failed to complete task", e));
		return true;
	} catch (e) {
		console.error("Subtle TOC: failed to complete task", e);
		return false;
	}
}

/**
 * Index of the heading whose section is currently in view (the last heading
 * scrolled past). Returns -1 when there are no headings.
 */
export function getActiveHeadingIndex(
	view: MarkdownView,
	headings: HeadingItem[],
): number {
	if (headings.length === 0) return -1;

	try {
		if (view.getMode() !== "preview") {
			const cm = getEditorView(view);
			if (cm) {
				const scrollTop = cm.scrollDOM.scrollTop;
				let active = 0;
				for (let i = 0; i < headings.length; i++) {
					const pos = cm.state.doc.line(headings[i].line + 1).from;
					const top = cm.lineBlockAt(pos).top;
					if (top - scrollTop <= ACTIVE_THRESHOLD) active = i;
					else break;
				}
				return active;
			}
		} else {
			const mode = getCurrentModeScroll(view);
			if (mode?.getScroll) {
				const scrollLine = mode.getScroll();
				let active = 0;
				for (let i = 0; i < headings.length; i++) {
					if (headings[i].line <= scrollLine + 1) active = i;
					else break;
				}
				return active;
			}
		}
	} catch (e) {
		console.error("Subtle TOC: failed to compute active heading", e);
	}

	return 0;
}
