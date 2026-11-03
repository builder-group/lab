// General MIDI programs kept in `public/audio/marble-instruments.sf2`, built by `pnpm soundbank:build`
export const instruments: TInstrument[] = [
	{ program: 9, name: 'Glockenspiel' },
	{ program: 12, name: 'Marimba' },
	{ program: 13, name: 'Xylophone' },
	{ program: 11, name: 'Vibraphone' },
	{ program: 8, name: 'Celesta' },
	{ program: 10, name: 'Music Box' },
	{ program: 112, name: 'Tinkle Bell' },
	{ program: 14, name: 'Tubular Bells' },
	{ program: 108, name: 'Kalimba' },
	{ program: 114, name: 'Steel Drums' },
	{ program: 46, name: 'Orchestral Harp' },
	{ program: 24, name: 'Nylon Guitar' },
	{ program: 0, name: 'Acoustic Grand Piano' }
];

export interface TInstrument {
	program: number;
	name: string;
}
