import { App, PluginSettingTab, Setting } from "obsidian";
import type SubtleTocPlugin from "./main";

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
			.setName("Show minimap")
			.setDesc("Show the dashed markers along the edge of the note.")
			.addToggle((t) =>
				t.setValue(this.plugin.settings.showMinimap).onChange(async (v) => {
					this.plugin.settings.showMinimap = v;
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
