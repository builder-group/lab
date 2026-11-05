import { BACKING_ID, formatTime, toHitKey } from '@/modules/project';
import type { THitResult } from '@/modules/simulation';
import type { StudioCx, TNoticeAction } from '@/modules/studio';
import { handNotes } from './hand-notes';
import { canMakeBacking, hitReach, moveHitLaterFix, type TReleaseFix } from '@/modules/building';

/**
 * Fixes for an unreachable hit, in the notice N shows and the Played By section of the hit inspector: the
 * release change that fixes it when one does, Move Hit Later for a tapped hit that is too soon, then Make
 * Backing, or Delete Hit in a project without a song, where a Backing note could not be seen again
 */
export function unreachableActions(studio: StudioCx, hit: THitResult, fix: TReleaseFix | null): TNoticeAction[] {
	const project = studio.project;
	if (project == null) return [];
	const marble = (): string => studio.project?.music.lanes.find((lane) => lane.id === hit.marbleId)?.name ?? 'The marble';
	const actions: TNoticeAction[] = [];
	// Fixed from the inspector, the notice that explained the problem goes too
	if (fix != null) {
		actions.push({
			label: fix.label,
			run: () => {
				studio.dismissNotice();
				if (!studio.execute(fix.commands)) return;
				const command = fix.commands[0];
				const time = command?.type === 'setComponent' && command.component.name === 'release' ? command.component.value.time : null;
				if (time != null) studio.notifyEdit(`${marble()} now starts at ${formatTime(time)}`);
			}
		});
	}
	const later = fix == null ? moveHitLaterFix(project, hit, hitReach(project, studio.simulation.$result.get(), hit)) : null;
	if (later != null) {
		actions.push({
			label: later.label,
			title: `Move the hit to ${formatTime(later.time)}, the first moment ${marble()} can strike a platform`,
			run: () => {
				studio.dismissNotice();
				if (!studio.execute(later.commands)) return;
				studio.$selection.set([toHitKey(hit.marbleId, hit.hitId)]);
				studio.notifyEdit(`Hit moved to ${formatTime(later.time)}`);
			}
		});
	}
	if (canMakeBacking(project)) {
		actions.push({
			label: 'Make Backing',
			title: 'Heard in the film, no platform needed (0)',
			run: () => {
				studio.dismissNotice();
				handNotes(studio, [toHitKey(hit.marbleId, hit.hitId)], BACKING_ID);
			}
		});
	} else {
		actions.push({
			label: 'Delete Hit',
			title: 'Remove this hit from the marble',
			run: () => {
				studio.dismissNotice();
				if (!studio.execute([{ type: 'removeHits', marbleId: hit.marbleId, hitIds: [hit.hitId] }])) return;
				studio.$selection.set([]);
				studio.notifyEdit('Hit deleted');
			}
		});
	}
	return actions;
}
