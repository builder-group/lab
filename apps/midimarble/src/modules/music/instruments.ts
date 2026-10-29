export function instrumentName(program: number): string {
	return instrumentOptions[program]?.label ?? `MIDI instrument ${program + 1}`;
}

export interface TInstrumentOption {
	value: number;
	label: string;
	family?: string;
}

// General MIDI families contain eight consecutive, zero-based program numbers.
const INSTRUMENT_FAMILIES = [
	{
		label: 'Piano',
		names: [
			'Grand piano',
			'Bright acoustic piano',
			'Electric grand piano',
			'Honky-tonk piano',
			'Electric piano 1',
			'Electric piano 2',
			'Harpsichord',
			'Clavi'
		]
	},
	{
		label: 'Chromatic percussion',
		names: [
			'Celesta',
			'Glockenspiel',
			'Music box',
			'Vibraphone',
			'Marimba',
			'Xylophone',
			'Tubular bells',
			'Dulcimer'
		]
	},
	{
		label: 'Organ',
		names: [
			'Drawbar organ',
			'Percussive organ',
			'Rock organ',
			'Church organ',
			'Reed organ',
			'Accordion',
			'Harmonica',
			'Tango accordion'
		]
	},
	{
		label: 'Guitar',
		names: [
			'Nylon guitar',
			'Steel-string guitar',
			'Jazz electric guitar',
			'Clean electric guitar',
			'Muted electric guitar',
			'Overdriven guitar',
			'Distortion guitar',
			'Guitar harmonics'
		]
	},
	{
		label: 'Bass',
		names: [
			'Acoustic bass',
			'Fingered electric bass',
			'Picked electric bass',
			'Fretless bass',
			'Slap bass 1',
			'Slap bass 2',
			'Synth bass 1',
			'Synth bass 2'
		]
	},
	{
		label: 'Strings',
		names: [
			'Violin',
			'Viola',
			'Cello',
			'Contrabass',
			'Tremolo strings',
			'Pizzicato strings',
			'Orchestral harp',
			'Timpani'
		]
	},
	{
		label: 'Ensemble',
		names: [
			'String ensemble 1',
			'String ensemble 2',
			'Synth strings 1',
			'Synth strings 2',
			'Choir aahs',
			'Voice oohs',
			'Synth voice',
			'Orchestra hit'
		]
	},
	{
		label: 'Brass',
		names: [
			'Trumpet',
			'Trombone',
			'Tuba',
			'Muted trumpet',
			'French horn',
			'Brass section',
			'Synth brass 1',
			'Synth brass 2'
		]
	},
	{
		label: 'Reed',
		names: [
			'Soprano sax',
			'Alto sax',
			'Tenor sax',
			'Baritone sax',
			'Oboe',
			'English horn',
			'Bassoon',
			'Clarinet'
		]
	},
	{
		label: 'Pipe',
		names: [
			'Piccolo',
			'Flute',
			'Recorder',
			'Pan flute',
			'Blown bottle',
			'Shakuhachi',
			'Whistle',
			'Ocarina'
		]
	},
	{
		label: 'Synth lead',
		names: [
			'Square lead',
			'Sawtooth lead',
			'Calliope lead',
			'Chiff lead',
			'Charang lead',
			'Voice lead',
			'Fifths lead',
			'Bass + lead'
		]
	},
	{
		label: 'Synth pad',
		names: [
			'New age pad',
			'Warm pad',
			'Polysynth pad',
			'Choir pad',
			'Bowed pad',
			'Metallic pad',
			'Halo pad',
			'Sweep pad'
		]
	},
	{
		label: 'Synth effects',
		names: [
			'Rain',
			'Soundtrack',
			'Crystal',
			'Atmosphere',
			'Brightness',
			'Goblins',
			'Echoes',
			'Sci-fi'
		]
	},
	{
		label: 'World',
		names: ['Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai']
	},
	{
		label: 'Percussive',
		names: [
			'Tinkle bell',
			'Agogo',
			'Steel drums',
			'Woodblock',
			'Taiko drum',
			'Melodic tom',
			'Synth drum',
			'Reverse cymbal'
		]
	},
	{
		label: 'Sound effects',
		names: [
			'Guitar fret noise',
			'Breath noise',
			'Seashore',
			'Bird tweet',
			'Telephone ring',
			'Helicopter',
			'Applause',
			'Gunshot'
		]
	}
];

export const instrumentOptions: TInstrumentOption[] = INSTRUMENT_FAMILIES.flatMap((family, index) =>
	family.names.map((label, offset) => ({ value: index * 8 + offset, label, family: family.label }))
);
