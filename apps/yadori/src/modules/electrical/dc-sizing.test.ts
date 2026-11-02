import { describe, expect, it } from 'vitest';
import { calculateDcCableSizing, type TDcCableSizingInput } from './dc-sizing';

const input: TDcCableSizingInput = {
	circuit: 'dc',
	voltageV: 12,
	currentA: 10,
	oneWayLengthM: 5,
	maxDropPercent: 3,
	roundTripFactor: 2,
	conductorTemperatureC: 20,
	conductor: 'copper',
	selectedCrossSectionMm2: 6
};
describe('DC cable voltage-drop estimator', () => {
	it('should include the outbound and return resistance and round area up to a standard section', () => {
		const result = calculateDcCableSizing(input);
		expect(result.status).toBe('ready');
		expect(result.loopLengthM).toBe(10);
		expect(result.allowedDropV).toBeCloseTo(0.36, 10);
		expect(result.minimumCrossSectionMm2).toBeCloseTo(((1 / 58) * 10 * 10) / 0.36, 10);
		expect(result.recommendedStandardMm2).toBe(6);
		expect(result.selectedVoltageDropV).toBeCloseTo(0.2873563218, 9);
		expect(result.selectedVoltageDropPercent).toBeCloseTo(2.3946360153, 9);
		expect(result.withinVoltageDrop).toBe(true);
		expect(result.ampacityStatus).toBe('not-checked');
	});
	it('should keep a manually chosen section and report excessive drop without silently replacing it', () => {
		const result = calculateDcCableSizing({ ...input, selectedCrossSectionMm2: 2.5 });
		expect(result.recommendedStandardMm2).toBe(6);
		expect(result.input.selectedCrossSectionMm2).toBe(2.5);
		expect(result.selectedVoltageDropPercent).toBeCloseTo(5.7471264368, 9);
		expect(result.withinVoltageDrop).toBe(false);
	});
	it('should expose the factor rather than silently halve the entered one-way distance', () => {
		const both = calculateDcCableSizing(input);
		const single = calculateDcCableSizing({ ...input, roundTripFactor: 1 });
		expect(both.minimumCrossSectionMm2).toBeCloseTo((single.minimumCrossSectionMm2 ?? 0) * 2, 10);
		expect(single.loopLengthM).toBe(5);
		expect(
			single.warnings.some((warning) =>
				warning.includes('Return-path voltage drop is not included')
			)
		).toBe(true);
	});
	it('should account for entered conductor temperature and material without claiming installation ampacity', () => {
		const cold = calculateDcCableSizing(input);
		const hot = calculateDcCableSizing({ ...input, conductorTemperatureC: 70 });
		expect(hot.minimumCrossSectionMm2).toBeCloseTo((cold.minimumCrossSectionMm2 ?? 0) * 1.1965, 10);
		const aluminium = calculateDcCableSizing({ ...input, conductor: 'aluminium' });
		expect(aluminium.minimumCrossSectionMm2).toBeCloseTo((0.028264 * 100) / 0.36, 10);
		expect(aluminium.recommendedStandardMm2).toBe(10);
		expect(aluminium.ampacityStatus).toBe('not-checked');
	});
	it('should return unknown requirements and unsupported AC rather than fabricated recommendations', () => {
		const unknown = calculateDcCableSizing({
			...input,
			voltageV: null,
			currentA: null,
			oneWayLengthM: null
		});
		expect(unknown.status).toBe('incomplete');
		expect(unknown.missing).toEqual(['Supply voltage', 'Design current', 'One-way cable length']);
		expect(unknown.recommendedStandardMm2).toBeNull();
		const ac = calculateDcCableSizing({ ...input, circuit: 'ac' });
		expect(ac.status).toBe('unsupported');
		expect(ac.selectedVoltageDropV).toBeNull();
		expect(ac.minimumCrossSectionMm2).toBeNull();
	});
	it('should not recommend the largest supported section if even that is too small', () => {
		const result = calculateDcCableSizing({
			...input,
			currentA: 500,
			oneWayLengthM: 100,
			maxDropPercent: 1
		});
		expect(result.status).toBe('ready');
		expect(result.minimumCrossSectionMm2).toBeGreaterThan(240);
		expect(result.recommendedStandardMm2).toBeNull();
		expect(result.withinVoltageDrop).toBe(false);
	});
	it('should compare an explicitly entered current limit without deriving one from mm²', () => {
		expect(calculateDcCableSizing({ ...input, enteredCableCurrentLimitA: 9 }).ampacityStatus).toBe(
			'exceeds-entered-limit'
		);
		expect(calculateDcCableSizing({ ...input, enteredCableCurrentLimitA: 12 }).ampacityStatus).toBe(
			'within-entered-limit'
		);
		expect(calculateDcCableSizing({ ...input, currentA: 0 }).status).toBe('incomplete');
		expect(calculateDcCableSizing({ ...input, oneWayLengthM: Infinity }).status).toBe('incomplete');
	});
});
