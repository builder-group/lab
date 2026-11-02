export interface TDcCableSizingInput {
	circuit: 'dc' | 'ac' | 'unknown';
	voltageV: number | null;
	currentA: number | null;
	/** Physical source-to-load cable length, including entered allowance. Never pre-doubled. */
	oneWayLengthM: number | null;
	maxDropPercent: number | null;
	/** 2 assumes an equal-length, equal-section return. 1 evaluates the entered conductor alone. */
	roundTripFactor: 1 | 2;
	conductorTemperatureC: number;
	conductor: 'copper' | 'aluminium' | 'unknown';
	selectedCrossSectionMm2: number | null;
	enteredCableCurrentLimitA?: number | null;
}
export interface TDcCableSizingResult {
	status: 'ready' | 'incomplete' | 'unsupported';
	reason: string | null;
	missing: string[];
	input: TDcCableSizingInput;
	oneWayLengthM: number | null;
	loopLengthM: number | null;
	allowedDropV: number | null;
	resistivityOhmMm2PerM: number | null;
	minimumCrossSectionMm2: number | null;
	recommendedStandardMm2: number | null;
	recommendedDropV: number | null;
	recommendedDropPercent: number | null;
	selectedVoltageDropV: number | null;
	selectedVoltageDropPercent: number | null;
	withinVoltageDrop: boolean | null;
	ampacityStatus: 'not-checked' | 'within-entered-limit' | 'exceeds-entered-limit';
	warnings: string[];
	evidence: string[];
	sources: string[];
}
/** Common metric sizes, not a claim that every product or installation supports them. */
export const STANDARD_CABLE_SECTIONS_MM2 = [
	0.5, 0.75, 1, 1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120, 150, 185, 240
] as const;
export const DC_SIZING_SOURCES = [
	'https://www.victronenergy.com/media/pg/The_Wiring_Unlimited_book/en/theory.html',
	'https://www.victronenergy.com/media/pg/The_Wiring_Unlimited_book/en/dc-wiring.html',
	'https://nvlpubs.nist.gov/nistpubs/Legacy/hb/nbshandbook100.pdf',
	'https://nvlpubs.nist.gov/nistpubs/Legacy/hb/nbshandbook109.pdf'
];
const CONDUCTOR_PROPERTIES = {
	copper: { rho20: 1 / 58, alpha20: 0.00393 },
	aluminium: { rho20: 0.028264, alpha20: 0.00403 }
};
/** DC resistance/drop estimate only. It never derives installation ampacity from conductor area. */
export function calculateDcCableSizing(input: TDcCableSizingInput): TDcCableSizingResult {
	const result: TDcCableSizingResult = {
		status: 'incomplete',
		reason: null,
		missing: [],
		input: { ...input },
		oneWayLengthM: input.oneWayLengthM,
		loopLengthM: null,
		allowedDropV: null,
		resistivityOhmMm2PerM: null,
		minimumCrossSectionMm2: null,
		recommendedStandardMm2: null,
		recommendedDropV: null,
		recommendedDropPercent: null,
		selectedVoltageDropV: null,
		selectedVoltageDropPercent: null,
		withinVoltageDrop: null,
		ampacityStatus: 'not-checked',
		warnings: [
			'Voltage-drop sizing only; verify installation ampacity, protection, terminals and manufacturer minimum cable sizes separately.',
			'Cable resistance estimate excludes fuses, switches, connectors and contact losses.'
		],
		evidence: [],
		sources: [...DC_SIZING_SOURCES]
	};
	if (input.circuit === 'ac') {
		result.status = 'unsupported';
		result.reason = 'AC cable sizing is not supported by this DC estimator.';
		return result;
	}
	if (input.circuit === 'unknown') result.missing.push('Circuit type');
	if (!positive(input.voltageV)) result.missing.push('Supply voltage');
	if (!positive(input.currentA)) result.missing.push('Design current');
	if (!positive(input.oneWayLengthM)) result.missing.push('One-way cable length');
	if (!positive(input.maxDropPercent) || input.maxDropPercent >= 100)
		result.missing.push('Allowed voltage drop (greater than 0%, less than 100%)');
	if (input.conductor === 'unknown') result.missing.push('Conductor material');
	if (
		!Number.isFinite(input.conductorTemperatureC) ||
		input.conductorTemperatureC < -20 ||
		input.conductorTemperatureC > 105
	)
		result.missing.push('Conductor temperature (-20 to 105°C)');
	if (input.roundTripFactor !== 1 && input.roundTripFactor !== 2)
		result.missing.push('Length multiplier (1 or 2)');
	if (input.selectedCrossSectionMm2 != null && !positive(input.selectedCrossSectionMm2))
		result.missing.push('Selected cross-section must be positive');
	if (result.missing.length) return result;
	// Narrow validated inputs explicitly; unknowns never become zero-valued design facts.
	const voltage = input.voltageV,
		current = input.currentA,
		length = input.oneWayLengthM,
		dropPercent = input.maxDropPercent;
	if (
		voltage == null ||
		current == null ||
		length == null ||
		dropPercent == null ||
		input.conductor === 'unknown'
	)
		return result;
	const material = CONDUCTOR_PROPERTIES[input.conductor];
	const rho = material.rho20 * (1 + material.alpha20 * (input.conductorTemperatureC - 20));
	const loop = length * input.roundTripFactor;
	const allowed = (voltage * dropPercent) / 100;
	const minimum = (rho * loop * current) / allowed;
	const recommended =
		STANDARD_CABLE_SECTIONS_MM2.find((section) => section + 1e-10 >= minimum) ?? null;
	Object.assign(result, {
		status: 'ready',
		loopLengthM: loop,
		allowedDropV: allowed,
		resistivityOhmMm2PerM: rho,
		minimumCrossSectionMm2: minimum,
		recommendedStandardMm2: recommended
	});
	if (input.roundTripFactor === 1)
		result.warnings.push(
			'Only this conductor is included. Return-path voltage drop is not included.'
		);
	else
		result.warnings.push(
			'Return assumed equal in length, section and material. Unequal return paths require a separate complete-circuit calculation.'
		);
	if (recommended == null)
		result.warnings.push(
			'Required area exceeds the supported size list; no standard size has been recommended.'
		);
	else {
		result.recommendedDropV = (rho * loop * current) / recommended;
		result.recommendedDropPercent = (result.recommendedDropV / voltage) * 100;
	}
	if (positive(input.selectedCrossSectionMm2)) {
		result.selectedVoltageDropV = (rho * loop * current) / input.selectedCrossSectionMm2;
		result.selectedVoltageDropPercent = (result.selectedVoltageDropV / voltage) * 100;
		result.withinVoltageDrop = result.selectedVoltageDropV <= allowed + 1e-10;
	}
	if (positive(input.enteredCableCurrentLimitA))
		result.ampacityStatus =
			current <= input.enteredCableCurrentLimitA ? 'within-entered-limit' : 'exceeds-entered-limit';
	result.evidence = [
		`ρ(T) = ρ20 × [1 + α20 × (T − 20°C)] = ${rho.toPrecision(7)} Ω·mm²/m (${input.conductor}, ${input.conductorTemperatureC}°C).`,
		`Calculation conductor length = ${length} m one-way × ${input.roundTripFactor} = ${loop} m. Material demand is not multiplied.`,
		`Allowed drop = ${voltage} V × ${dropPercent}% = ${allowed.toPrecision(6)} V.`,
		`Minimum area = ρ(T) × conductor length × current / allowed drop = ${minimum.toPrecision(6)} mm².`,
		`Selected cable drop = I × ρ(T) × conductor length / selected area.`
	];
	return result;
}
function positive(value: number | null | undefined): value is number {
	return value != null && Number.isFinite(value) && value > 0;
}
