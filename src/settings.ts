import { App, PluginSettingTab, Setting } from "obsidian";
import { TocDefaultTab, TocShow } from "./types";
import type SubtleTocPlugin from "./main";

/** Only where the picker starts while the color is unset — a neutral gray, since
 *  the theme's own value can be a translucent rgba() the picker can't show. */
const FALLBACK_ACTIVE_TAB_BG = "#7a7a7a";

export class SubtleTocSettingTab extends PluginSettingTab {
	plugin: SubtleTocPlugin;

	constructor(app: App, plugin: SubtleTocPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName("Show")
			.setDesc("Which content to surface: headings, open tasks, or both.")
			.addDropdown((d) =>
				d
					.addOption("both", "Both")
					.addOption("headings", "Headings")
					.addOption("tasks", "Tasks")
					.setValue(this.plugin.settings.show)
					.onChange(async (v) => {
						this.plugin.settings.show = v as TocShow;
						await this.plugin.saveAndRefresh();
					}),
			);

		new Setting(containerEl)
			.setName("Default tab")
			.setDesc(
				"Tab shown first in the popover. After that the last-used tab is kept; it always falls back to the tab that has content.",
			)
			.addDropdown((d) =>
				d
					.addOption("headings", "Headings")
					.addOption("tasks", "Tasks")
					.setValue(this.plugin.settings.defaultTab)
					.onChange(async (v) => {
						this.plugin.settings.defaultTab = v as TocDefaultTab;
						await this.plugin.saveAndRefresh();
					}),
			);

		new Setting(containerEl)
			.setName("Show task checkboxes")
			.setDesc("Add a checkbox to each task in the popover; clicking it completes the task in the note.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showTaskCheckboxes).onChange(async (v) => {
					this.plugin.settings.showTaskCheckboxes = v;
					await this.plugin.saveAndRefresh();
				}),
			);

		new Setting(containerEl)
			.setName("Show multiple lines")
			.setDesc(
				"Wrap long headings and tasks over as many lines as they need. When off, each row is cut to a single line and hovering it shows the full text.",
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.multiLine).onChange(async (v) => {
					this.plugin.settings.multiLine = v;
					await this.plugin.saveAndRefresh();
				}),
			);

		new Setting(containerEl)
			.setName("Active tab color")
			.setDesc("Background of the selected tab in the popover. Reset to follow the theme.")
			.addColorPicker((c) =>
				c
					.setValue(this.plugin.settings.activeTabBgColor || FALLBACK_ACTIVE_TAB_BG)
					.onChange(async (v) => {
						this.plugin.settings.activeTabBgColor = v;
						await this.plugin.saveAndRefresh();
					}),
			)
			.addExtraButton((b) =>
				b
					.setIcon("rotate-ccw")
					.setTooltip("Use the theme's color")
					.onClick(async () => {
						this.plugin.settings.activeTabBgColor = "";
						await this.plugin.saveAndRefresh();
						this.display();
					}),
			);

		new Setting(containerEl)
			.setName("Show minimap")
			.setDesc("Show the dashed markers along the edge of the note.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showMinimap).onChange(async (v) => {
					this.plugin.settings.showMinimap = v;
					await this.plugin.saveAndRefresh();
				}),
			);

		new Setting(containerEl)
			.setName("Show tasks in minimap")
			.setDesc(
				"Show the open-task count on the edge of the note, next to the dashed markers. Notes with tasks but no headings always show it, so the TOC stays reachable.",
			)
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showTasksInMinimap).onChange(async (v) => {
					this.plugin.settings.showTasksInMinimap = v;
					await this.plugin.saveAndRefresh();
				}),
			);

		new Setting(containerEl)
			.setName("Side")
			.setDesc("Which edge of the note to dock the TOC on.")
			.addDropdown((d) =>
				d
					.addOption("right", "Right")
					.addOption("left", "Left")
					.setValue(this.plugin.settings.side)
					.onChange(async (v) => {
						this.plugin.settings.side = v as "right" | "left";
						await this.plugin.saveAndRefresh();
					}),
			);

		new Setting(containerEl)
			.setName("Open the popover on")
			.setDesc("Hover over the minimap, or require a click to open.")
			.addDropdown((d) =>
				d
					.addOption("hover", "Hover")
					.addOption("click", "Click")
					.setValue(this.plugin.settings.openTrigger)
					.onChange(async (v) => {
						this.plugin.settings.openTrigger = v as "hover" | "click";
						await this.plugin.saveAndRefresh();
					}),
			);

		new Setting(containerEl)
			.setName("Close delay")
			.setDesc(
				"How long the popover waits before closing after the mouse leaves it, in milliseconds. Raise it if it closes on you while switching tabs.",
			)
			.addSlider((s) =>
				s
					.setLimits(0, 1000, 20)
					.setValue(this.plugin.settings.closeDelay)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.closeDelay = v;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName("Smooth scroll")
			.setDesc("Animate the scroll when navigating to a heading.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.smoothScroll).onChange(async (v) => {
					this.plugin.settings.smoothScroll = v;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl)
			.setName("Minimum heading level")
			.setDesc("Lowest heading level to show (1 = H1).")
			.addSlider((s) =>
				s
					.setLimits(1, 6, 1)
					.setValue(this.plugin.settings.minLevel)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.minLevel = v;
						if (v > this.plugin.settings.maxLevel) {
							this.plugin.settings.maxLevel = v;
						}
						await this.plugin.saveAndRefresh();
					}),
			);

		new Setting(containerEl)
			.setName("Maximum heading level")
			.setDesc("Highest heading level to show (6 = H6).")
			.addSlider((s) =>
				s
					.setLimits(1, 6, 1)
					.setValue(this.plugin.settings.maxLevel)
					.setDynamicTooltip()
					.onChange(async (v) => {
						this.plugin.settings.maxLevel = v;
						if (v < this.plugin.settings.minLevel) {
							this.plugin.settings.minLevel = v;
						}
						await this.plugin.saveAndRefresh();
					}),
			);
	}
}
