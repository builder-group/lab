// Writes `fixtures/tap-along.marble.json` and its recording `fixtures/tap-along.wav`: an original 125 BPM marimba
// phrase rendered with the app's own synth and instrument bank to a small mono WAV, imported like the app's audio
// import (the recording starts after the one second lead-in), with Add Suggested Hits applied to the one marble.
// The onsets come from the recording decoded at 48 kHz, as the app decodes it. The platforms are then built the
// way a user would with the assists: a tilted platform, Mirror, then Continue, with Auto place where Continue stops.
// Every placed hit must be on time; hits no piece can serve are left out.
// Usage: tsx scripts/build-tap-fixture.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { SoundBankLoader } from 'spessasynth_core';
import { detectOnsets, encodeMonoWav, IMPORT_RELEASE_LEAD, renderLanes, songEnd, suggestedHitTimes } from '../src/modules/music';
import {
	applyProjectCommands,
	parseProject,
	serializeProject,
	type TLane,
	type TProject,
	type TProjectCommand,
	type TSource
} from '../src/modules/project';
import { autoPlace, continueSuggestions, mirrorPiece } from '../src/modules/simulation/assists';
import { createBareRunProject } from '../src/modules/simulation/fixture-projects';
import { namePiecesInOrder } from '../src/modules/simulation/piece-names';
import { createLinkedPiece, frameBand } from '../src/modules/simulation/placement';
import { createSimulator } from '../src/modules/simulation/simulate';

const LANE = 'lane-1';
const DEGREE = Math.PI / 180;
const SONG_NAME = 'tap-along.wav';
// Small enough to ship: mono at 22.05 kHz, about 43 KB per second
const SAMPLE_RATE = 22050;
// The app decodes recordings at this rate before it looks for onsets
const DECODE_RATE = 48000;
// Same lead-in as the audio import
const IMPORT_START = 1;
// 0.48 s beats are a whole number of the onset detector's 10.7 ms frames at 48 kHz, so the found hits keep an
// even rhythm that Mirror and Continue can repeat
const BPM = 125;
const BEAT = 60 / BPM;
const LEAD = 0.5;
const TAIL = 1.5;
const MARIMBA = 12;
// An original phrase in C major pentatonic, one pitch per beat, and a bass note on each bar's first beat
const MELODY = [72, 76, 79, 76, 74, 72, 69, 72, 76, 79, 81, 79, 76, 74, 69, 72];
const BASS = [48, 45, 53, 43];

// Recording

const bank = SoundBankLoader.fromArrayBuffer(
	new Uint8Array(readFileSync(new URL('../public/audio/marble-instruments.sf2', import.meta.url))).buffer
);
const lane = (id: string, notes: [number, number, number][]): TLane => ({
	id,
	name: id,
	color: '#000000',
	instrument: MARIMBA,
	hits: notes.map(([time, pitch, velocity], index) => ({ id: `${id}-${index}`, time, pitch, velocity }))
});
const duration = LEAD + MELODY.length * BEAT + TAIL;
const rendered = renderLanes(
	[
		lane('melody', MELODY.map((pitch, index) => [LEAD + index * BEAT, pitch, 0.85])),
		lane('bass', BASS.map((pitch, bar) => [LEAD + bar * 4 * BEAT, pitch, 0.6]))
	],
	{ sampleRate: SAMPLE_RATE, duration, bank }
);
const mono = new Float32Array(rendered.left.length);
let peak = 0;
for (let index = 0; index < mono.length; index++) {
	mono[index] = ((rendered.left[index] ?? 0) + (rendered.right[index] ?? 0)) / 2;
	peak = Math.max(peak, Math.abs(mono[index] ?? 0));
}
// Normalized to -1 dBFS, with a short fade at the end
const gain = peak > 0 ? 0.89 / peak : 1;
const fade = Math.round(0.05 * SAMPLE_RATE);
for (let index = 0; index < mono.length; index++) {
	const fadeGain = Math.min(1, (mono.length - 1 - index) / fade);
	mono[index] = (mono[index] ?? 0) * gain * fadeGain;
}
const wav = encodeMonoWav(mono, SAMPLE_RATE);
writeFileSync(new URL(`../fixtures/${SONG_NAME}`, import.meta.url), wav);

