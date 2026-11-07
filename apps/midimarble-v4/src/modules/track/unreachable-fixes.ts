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
	const marble = (): string => studio.project?.marbles.find((marble) => marble.id === hit.marbleId)?.name ?? 'The marble';
	const actions: TNoticeAction[] = [];
	const reach = hitReach(project, studio.simulation.$result.get(), hit);
	const restingOn = reach.kind === 'resting' ? project.track.pieces.find((piece) => piece.id === reach.pieceId) : undefined;
	if (restingOn != null) {
		actions.push({
			label: `Fix ${restingOn.name}`,
			title: `Solve ${restingOn.name} again, so the marble goes on from it`,
			run: () => {
				studio.dismissNotice();
				void studio.assist.fix(restingOn.id);
			}
		});
	}
	// Fixed from the inspector, the notice that explained the problem goes too
	if (fix != null) {
		actions.push({
			label: fix.label,
			run: () => {
				studio.dismissNotice();
				if (!studio.execute(fix.commands)) return;
				const command = fix.commands[0];
				const time = command?.type === 'updateMarble' ? (command.patch.start?.time ?? null) : null;
				if (time != null) studio.notifyEdit(`${marble()} now starts at ${formatTime(time)}`);
			}
		});
	}
	const later = fix == null ? moveHitLaterFix(project, hit, reach) : null;
	if (later != null) {
		actions.push({
			label: later.label,
			title: `Move the note to ${formatTime(later.time)}, the first moment ${marble()} can strike a platform`,
			run: () => {
				studio.dismissNotice();
				if (!studio.execute(later.commands)) return;
				studio.$selection.set([toHitKey(hit.marbleId, hit.hitId)]);
				studio.notifyEdit(`Note moved to ${formatTime(later.time)}`);
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
			label: 'Delete Note',
			title: 'Remove this note from the marble',
			run: () => {
				studio.dismissNotice();
				if (!studio.execute([{ type: 'removeHits', marbleId: hit.marbleId, hitIds: [hit.hitId] }])) return;
				studio.$selection.set([]);
				studio.notifyEdit('Note deleted');
			}
		});
	}
	return actions;
}
