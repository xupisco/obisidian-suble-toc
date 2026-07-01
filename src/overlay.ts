import { MarkdownView } from "obsidian";
import { HeadingItem } from "./types";
import { getActiveHeadingIndex, getScroller, scrollToHeading } from "./dom";
import type SubtleTocPlugin from "./main";

const CLOSE_DELAY = 160;

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
	private minimapEl!: HTMLElement;
	private popoverEl!: HTMLElement;
	private listEl!: HTMLElement;

	private headings: HeadingItem[] = [];
	private dashEls: HTMLElement[] = [];
	private itemEls: HTMLElement[] = [];
	private activeIndex = -1;
	private isOpen = false;

	private scroller: HTMLElement | null = null;
	private closeTimer: number | null = null;
	private rafPending = false;
	private readonly onScroll = () => this.scheduleActiveUpdate();

	constructor(plugin: SubtleTocPlugin, view: MarkdownView) {
		this.plugin = plugin;
		this.view = view;
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

		this.minimapEl = this.groupEl.createDiv({ cls: "subtle-toc-minimap" });
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
		this.rootEl?.remove();
		this.view.contentEl.removeClass("subtle-toc-host");
	}

	// ---- DOM construction --------------------------------------------------

	private buildPopoverChrome(): void {
		const body = this.popoverEl.createDiv({ cls: "subtle-toc-body" });
		this.listEl = body.createDiv({ cls: "subtle-toc-list" });
	}

	private bindGroupEvents(): void {
		const trigger = this.settings.openTrigger;

		this.minimapEl.addEventListener("mouseenter", () => {
			if (trigger === "hover") this.open();
		});
		this.minimapEl.addEventListener("click", () => {
			if (trigger === "click") this.toggle();
		});
		this.minimapEl.addEventListener("mouseleave", () => this.scheduleClose());

		this.popoverEl.addEventListener("mouseenter", () => this.cancelClose());
		this.popoverEl.addEventListener("mouseleave", () => this.scheduleClose());
	}

	private applySide(): void {
		this.rootEl.toggleClass("is-left", this.settings.side === "left");
		this.rootEl.toggleClass("is-right", this.settings.side === "right");
	}

	// ---- data refresh ------------------------------------------------------

	/** Re-read headings from the metadata cache and rebuild everything. */
	refresh(): void {
		this.applySide();
		this.applyPixelSnap();
		this.rebindScroller();

		const file = this.view.file;
		const cache = file ? this.plugin.app.metadataCache.getFileCache(file) : null;
		const all = cache?.headings ?? [];

		const { minLevel, maxLevel } = this.settings;
		this.headings = all
			.filter((h) => h.level >= minLevel && h.level <= maxLevel)
			.map((h) => ({ level: h.level, text: h.heading, line: h.position.start.line }));

		const hasHeadings = this.headings.length > 0;
		this.rootEl.toggleClass("is-empty", !hasHeadings);
		this.minimapEl.toggleClass("is-hidden", !this.settings.showMinimap || !hasHeadings);

		this.buildMinimap();
		this.buildList();
		this.activeIndex = -1;
		this.updateActive();

		if (!hasHeadings) this.close();
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
			item.createSpan({ cls: "subtle-toc-item-text", text: h.text || "(untitled)" });
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
				if (this.isOpen) {
					item.scrollIntoView({ block: "nearest" });
				}
			}
		}
	}

	// ---- interactions ------------------------------------------------------

	private navigate(index: number): void {
		const heading = this.headings[index];
		if (!heading) return;
		scrollToHeading(this.view, heading, this.settings.smoothScroll);
		// optimistic highlight; the scroll listener will confirm/correct
		this.setActive(index);
	}

	/** Briefly preview an item from the minimap without navigating. */
	private peek(index: number): void {
		if (this.settings.openTrigger === "hover") this.open();
		this.itemEls.forEach((el, i) => el.toggleClass("is-peek", i === index));
	}

	open(): void {
		this.cancelClose();
		if (this.isOpen || this.headings.length === 0) return;
		this.isOpen = true;
		this.rootEl.addClass("is-open");
		if (this.activeIndex >= 0) {
			this.itemEls[this.activeIndex]?.scrollIntoView({ block: "nearest" });
		}
	}

	close(): void {
		if (!this.isOpen) return;
		this.isOpen = false;
		this.rootEl.removeClass("is-open");
		this.itemEls.forEach((el) => el.removeClass("is-peek"));
	}

	toggle(): void {
		if (this.isOpen) this.close();
		else this.open();
	}

	private scheduleClose(): void {
		this.cancelClose();
		this.closeTimer = window.setTimeout(() => this.close(), CLOSE_DELAY);
	}

	private cancelClose(): void {
		if (this.closeTimer !== null) {
			window.clearTimeout(this.closeTimer);
			this.closeTimer = null;
		}
	}
}
