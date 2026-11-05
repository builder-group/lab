import type { TProject } from '@/modules/project';
import { parseTime } from '@/modules/project';

/** Anything shown over a stretch of the film: a title, a decoration */
type TTimed = object & { in?: number; out?: number };

/** When a title shows: its In and Out times with the defaults filled in, the start and the end of the film */
export function titleSpan(text: TTimed, end: number): { start: number; end: number } {
	return { start: Math.max(0, text.in ?? 0), end: Math.min(end, text.out ?? end) };
}

/**
 * The title with a typed In or Out time (`m:ss.cc`, `m:ss` or seconds), or null when the text is not a time or would
 * end the title before it starts. A time at the start or the end of the film removes the field, so the title keeps
 * following the film's length.
 */
export function withTitleTime<GTimed extends TTimed>(text: GTimed, field: 'in' | 'out', typed: string, filmEnd: number): GTimed | null {
	const parsed = parseTime(typed);
	if (parsed == null) return null;
	const time = Math.round(Math.min(Math.max(parsed, 0), filmEnd) * 100) / 100;
	const span = titleSpan(text, filmEnd);
	if (field === 'in' ? time >= span.end : time <= span.start) return null;
	const { in: start, out, ...rest } = text;
	const next = { ...rest } as GTimed;
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

/**
 * The song's name as a Song Name title reads it: the song file's name as words in Title Case ("jingle-bells.mid"
 * reads "Jingle Bells"), else the project's title unless it is still "Untitled", else null
 */
export function songDisplayName(project: {
	title: string;
	music: { sources: readonly { name: string }[] };
}): string | null {
	const file = project.music.sources[0]?.name;
	const fromFile = file != null ? prettifyName(file.replace(/\.[^./]+$/, '')) : '';
	if (fromFile !== '') return fromFile;
	const title = project.title.trim();
	return title !== '' && !/^untitled(\s+\d+)?$/i.test(title) ? title : null;
}

/** File name words in Title Case: dashes and underscores become spaces, lower-case words get a capital, "ABBA" stays */
function prettifyName(name: string): string {
	return name
		.replace(/[-_]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.split(' ')
		.map((word) =>
			word === word.toLowerCase() ? word.charAt(0).toUpperCase() + word.slice(1) : word
		)
		.join(' ');
}
