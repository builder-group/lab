import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import inventory from './artwork-calibration.v2.json';
import { libraryAssets, libraryItems } from './index';

function readAsset(relative: string): string {
	return readFileSync(
		fileURLToPath(new URL('../../../../public/' + relative, import.meta.url)),
		'utf8'
	);
}
describe('calibrated flat artwork inventory', () => {
	it('should use new immutable vector assets for every active Victron definition', () => {
		const victron = libraryItems.filter((item) => item.brand === 'Victron Energy');
		expect(victron).toHaveLength(12);
		for (const item of victron) {
			const appearance = item.capabilities['appearance'];
			if (!appearance || !('assetId' in appearance)) throw new Error('Missing artwork');
			const asset = libraryAssets.find((asset) => asset.id === appearance.assetId);
			expect(asset?.mediaType).toBe('image/svg+xml');
			expect(asset?.id).toMatch(/-flat-v2$/);
			expect(asset?.relativePath).toMatch(/\.svg$/);
		}
	});
	it('should have no bitmap content or outside references in calibrated vector bodies', () => {
		for (const record of inventory.items) {
			const svg = readAsset('library/' + record.file);
			expect(svg).not.toContain('<image');
			expect(svg).not.toMatch(/data:image\/(?:png|jpeg|webp)/);
			expect(svg).not.toMatch(/(?:href|xlink:href)="https?:/);
			expect(createHash('sha256').update(svg).digest('hex')).toBe(record.derivedSha256);
		}
	});
	it('should make each SVG viewBox equal its physical projection envelope with no outer photo gutters', () => {
		for (const record of inventory.items) {
			const svg = readAsset('library/' + record.file);
			const width = record.calibration.physicalWidthMm;
			const height = record.calibration.physicalHeightMm;
			expect(svg).toContain(`viewBox="0 0 ${width} ${height}"`);
			const item = libraryItems.find((item) => item.id === record.itemId);
			const dimensions = item?.capabilities['dimensions'];
			expect(dimensions && 'widthMm' in dimensions ? dimensions.widthMm : undefined).toBe(width);
			expect(dimensions && 'heightMm' in dimensions ? dimensions.heightMm : undefined).toBe(height);
			for (const anchor of Object.values(record.anchors)) {
				expect(anchor.x).toBeGreaterThanOrEqual(0);
				expect(anchor.x).toBeLessThanOrEqual(1);
				expect(anchor.y).toBeGreaterThanOrEqual(0);
				expect(anchor.y).toBeLessThanOrEqual(1);
			}
		}
	});
	it('should map located terminal landmarks through exactly the same body transform as the illustration', () => {
		const auditSchema = z.object({
			anchors: z.record(z.string(), z.object({ x: z.number(), y: z.number() })),
			sourceAnchors: z.record(z.string(), z.object({ x: z.number(), y: z.number() })).optional(),
			calibration: z.object({
				sourceBodyBounds: z.object({
					x: z.number(),
					y: z.number(),
					width: z.number().positive(),
					height: z.number().positive()
				}),
				sourceOuterViewBox: z.array(z.number()).length(4).optional()
			})
		});
		for (const record of inventory.items) {
			const audit = auditSchema.parse(record);
			if (!audit.sourceAnchors || !audit.calibration.sourceOuterViewBox) continue;
			const bounds = audit.calibration.sourceBodyBounds;
			const outer = audit.calibration.sourceOuterViewBox;
			for (const [id, source] of Object.entries(audit.sourceAnchors)) {
				const anchor = audit.anchors[id];
				if (!anchor) throw new Error('Source anchor missing in artwork');
				expect((anchor.x * bounds.width + bounds.x) / (outer[2] ?? 1)).toBeCloseTo(source.x, 5);
				expect((anchor.y * bounds.height + bounds.y) / (outer[3] ?? 1)).toBeCloseTo(source.y, 5);
			}
		}
	});
	it('should separate the actual MultiPlus24/3000 outline from other inverter variants', () => {
		const multi = inventory.items.find((item) => item.itemId === 'victron-multiplus-24-3000');
		expect(multi?.dimensionsMm).toEqual({ width: 268, height: 499, depth: 141 });
		expect(multi?.calibration.sourceVariant).toBe('multiplus-ii-24-3000-70-32');
	});
	it('should not invent physical anchors for hidden rear or free cable connectors', () => {
		const touch = libraryItems.find((item) => item.id === 'victron-gx-touch-70');
		const touchAppearance = touch?.capabilities['appearance'];
		expect(
			touchAppearance && 'anchors' in touchAppearance ? touchAppearance.anchors : undefined
		).toEqual({});
		const cerbo = libraryItems.find((item) => item.id === 'victron-cerbo-gx');
		const cerboAppearance = cerbo?.capabilities['appearance'];
		const anchors =
			cerboAppearance && 'anchors' in cerboAppearance ? cerboAppearance.anchors : undefined;
		expect(anchors).not.toHaveProperty('gx-touch');
		expect(anchors).not.toHaveProperty('tank');
	});
});
