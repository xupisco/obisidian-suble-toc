import { CachedMetadata, MarkdownView } from "obsidian";
import { HeadingItem, TaskItem } from "./types";
import { completeTask, getActiveHeadingIndex, getScroller, scrollToTarget } from "./dom";
import type SubtleTocPlugin from "./main";

type TocTab = "headings" | "tasks";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Leading list marker + checkbox of a task line, e.g. `- [ ] ` or `1. [ ] `. */
const TASK_MARKUP = /^\s*(?:[-*+]|\d+[.)])\s+\[.\]\s*/;

/** Strip the list/checkbox markup so only the task's text remains. */
function stripTaskMarkup(raw: string): string {
	return raw.replace(TASK_MARKUP, "").trim();
}

type SvgChild = [tag: string, attrs: Record<string, string>];

/**
 * Append an inline Lucide-style icon. Drawn by hand rather than via `setIcon`
 * so it renders regardless of the host's icon-registry version.
 */
function createIcon(parent: HTMLElement, children: SvgChild[]): void {
	const svg = document.createElementNS(SVG_NS, "svg");
	const attrs: Record<string, string> = {
		viewBox: "0 0 24 24",
		fill: "none",
		stroke: "currentColor",
		"stroke-width": "2",
		"stroke-linecap": "round",
		"stroke-linejoin": "round",
	};
	for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
	svg.classList.add("subtle-toc-icon");

	for (const [tag, childAttrs] of children) {
		const node = document.createElementNS(SVG_NS, tag);
		for (const [k, v] of Object.entries(childAttrs)) node.setAttribute(k, v);
		svg.appendChild(node);
	}

	parent.appendChild(svg);
}

