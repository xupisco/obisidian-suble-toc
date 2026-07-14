export interface HeadingItem {
	/** Heading level, 1-6. */
	level: number;
	/** Plain-text content of the heading. */
	text: string;
	/** 0-based line number in the document. */
	line: number;
}

export interface TaskItem {
	/** Displayed text of the task (list/checkbox markup stripped). */
	text: string;
	/** 0-based line number in the document. */
	line: number;
}

/** A navigable target: enough for scrollToTarget to scroll/flash it. */
export type NavTarget = { text: string; line: number };

export type TocSide = "right" | "left";
export type TocTrigger = "hover" | "click";
export type TocShow = "headings" | "tasks" | "both";

export interface SubtleTocSettings {
	/** Which content to surface: headings, open tasks, or both. */
	show: TocShow;
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
	/** Show a clickable checkbox on each task row (clicking completes the task). */
	showTaskCheckboxes: boolean;
}

export const DEFAULT_SETTINGS: SubtleTocSettings = {
	show: "both",
	showMinimap: true,
	side: "right",
	openTrigger: "hover",
	minLevel: 1,
	maxLevel: 6,
	smoothScroll: true,
	showTaskCheckboxes: false,
};
