// Trims GeneralUser GS to the melodic presets in `instruments.ts` and writes `public/audio/marble-instruments.sf2`
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { SoundBankLoader, SpessaLog } from 'spessasynth_core';
import { instruments } from '../src/modules/music/instruments';

const sourceUrl = new URL('../../midimarble/public/audio/general-user-gs.sf2', import.meta.url);
const targetUrl = new URL('../public/audio/marble-instruments.sf2', import.meta.url);

SpessaLog.setLogLevel(false, false, false);
const bytes = readFileSync(sourceUrl);
const bank = SoundBankLoader.fromArrayBuffer(new Uint8Array(bytes).buffer);
const programs = new Set(instruments.map((instrument) => instrument.program));

for (const preset of [...bank.presets]) {
	const isKept =
		!preset.isGMGSDrum &&
		preset.bankMSB === 0 &&
		preset.bankLSB === 0 &&
		programs.has(preset.program);
	if (!isKept) bank.deletePreset(preset);
}
bank.removeUnusedElements();
bank.flush();

const missing = [...programs].filter(
	(program) => !bank.presets.some((preset) => preset.program === program)
);
if (missing.length > 0) throw new Error(`Missing presets for programs ${missing.join(', ')}`);

bank.soundBankInfo.name = 'MidiMarble Instruments (GeneralUser GS subset)';
const output = bank.writeSF2({ software: 'MidiMarble build-soundbank' });
writeFileSync(targetUrl, new Uint8Array(output));

const size = statSync(targetUrl).size;
console.log(
	`Wrote ${bank.presets.length} presets, ${bank.instruments.length} instruments, ${bank.samples.length} samples`
);
console.log(`${targetUrl.pathname}: ${(size / 1024 / 1024).toFixed(2)} MB`);