/** Lucide "square-check". */
function createCheckboxIcon(parent: HTMLElement): void {
	createIcon(parent, [
		["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }],
		["path", { d: "m9 12 2 2 4-4" }],
	]);
}

/** Lucide "heading" (an "H"). */
function createHeadingIcon(parent: HTMLElement): void {
	createIcon(parent, [
		["path", { d: "M6 12h12" }],
		["path", { d: "M6 20V4" }],
		["path", { d: "M18 20V4" }],
	]);
}

/**
 * Owns all DOM and listeners for the floating TOC of a single MarkdownView.
 * The plugin creates one of these per active view and tears it down when the
 * active view changes.
 */
export class TocOverlay {
	private plugin: SubtleTocPlugin;
	readonly view: MarkdownView;

	private rootEl!: HTMLElement;
	private groupEl!: HTMLElement;
	private edgeEl!: HTMLElement;
	private minimapEl!: HTMLElement;
	private taskBadgeEl!: HTMLElement;
	private popoverEl!: HTMLElement;
	private tabsEl!: HTMLElement;
	private headingsTabEl!: HTMLElement;
	private tasksTabEl!: HTMLElement;
	private tasksCountEl!: HTMLElement;
	private listEl!: HTMLElement;
	private tasksListEl!: HTMLElement;

	private headings: HeadingItem[] = [];
	private tasks: TaskItem[] = [];
	private dashEls: HTMLElement[] = [];
	private itemEls: HTMLElement[] = [];
	private taskEls: HTMLElement[] = [];
	/** Lines completed via the TOC this session — filtered out so a struck task
	 *  stays hidden on the next open even before the metadata cache catches up. */
	private completedLines = new Set<number>();
	private activeIndex = -1;
	/** Starts on the configured default tab, then follows the last-used one. */
	private activeTab: TocTab;
	private isOpen = false;

	private scroller: HTMLElement | null = null;
	private closeTimer: number | null = null;
	private rafPending = false;
	private readonly onScroll = () => this.scheduleActiveUpdate();
	/** True during a click-driven scroll animation; suppresses the popover list's
	 *  active-item auto-scroll so it doesn't slide under the cursor. */
	private navigating = false;
	private navTimer: number | null = null;

	constructor(plugin: SubtleTocPlugin, view: MarkdownView) {
		this.plugin = plugin;
		this.view = view;
		this.activeTab = plugin.settings.defaultTab;
	}

	private get settings() {
		return this.plugin.settings;
	}

	// ---- lifecycle ---------------------------------------------------------

	mount(): void {
		const host = this.view.contentEl;
		host.addClass("subtle-toc-host");

		this.rootEl = host.createDiv({ cls: "subtle-toc-root" });
		this.groupEl = this.rootEl.createDiv({ cls: "subtle-toc-group" });

		// The edge stacks the dashes minimap over the task badge (either can be
		// hidden). Kept out of the minimap's clipped/max-height box.
		this.edgeEl = this.groupEl.createDiv({ cls: "subtle-toc-edge" });
		this.minimapEl = this.edgeEl.createDiv({ cls: "subtle-toc-minimap" });
		this.taskBadgeEl = this.edgeEl.createDiv({ cls: "subtle-toc-task-badge is-hidden" });
		this.popoverEl = this.groupEl.createDiv({ cls: "subtle-toc-popover" });

		this.buildPopoverChrome();
		this.bindGroupEvents();
		this.applySide();
		this.applyPixelSnap();
	}

	/**
	 * Pin the dash height (and gap) to a whole number of *device* pixels so the
	 * 2px hairlines render as solid blocks instead of antialiasing to different
	 * apparent heights under fractional display scaling (e.g. Windows 125%).
	 */
	private applyPixelSnap(): void {
		const dpr = window.devicePixelRatio || 1;
		const snap = (cssPx: number, minDevicePx: number) =>
			Math.max(minDevicePx, Math.round(cssPx * dpr)) / dpr;
		this.minimapEl.style.setProperty("--toc-dash-h", `${snap(2, 2)}px`);
		this.minimapEl.style.setProperty("--toc-gap", `${snap(6, 1)}px`);
	}

	unmount(): void {
		this.detachScroller();
		if (this.closeTimer !== null) window.clearTimeout(this.closeTimer);
		if (this.navTimer !== null) window.clearTimeout(this.navTimer);
		this.rootEl?.remove();
		this.view.contentEl.removeClass("subtle-toc-host");
	}

	// ---- DOM construction --------------------------------------------------

	private buildPopoverChrome(): void {
		const body = this.popoverEl.createDiv({ cls: "subtle-toc-body" });

		this.tabsEl = body.createDiv({ cls: "subtle-toc-tabs" });
		// The default tab leads the tab bar (createTab appends in call order).
		if (this.settings.defaultTab === "tasks") {
			this.tasksTabEl = this.createTab("tasks", "Tasks");
			this.headingsTabEl = this.createTab("headings", "Headings");
		} else {
			this.headingsTabEl = this.createTab("headings", "Headings");
			this.tasksTabEl = this.createTab("tasks", "Tasks");
		}

		this.listEl = body.createDiv({ cls: "subtle-toc-list subtle-toc-headings" });
		this.tasksListEl = body.createDiv({ cls: "subtle-toc-list subtle-toc-tasks" });
	}

	private createTab(tab: TocTab, label: string): HTMLElement {
		const btn = this.tabsEl.createDiv({ cls: "subtle-toc-tab" });
		const icon = btn.createSpan({ cls: "subtle-toc-tab-icon" });
		if (tab === "tasks") createCheckboxIcon(icon);
		else createHeadingIcon(icon);
		btn.createSpan({ cls: "subtle-toc-tab-label", text: label });
		if (tab === "tasks") {
			this.tasksCountEl = btn.createSpan({ cls: "subtle-toc-tab-count" });
		}
		// Don't let the click pull focus off the editor (would swallow it) or bubble
		// up to the group's open/close handlers.
		btn.addEventListener("mousedown", (e) => e.preventDefault());
		btn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.selectTab(tab);
		});
		return btn;
	}

	/** Switch the visible list; the tab bar itself only appears when both exist. */
	private selectTab(tab: TocTab): void {
		this.activeTab = tab;
		this.rootEl.toggleClass("is-tab-headings", tab === "headings");
		this.rootEl.toggleClass("is-tab-tasks", tab === "tasks");
		this.headingsTabEl?.toggleClass("is-active", tab === "headings");
		this.tasksTabEl?.toggleClass("is-active", tab === "tasks");
	}

	/** Re-apply the active tab (keeping the last-used one when it has content, or
	 *  falling back to the tab that does). Always calls selectTab so the tab's
	 *  visibility class is in sync — including the very first open. */
	private ensureValidTab(): void {
		const hasHeadings = this.headings.length > 0;
		const hasTasks = this.tasks.length > 0;
		let tab = this.activeTab;
		if (tab === "headings" && !hasHeadings && hasTasks) tab = "tasks";
		else if (tab === "tasks" && !hasTasks && hasHeadings) tab = "headings";
		this.selectTab(tab);
	}

	private bindGroupEvents(): void {
		const trigger = this.settings.openTrigger;

		// Both the dashes and the task badge just open the popover on whatever tab
		// was last active — the tab choice is preserved across opens.
		for (const el of [this.minimapEl, this.taskBadgeEl]) {
			el.addEventListener("mouseenter", () => {
				if (trigger === "hover") this.open();
			});
			el.addEventListener("click", (e) => {
				e.stopPropagation();
				if (trigger === "click") this.toggle();
			});
			el.addEventListener("mouseleave", () => this.scheduleClose());
		}

		this.popoverEl.addEventListener("mouseenter", () => this.cancelClose());
		this.popoverEl.addEventListener("mouseleave", (e) => this.onPopoverLeave(e));
	}

	/** Leaving sideways, back toward the note, reads as "done with it" — close at
	 *  once. Any other exit keeps the grace period, so the popover still survives
	 *  the cursor falling outside when a shorter tab shrinks it. */
	private onPopoverLeave(e: MouseEvent): void {
		const rect = this.popoverEl.getBoundingClientRect();
		const towardNote =
			this.settings.side === "left" ? e.clientX > rect.right : e.clientX < rect.left;
		if (!towardNote) {
			this.scheduleClose();
			return;
		}
		this.cancelClose();
		this.close();
	}

	private applySide(): void {
		this.rootEl.toggleClass("is-left", this.settings.side === "left");
		this.rootEl.toggleClass("is-right", this.settings.side === "right");
	}

	private applyTextWrap(): void {
		this.rootEl.toggleClass("is-multiline", this.settings.multiLine);
	}

	/** Publish the custom active-tab color; removed when unset so the CSS falls
	 *  back to the theme's own value. */
	private applyColors(): void {
		const color = this.settings.activeTabBgColor;
		if (color) this.rootEl.style.setProperty("--toc-active-tab-bg", color);
		else this.rootEl.style.removeProperty("--toc-active-tab-bg");
	}

	// ---- data refresh ------------------------------------------------------

	/** Re-read headings from the metadata cache and rebuild everything. */
	refresh(): void {
		this.applySide();
		this.applyColors();
		this.applyTextWrap();
		this.applyPixelSnap();
		this.rebindScroller();

		const file = this.view.file;
		const cache = file ? this.plugin.app.metadataCache.getFileCache(file) : null;

		const { minLevel, maxLevel, show, showMinimap } = this.settings;
		this.headings =
			show === "tasks"
				? []
				: (cache?.headings ?? [])
						.filter((h) => h.level >= minLevel && h.level <= maxLevel)
						.map((h) => ({ level: h.level, text: h.heading, line: h.position.start.line }));

		// While the popover is open, keep the current task snapshot so completing a
		// task strikes its row instead of yanking it out; it's rebuilt on the next
		// open(). Heading level range deliberately does not apply to tasks.
		if (!this.isOpen) this.refreshTasks(cache);

		const hasHeadings = this.headings.length > 0;
		const hasTasks = this.tasks.length > 0;

		this.rootEl.toggleClass("is-empty", !hasHeadings && !hasTasks);
		this.headingsTabEl.toggleClass("is-hidden", !hasHeadings);
		// Dashes honor the "show minimap" toggle; the badge's visibility is set in
		// refreshTasks().
		this.minimapEl.toggleClass("is-hidden", !showMinimap || !hasHeadings);

		// Preserve the last-used tab across opens; only correct it when the current
		// tab has no content in this note. Skipped while open so a background
		// refresh never yanks the popover to another tab.
		if (!this.isOpen) this.ensureValidTab();

		this.buildMinimap();
		this.buildList();
		this.activeIndex = -1;
		this.updateActive();

		if (!hasHeadings && !hasTasks) this.close();
	}

	/** Recompute the open-task snapshot and rebuild its list + edge badge. */
	private refreshTasks(cache: CachedMetadata | null): void {
		const { show, showMinimap, showTasksInMinimap } = this.settings;
		this.tasks = show === "headings" ? [] : this.readOpenTasks(cache);

		const hasTasks = this.tasks.length > 0;
		this.tasksTabEl.toggleClass("is-hidden", !hasTasks);
		this.tasksCountEl?.setText(String(this.tasks.length));
		// With no headings the badge is the only way to open the popover, so the
		// toggle only suppresses it while the dashes can stand in as the trigger.
		const suppressed = !showTasksInMinimap && this.headings.length > 0;
		this.taskBadgeEl.toggleClass("is-hidden", !showMinimap || !hasTasks || suppressed);
		this.buildTaskBadge();
		this.buildTaskList();
	}

	/** Open tasks (unchecked checkboxes) of the active file, in document order. */
	private readOpenTasks(cache: CachedMetadata | null): TaskItem[] {
		const items = cache?.listItems ?? [];
		const openLines = items.filter((it) => it.task === " ").map((it) => it.position.start.line);

		// Reconcile the completed-bridge: a line stays hidden only while the cache
		// still reports it open (the lag between our edit and the reparse). Once
		// the cache catches up — done, removed, or re-opened — drop it, so a task
		// unchecked in the note reappears here.
		if (this.completedLines.size > 0) {
			const stillOpen = new Set(openLines);
			for (const line of this.completedLines) {
				if (!stillOpen.has(line)) this.completedLines.delete(line);
			}
		}

		const lines = this.view.getViewData().split("\n");
		return items
			.filter((it) => it.task === " " && !this.completedLines.has(it.position.start.line))
			.map((it) => {
				const line = it.position.start.line;
				return { text: stripTaskMarkup(lines[line] ?? ""), line };
			});
	}

	private buildMinimap(): void {
		this.minimapEl.empty();
		this.dashEls = this.headings.map((h, i) => {
			const dash = this.minimapEl.createDiv({
				cls: `subtle-toc-dash subtle-toc-level-${h.level}`,
			});
			dash.setAttribute("aria-label", h.text);
			dash.addEventListener("click", (e) => {
				e.stopPropagation();
				this.navigate(i);
			});
			dash.addEventListener("mouseenter", () => this.peek(i));
			return dash;
		});
	}

	/** The checkbox + open-task count shown on the edge (below the dashes). */
	private buildTaskBadge(): void {
		const n = this.tasks.length;
		this.taskBadgeEl.empty();
		createCheckboxIcon(this.taskBadgeEl);
		this.taskBadgeEl.createSpan({ cls: "subtle-toc-task-badge-count", text: String(n) });
		this.taskBadgeEl.setAttribute("aria-label", `${n} open task${n === 1 ? "" : "s"}`);
	}

	private buildList(): void {
		this.listEl.empty();
		// Indent relative to the shallowest heading present, so the top level
		// (H1, or H2 in notes that skip H1) sits flush with no wasted indent.
		const baseLevel = this.headings.reduce((min, h) => Math.min(min, h.level), 6);
		this.itemEls = this.headings.map((h, i) => {
			const item = this.listEl.createDiv({
				cls: `subtle-toc-item subtle-toc-level-${h.level}`,
			});
			item.style.setProperty("--toc-indent", String(h.level - baseLevel));
			const text = h.text || "(untitled)";
			item.createSpan({ cls: "subtle-toc-item-text", text });
			// Single-line rows cut long text, so the full version lives in a
			// tooltip; wrapped rows already show all of it.
			if (!this.settings.multiLine) item.setAttribute("aria-label", text);
			item.addEventListener("click", () => this.navigate(i));
			return item;
		});

		if (this.headings.length === 0) {
			this.listEl.createDiv({
				cls: "subtle-toc-empty-msg",
				text: "No headings in this note.",
			});
		}
	}

	private buildTaskList(): void {
		this.tasksListEl.empty();
		const withCheckboxes = this.settings.showTaskCheckboxes;
		this.taskEls = this.tasks.map((t, i) => {
			const item = this.tasksListEl.createDiv({
				cls: "subtle-toc-item subtle-toc-task-item",
			});
			if (withCheckboxes) {
				const box = item.createDiv({ cls: "subtle-toc-task-check" });
				box.setAttribute("role", "checkbox");
				box.setAttribute("aria-checked", "false");
				// The checkbox completes the task; keep that click from also
				// navigating or stealing the editor's focus.
				box.addEventListener("mousedown", (e) => e.preventDefault());
				box.addEventListener("click", (e) => {
					e.stopPropagation();
					this.completeTaskAt(i, item);
				});
			}
			const text = t.text || "(empty task)";
			item.createSpan({ cls: "subtle-toc-item-text", text });
			if (!this.settings.multiLine) item.setAttribute("aria-label", text);
			// Keep focus on the editor so a single click navigates (no focus-steal
			// that would swallow the click on this floating overlay).
			item.addEventListener("mousedown", (e) => e.preventDefault());
			item.addEventListener("click", () => this.navigateTask(i));
			return item;
		});

		if (this.tasks.length === 0) {
			this.tasksListEl.createDiv({
				cls: "subtle-toc-empty-msg",
				text: "No open tasks in this note.",
			});
		}
	}

	/**
	 * Complete the task at `index`: flip it done in the note and strike its row.
	 * The row stays (struck) until the next open() so the list doesn't reflow
	 * under the cursor; `completedLines` keeps it hidden from then on.
	 */
	private completeTaskAt(index: number, itemEl: HTMLElement): void {
		const task = this.tasks[index];
		if (!task || itemEl.hasClass("is-done")) return;
		if (!completeTask(this.view, task.line)) return;
		this.completedLines.add(task.line);
		itemEl.addClass("is-done");
		itemEl
			.querySelector<HTMLElement>(".subtle-toc-task-check")
			?.setAttribute("aria-checked", "true");
		// Reflect the completion in the tab count right away (the struck row itself
		// stays until the next open).
		const remaining = this.taskEls.filter((el) => !el.hasClass("is-done")).length;
		this.tasksCountEl?.setText(String(remaining));
	}

	// ---- active heading tracking ------------------------------------------

	private rebindScroller(): void {
		const next = getScroller(this.view);
		if (next === this.scroller) return;
		this.detachScroller();
		this.scroller = next;
		this.scroller?.addEventListener("scroll", this.onScroll, { passive: true });
	}

	private detachScroller(): void {
		this.scroller?.removeEventListener("scroll", this.onScroll);
		this.scroller = null;
	}

	private scheduleActiveUpdate(): void {
		if (this.rafPending) return;
		this.rafPending = true;
		requestAnimationFrame(() => {
			this.rafPending = false;
			this.updateActive();
		});
	}

	private updateActive(): void {
		this.setActive(getActiveHeadingIndex(this.view, this.headings));
	}

	/** Move the active highlight to `next`, always clearing the previous one. */
	private setActive(next: number): void {
		if (next === this.activeIndex) return;

		if (this.activeIndex >= 0) {
			this.dashEls[this.activeIndex]?.removeClass("is-active");
			this.itemEls[this.activeIndex]?.removeClass("is-active");
		}
		this.activeIndex = next;
		if (next >= 0) {
			this.dashEls[next]?.addClass("is-active");
			const item = this.itemEls[next];
			if (item) {
				item.addClass("is-active");
				// Skip while a click is navigating: the active heading sweeps past
				// the intermediate ones as the note scrolls, and auto-scrolling the
				// list to each would slide it under the cursor.
				if (this.isOpen && !this.navigating) {
					item.scrollIntoView({ block: "nearest" });
				}
			}
		}
	}

	// ---- interactions ------------------------------------------------------

	/** Mark a click-driven scroll in progress so the popover list stays put while
	 *  the active heading sweeps through the ones between here and the target;
	 *  otherwise its auto-scroll (see setActive) slides it under the cursor. The
	 *  window covers the scroll animation plus its trailing scroll events. */
	private beginNavigation(): void {
		this.navigating = true;
		if (this.navTimer !== null) window.clearTimeout(this.navTimer);
		this.navTimer = window.setTimeout(() => {
			this.navigating = false;
			this.navTimer = null;
		}, 400);
	}

	private navigate(index: number): void {
		const heading = this.headings[index];
		if (!heading) return;
		this.beginNavigation();
		scrollToTarget(this.view, heading, this.settings.smoothScroll);
		// optimistic highlight; the scroll listener will confirm/correct
		this.setActive(index);
	}

	private navigateTask(index: number): void {
		const task = this.tasks[index];
		if (!task) return;
		this.beginNavigation();
		// Same scroll/flow as headings (incl. is-flashing); no active highlight.
		scrollToTarget(this.view, task, this.settings.smoothScroll, "task");
	}

	/** Briefly preview an item from the minimap without navigating. */
	private peek(index: number): void {
		if (this.settings.openTrigger === "hover") this.open();
		this.itemEls.forEach((el, i) => el.toggleClass("is-peek", i === index));
	}

	open(): void {
		this.cancelClose();
		if (this.isOpen) return;

		// Rebuild tasks fresh so this open reflects the note: completed tasks drop
		// out and any strikes from the previous open are cleared.
		this.refreshTasks(this.currentCache());
		if (this.headings.length === 0 && this.tasks.length === 0) return;

		// Preserve the last-used tab, correcting only if it has no content here.
		this.ensureValidTab();

		this.isOpen = true;
		this.rootEl.addClass("is-open");
		if (this.activeTab === "headings" && this.activeIndex >= 0) {
			this.itemEls[this.activeIndex]?.scrollIntoView({ block: "nearest" });
		}
	}

	close(): void {
		if (!this.isOpen) return;
		this.isOpen = false;
		this.rootEl.removeClass("is-open");
		this.itemEls.forEach((el) => el.removeClass("is-peek"));

		// Resync tasks now that we're closed: completed ones drop from the list and
		// the edge badge count updates.
		this.refreshTasks(this.currentCache());
		this.rootEl.toggleClass(
			"is-empty",
			this.headings.length === 0 && this.tasks.length === 0,
		);
	}

	private currentCache(): CachedMetadata | null {
		const file = this.view.file;
		return file ? this.plugin.app.metadataCache.getFileCache(file) : null;
	}

	toggle(): void {
		if (this.isOpen) this.close();
		else this.open();
	}

	private scheduleClose(): void {
		this.cancelClose();
		this.closeTimer = window.setTimeout(() => this.close(), this.settings.closeDelay);
	}

	private cancelClose(): void {
		if (this.closeTimer !== null) {
			window.clearTimeout(this.closeTimer);
			this.closeTimer = null;
		}
	}
}
