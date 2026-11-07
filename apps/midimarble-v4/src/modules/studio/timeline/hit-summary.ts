import type { TProblemSummary } from '@/modules/building';

/**
 * The summary's words, counting built notes so open ones never read as failures: "11 built · all on time",
 * "2 need attention · 1 other problem", "Nothing built yet"
 */
export function summaryWords(summary: Pick<TProblemSummary, 'hitProblems' | 'otherProblems' | 'onTime' | 'total'>, built: number): string {
	const { hitProblems, otherProblems, onTime, total } = summary;
	const hits = hitProblems > 0 ? `${hitProblems} need attention` : built > 0 ? `${built} built · ${onTime >= built ? 'all' : onTime} on time` : total > 0 ? 'Nothing built yet' : '';
	const others = otherProblems > 0 ? `${otherProblems} ${hits === '' ? '' : 'other '}${otherProblems === 1 ? 'problem' : 'problems'}` : '';
	return [hits, others].filter(Boolean).join(' · ') || 'No notes yet';
}
