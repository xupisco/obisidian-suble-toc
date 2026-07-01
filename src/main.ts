import { MarkdownView, Plugin, TFile } from "obsidian";
import { DEFAULT_SETTINGS, SubtleTocSettings } from "./types";
import { TocOverlay } from "./overlay";
import { SubtleTocSettingTab } from "./settings";

export default class SubtleTocPlugin extends Plugin {
	settings!: SubtleTocSettings;
	private overlay: TocOverlay | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.addSettingTab(new SubtleTocSettingTab(this.app, this));

		this.registerEvent(
			this.app.workspace.on("active-leaf-change", () => this.sync()),
		);
		this.registerEvent(
			this.app.workspace.on("layout-change", () => this.sync()),
		);
		this.registerEvent(
			this.app.metadataCache.on("changed", (file: TFile) => {
				if (this.overlay && this.overlay.view.file === file) {
					this.overlay.refresh();
				}
			}),
		);

		this.addCommand({
			id: "toggle-toc-popover",
			name: "Toggle TOC popover",
			callback: () => this.overlay?.toggle(),
		});

		this.app.workspace.onLayoutReady(() => this.sync());
	}

	onunload(): void {
		this.teardownOverlay();
	}

	/** Ensure exactly one overlay exists, bound to the active markdown view. */
	private sync(): void {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);

		if (this.overlay && this.overlay.view !== view) {
			this.teardownOverlay();
		}

		if (!view) return;

		if (!this.overlay) {
			this.overlay = new TocOverlay(this, view);
			this.overlay.mount();
		}
		this.overlay.refresh();
	}

	private teardownOverlay(): void {
		this.overlay?.unmount();
		this.overlay = null;
	}

	/** Rebuild the overlay from scratch so option changes take full effect. */
	private rebuildOverlay(): void {
		this.teardownOverlay();
		this.sync();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Persist settings and re-apply them (used by settings that change layout). */
	async saveAndRefresh(): Promise<void> {
		await this.saveSettings();
		this.rebuildOverlay();
	}
}
