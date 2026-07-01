export interface HeadingItem {
	/** Heading level, 1-6. */
	level: number;
	/** Plain-text content of the heading. */
	text: string;
	/** 0-based line number in the document. */
	line: number;
}

export type TocSide = "right" | "left";
export type TocTrigger = "hover" | "click";

export interface SubtleTocSettings {
	/** Show the dashed minimap on the edge of the note. */
	showMinimap: boolean;
	/** Which edge of the note to dock the minimap / popover on. */
	side: TocSide;
	/** Open the popover on hover or only on click. */
	openTrigger: TocTrigger;
	/** Lowest heading level to include (1 = H1). */
	minLevel: number;
	/** Highest heading level to include (6 = H6). */
	maxLevel: number;
	/** Smoothly animate the scroll when navigating to a heading. */
	smoothScroll: boolean;
}

export const DEFAULT_SETTINGS: SubtleTocSettings = {
	showMinimap: true,
	side: "right",
	openTrigger: "hover",
	minLevel: 1,
	maxLevel: 6,
	smoothScroll: true,
};