// Import and Add Suggested Hits

const onsets = detectOnsets(resample(quantized(mono), SAMPLE_RATE, DECODE_RATE), DECODE_RATE);
const hitTimes = suggestedHitTimes(onsets, IMPORT_START);
console.log(`hits at ${hitTimes.map((time) => time.toFixed(3)).join(' ')}`);
console.log(`recording: ${duration.toFixed(2)} s, ${(wav.length / 1024).toFixed(0)} KB, ${onsets.length} onsets for ${MELODY.length} notes`);
const source: TSource = { id: 'source-1', kind: 'audio', path: `audio/${SONG_NAME}`, name: SONG_NAME, offset: IMPORT_START };
// Build

const simulator = await createSimulator();
const simulate = (current: TProject) => simulator.simulate(current);
const count = hitTimes.length;
let skipped = new Set<number>();
// The import releases the marble half a second before its first hit. When the build leaves hits open, the user
// releases it later, a shorter drop, and builds again; the first build that serves every hit wins
let project: TProject | null = null;
for (const lead of [IMPORT_RELEASE_LEAD, 0.4, 0.3, 0.2]) {
	skipped = new Set<number>();
	const built = build(lead);
	const framed = isInFrame(built, simulate(built));
	console.log(`release ${lead} s before the first hit: ${skipped.size} hits open, ${framed ? 'in frame' : 'out of frame'}`);
	if (project == null || (skipped.size === 0 && framed)) project = built;
	if (skipped.size === 0 && framed) break;
}
if (project == null) throw new Error('Nothing was built');
project = withoutOpenHits(project);
// What a user does after tapping: Fit to Song, so the film ends while the marble is still in the held frame
project = apply(project, [{ type: 'setEnd', end: songEnd(Math.max(...project.music.lanes.flatMap((lane) => lane.hits.map((hit) => hit.time)))) }]);
const result = simulate(project);
simulator.dispose();
const onTime = result.hits.filter((hit) => hit.status === 'onTime').length;
if (onTime !== result.hits.length) throw new Error(`${result.hits.length - onTime} placed hits are not on time`);

const json = serializeProject(namePiecesInOrder(apply(project, [], 0)));
const [isProjectOk, projectErr] = parseProject(json);
if (!isProjectOk) throw projectErr;
writeFileSync(new URL('../fixtures/tap-along.marble.json', import.meta.url), json);
console.log(JSON.stringify({ hits: result.hits.length, onTime, suggested: count }));

function build(lead: number): TProject {
	let current = createBareRunProject({
		id: 'tap-along',
		title: 'Tap Along',
		end: Math.ceil(IMPORT_START + duration),
		marbles: [{ x: 0, y: 0.6, releaseTime: Math.round(((hitTimes[0] ?? IMPORT_START) - lead) * 1e4) / 1e4, hitTimes }]
	});
	// The name a user gives the marble after the import
	for (const item of current.music.lanes) item.name = 'Marimba';
	for (const entity of current.entities) if (entity.components.marble != null) entity.name = 'Marimba';
	current = apply(current, [
		{ type: 'upsertSource', source },
		{ type: 'setTempo', tempo: { bpm: BPM, beatsPerBar: 4 } }
	]);
	current = startZigzag(current, 1, -0.45);
	// Like pressing Continue, or Auto place where Continue does not reach the next open hit
	for (let next = firstOpen(current); next != null; next = firstOpen(current)) {
		const continued = continueSuggestions(current, simulate(current), LANE, {
			simulate,
			idFor: (id) => id.replace('hit', 'piece')
		});
		const reachesNext = continued?.commands.some(
			(command) => command.type === 'upsertEntity' && command.entity.components.hitLink?.hitId === hitId(next)
		);
		if (continued != null && reachesNext === true) {
			current = apply(current, continued.commands);
			continue;
		}
		const placed = place(current, next);
		if (placed === current) skipped.add(next);
		current = placed;
	}
	return current;
}

