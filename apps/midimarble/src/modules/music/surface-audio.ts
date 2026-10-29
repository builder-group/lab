import type { TPerformance, TProject, TSurfaceContact } from '../project';

/** Mixes unpitched rolling texture and small rail clinks from simulated contacts, independently of MIDI. */
export function mixSurfaceAudio(
	left: Float32Array,
	right: Float32Array,
	project: TProject,
	performance: TPerformance | null,
	sampleRate: number
): void {
	const music = project.audio?.musicVolume ?? 0.9;
	const surface = project.audio?.surfaceVolume ?? 0.45;
	for (let index = 0; index < left.length; index++) {
		left[index] = (left[index] ?? 0) * music;
		right[index] = (right[index] ?? 0) * music;
	}
	if (project.audio?.surfacesEnabled === false || !performance || surface === 0) return;
	const objects = new Map(performance.objects.map((object) => [object.id, object]));
	for (const contact of joinRollingContacts(performance.surfaceContacts ?? [])) {
		const object = objects.get(contact.objectId);
		if (!object || object.disabled || contact.end <= contact.start) continue;
		const start = Math.max(0, Math.floor(contact.start * sampleRate));
		const end = Math.min(left.length, Math.ceil(contact.end * sampleRate));
		const speed = Math.min(3, Math.max(0, contact.speed));
		if (speed < 0.02) continue;
		let seed =
			hash(`${contact.objectId}:${contact.marbleId ?? 'main'}`) ^
			Math.floor(contact.start * sampleRate);
		let low = 0;
		let body = 0;
		let fine = 0;
		let fineSmooth = 0;
		let grain = 0;
		let grainTarget = 0;
		const lowRate = filterRate(140, sampleRate);
		const bodyRate = filterRate(420, sampleRate);
		const fineRate = filterRate(1300, sampleRate);
		const grainRate = filterRate(35, sampleRate);
		const wire = makeResonator(1180, 2.5, sampleRate);
		const glass = makeResonator(2830, 3, sampleRate);
		const pan = Math.max(
			-0.5,
			Math.min(0.5, (object.position[0] - project.launch.position[0]) / 12)
		);
		const gain = surface * 0.045 * Math.sqrt((speed * sampleRate) / 44100);
		let nextTick = start;
		for (let index = start; index < end; index++) {
			seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
			const noise = (seed >>> 0) / 2147483648 - 1;
			low += lowRate * (noise - low);
			body += bodyRate * (noise - body);
			fine += fineRate * (noise - fine);
			fineSmooth += fineRate * (fine - fineSmooth);
			if (index >= nextTick) {
				grainTarget = Math.abs(noise);
				nextTick =
					index +
					Math.round((sampleRate * (0.025 + 0.025 * Math.abs(noise))) / Math.max(0.45, speed));
			}
			grain += grainRate * (grainTarget - grain);
			const envelope =
				smoothEdge((index - start) / (sampleRate * 0.025)) *
				smoothEdge((end - index - 1) / (sampleRate * 0.04));
			// Filter every excitation; raw white noise and abrupt grain resets sound like static.
			const texture = (body - low) * 1.5 + (fineSmooth - body) * (0.3 + grain * 0.25);
			const sheen = wire(noise) * 0.12 + glass(noise) * 0.035;
			const value = (texture + sheen) * gain * envelope;
			left[index] = (left[index] ?? 0) + value * (1 - pan);
			right[index] = (right[index] ?? 0) + value * (1 + pan);
		}
	}
	// Inharmonic, short resonances give entry a glass-on-metal clink rather than a MIDI note.
	const lastEntry = new Map<string, number>();
	for (const impact of performance.impacts) {
		const object = objects.get(impact.objectId);
		if (!object || object.disabled || object.kind !== 'rail') continue;
		const previous = lastEntry.get(impact.objectId) ?? -Infinity;
		if (impact.time - previous < 0.06) continue;
		lastEntry.set(impact.objectId, impact.time);
		const start = Math.max(0, Math.floor(impact.time * sampleRate));
		const count = Math.round(sampleRate * 0.075);
		const metal = makeResonator(1730, 12, sampleRate);
		const glass = makeResonator(3910, 9, sampleRate);
		const gain = surface * 0.3 * Math.max(0, Math.min(1, impact.strength));
		for (let i = 0; i < count && start + i < left.length; i++) {
			const excitation =
				i < sampleRate * 0.001 ? Math.sin((Math.PI * i) / (sampleRate * 0.001)) : 0;
			const value = (metal(excitation) + glass(excitation) * 0.3) * gain;
			left[start + i] = (left[start + i] ?? 0) + value;
			right[start + i] = (right[start + i] ?? 0) + value;
		}
	}
	for (let index = 0; index < left.length; index++) {
		left[index] = softLimit(left[index] ?? 0);
		right[index] = softLimit(right[index] ?? 0);
	}
}
function hash(text: string): number {
	let value = 2166136261;
	for (let index = 0; index < text.length; index++)
		value = Math.imul(value ^ text.charCodeAt(index), 16777619);
	return value | 0;
}
function softLimit(value: number): number {
	const magnitude = Math.abs(value);
	return magnitude < 0.95
		? value
		: Math.sign(value) * (0.95 + 0.05 * Math.tanh((magnitude - 0.95) / 0.05));
}

function filterRate(frequency: number, sampleRate: number): number {
	return 1 - Math.exp((-2 * Math.PI * frequency) / sampleRate);
}

function smoothEdge(value: number): number {
	const clamped = Math.max(0, Math.min(1, value));
	return clamped * clamped * (3 - 2 * clamped);
}

/** A damped band-pass resonance with unity peak gain. */
function makeResonator(
	frequency: number,
	quality: number,
	sampleRate: number
): (input: number) => number {
	const omega = (2 * Math.PI * Math.min(frequency, sampleRate * 0.4)) / sampleRate;
	const alpha = Math.sin(omega) / (2 * quality);
	const b = alpha / (1 + alpha);
	const a1 = (-2 * Math.cos(omega)) / (1 + alpha);
	const a2 = (1 - alpha) / (1 + alpha);
	let x1 = 0;
	let x2 = 0;
	let y1 = 0;
	let y2 = 0;
	return (input) => {
		const output = b * (input - x2) - a1 * y1 - a2 * y2;
		x2 = x1;
		x1 = input;
		y2 = y1;
		y1 = output;
		return output;
	};
}

function joinRollingContacts(contacts: readonly TSurfaceContact[]): TSurfaceContact[] {
	const groups = new Map<string, TSurfaceContact[]>();
	for (const contact of contacts) {
		const key = `${contact.marbleId ?? 'main'}:${contact.objectId}`;
		const group = groups.get(key) ?? [];
		group.push(contact);
		groups.set(key, group);
	}
	const joined: TSurfaceContact[] = [];
	for (const group of groups.values()) {
		let previous: TSurfaceContact | undefined;
		for (const contact of group.sort((a, b) => a.start - b.start)) {
			// Tiny physical bounces should not repeatedly restart the noise and its attack envelope.
			if (previous != null && contact.start - previous.end <= 0.035) {
				const before = previous.end - previous.start;
				const after = contact.end - contact.start;
				previous.speed =
					(previous.speed * before + contact.speed * after) / Math.max(0.001, before + after);
				previous.end = Math.max(previous.end, contact.end);
				continue;
			}
			previous = { ...contact };
			joined.push(previous);
		}
	}
	return joined;
}
