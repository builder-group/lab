import type { TComponents, TProject } from '@/modules/project';
import { parseTime } from '@/modules/studio/timeline/parse-time';

type TWallText = NonNullable<TComponents['wallText']>;

/** When a title shows: its In and Out times with the defaults filled in, the start and the end of the film */
export function titleSpan(text: TWallText, end: number): { start: number; end: number } {
	return { start: Math.max(0, text.in ?? 0), end: Math.min(end, text.out ?? end) };
}

/**
 * The title with a typed In or Out time (`m:ss.cc`, `m:ss` or seconds), or null when the text is not a time or would
 * end the title before it starts. A time at the start or the end of the film removes the field, so the title keeps
 * following the film's length.
 */
export function withTitleTime(text: TWallText, field: 'in' | 'out', typed: string, filmEnd: number): TWallText | null {
	const parsed = parseTime(typed);
	if (parsed == null) return null;
	const time = Math.round(Math.min(Math.max(parsed, 0), filmEnd) * 100) / 100;
	const span = titleSpan(text, filmEnd);
	if (field === 'in' ? time >= span.end : time <= span.start) return null;
	const { in: start, out, ...rest } = text;
	const next: TWallText = { ...rest };
	const nextIn = field === 'in' ? time : start;
	const nextOut = field === 'out' ? time : out;
	if (nextIn != null && nextIn > 0) next.in = nextIn;
	if (nextOut != null && nextOut < filmEnd) next.out = nextOut;
	return next;
}

/** Titles as clips for the Titles track: their entity, text and span, by start time */
export function titleClips(project: TProject): { entityId: string; text: string; start: number; end: number }[] {
	return project.entities
		.flatMap((entity) => {
			const text = entity.components.wallText;
			return text == null ? [] : [{ entityId: entity.id, text: text.text, ...titleSpan(text, project.end) }];
		})
		.sort((a, b) => a.start - b.start);
}