function startZigzag(current: TProject, index: number, angle: number): TProject {
	// Try a few opening tilts and keep the one Continue carries furthest
	let best: { project: TProject; reach: number } | null = null;
	for (const tilt of [angle, -angle, angle * 0.75, -angle * 0.75, angle * 0.5, -angle * 0.5, angle * 1.25, -angle * 1.25]) {
		const tilted = apply(current, [
			{ type: 'upsertEntity', entity: createLinkedPiece('platform', LANE, hitId(index), tilt, { id: pieceId(index) }) }
		]);
		const [isMirrorOk, , mirrored] = mirrorPiece(tilted, simulate(tilted), LANE, { id: pieceId(index + 1) });
		if (!isMirrorOk) continue;
		const started = apply(tilted, mirrored.commands);
		const result = simulate(started);
		if (result.hits.some((hit) => hit.status === 'blocked') || !isInFrame(started, result)) continue;
		// Hits Continue serves in a row from the one after the mirrored platform
		const continued = new Set(
			(continueSuggestions(started, result, LANE, { simulate })?.commands ?? []).flatMap((command) =>
				command.type === 'upsertEntity' ? (command.entity.components.hitLink?.hitId ?? []) : []
			)
		);
		let reach = 0;
		while (continued.has(hitId(index + 2 + reach))) reach++;
		if (best == null || reach > best.reach) best = { project: started, reach };
	}
	return best?.project ?? place(place(current, index), index + 1);
}

function place(current: TProject, index: number): TProject {
	let reason = '';
	for (const range of [undefined, [-60 * DEGREE, 60 * DEGREE] as [number, number]]) {
		const [isPlacedOk, placedErr, placed] = autoPlace(current, simulate(current), LANE, hitId(index), { simulate, id: pieceId(index), range });
		if (isPlacedOk) return apply(current, placed.commands);
		reason = placedErr.message;
	}
	console.error(`${hitId(index)} stays open: ${reason}`);
	return current;
}

/** Every dot so far lies in the film frame, so the camera can follow the marble */
function isInFrame(current: TProject, result: ReturnType<typeof simulate>): boolean {
	const band = frameBand(current);
	return result.hits.every((hit) => hit.dot == null || Math.abs(hit.dot.x - band.centerX) <= band.halfWidth);
}

/** Index of the earliest hit without a piece that has not been given up on */
function firstOpen(current: TProject): number | null {
	const served = new Set(current.entities.flatMap((entity) => entity.components.hitLink?.hitId ?? []));
	for (let index = 1; index <= count; index++) if (!served.has(hitId(index)) && !skipped.has(index)) return index;
	return null;
}

/** Hits no angle could serve are left out of the lane, so every remaining hit is on time */
function withoutOpenHits(current: TProject): TProject {
	const served = new Set(current.entities.flatMap((entity) => entity.components.hitLink?.hitId ?? []));
	const next = structuredClone(current);
	for (const item of next.music.lanes) item.hits = item.hits.filter((hit) => served.has(hit.id));
	return next;
}

/** The samples as the 16-bit WAV stores them */
function quantized(samples: Float32Array): Float32Array {
	return samples.map((sample) => Math.round(Math.max(-1, Math.min(1, sample)) * 0x7fff) / 0x7fff);
}

function resample(samples: Float32Array, from: number, to: number): Float32Array {
	const ratio = from / to;
	const output = new Float32Array(Math.floor(samples.length / ratio));
	for (let index = 0; index < output.length; index++) {
		const position = index * ratio;
		const base = Math.floor(position);
		const fraction = position - base;
		output[index] = (samples[base] ?? 0) * (1 - fraction) + (samples[Math.min(base + 1, samples.length - 1)] ?? 0) * fraction;
	}
	return output;
}

function hitId(index: number): string {
	return `hit-1-${index}`;
}

function pieceId(index: number): string {
	return `piece-1-${index}`;
}

function apply(current: TProject, commands: TProjectCommand[], revision?: number): TProject {
	const [isAppliedOk, appliedErr, applied] = applyProjectCommands(current, commands);
	if (!isAppliedOk) throw appliedErr;
	if (revision != null) applied.revision = revision;
	return applied;
}
