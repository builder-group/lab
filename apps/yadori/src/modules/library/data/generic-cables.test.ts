import { describe, expect, it } from 'vitest';
import { createLibraryPart, getCapability } from '../../project/model';
import { libraryItems } from './index';

describe('generic cable library profiles', () => {
	it('should become continuous metre-based materials without invented retail or installation specifications', () => {
		const profiles = libraryItems.filter((item) => item.id.startsWith('generic-copper-cable-'));
		expect(profiles).toHaveLength(3);
		expect(profiles.map((item) => getCapability(item, 'cable')?.crossSectionMm2)).toEqual([
			6, 16, 35
		]);
		for (const item of profiles) {
			const part = createLibraryPart(item);
			expect(part.unit).toBe('m');
			expect(part.quantity).toBe(0);
			expect(part.plannedQuantity).toBeNull();
			expect(part.purchasePackQuantity).toBeNull();
			expect(part.estimatedUnitPrice).toBeNull();
			expect(part.sourceIds).toEqual([]);
			expect(item.sourceUrl).toBeNull();
			expect(item.brand).toBe('');
			expect(item.tags).toEqual(['Electrical', 'Cable']);
			expect(getCapability(part, 'appearance')).toBeUndefined();
			expect(getCapability(part, 'electrical')).toBeUndefined();
			expect(getCapability(part, 'cable')).toMatchObject({
				coreCount: 1,
				conductor: 'copper',
				color: null,
				outerDiameterMm: null,
				ratedCurrentA: null,
				voltageRatingV: null,
				verified: false
			});
			expect(part.capabilities['linearMaterial']).toMatchObject({
				unit: 'm',
				continuous: true
			});
		}
	});
});
