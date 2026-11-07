// Songs the measuring scripts build that have no fixture of their own
import { createImportCommands } from '../src/modules/music';
import { applyProjectCommands, createProject, type TProject } from '../src/modules/project';

/** Ode to Joy, public domain, tuned on nothing: beats of a 0.4 s quarter note, with its dotted quarters, eighths and half notes */
const ODE_TO_JOY: [number, number][] = [64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64].map((pitch): [number, number] => [pitch, 1]).concat([[64, 1.5], [62, 0.5], [62, 2]], [64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64].map((pitch): [number, number] => [pitch, 1]), [[62, 1.5], [60, 0.5], [60, 2]], [[62, 1], [62, 1], [64, 1], [60, 1], [62, 1], [64, 0.5], [65, 0.5], [64, 1], [60, 1], [62, 1], [64, 0.5], [65, 0.5], [64, 1], [62, 1], [60, 1], [62, 1], [55, 2]]);

/** Ode to Joy as an imported song: one marble playing the melody */
export function odeToJoy(): TProject {
	const project = createProject({ id: 'ode-to-joy', title: 'Ode to Joy' });
	let beat = 0;
	const notes = ODE_TO_JOY.map(([midi, beats], index) => {
		const note = { time: 1 + beat * 0.4, duration: beats * 0.4, midi, velocity: 0.8, id: `note-${index}` };
		beat += beats;
		return note;
	});
	const [isOk, error, imported] = applyProjectCommands(project, createImportCommands(project, { marbles: [notes] as never }));
	if (!isOk) throw error;
	return imported;
}
