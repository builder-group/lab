import { describe, expect, it } from 'vitest';
import { parseAssetManifest, parseCandidateManifest, serializeAssetManifest, toItemId, uniqueItemId } from './asset-manifest';

const valid = {
	$schema: 'marble-asset@1',
	id: 'brass-bar',
	label: 'Brass bar',
	role: 'skin',
	pieceType: 'platform',
	fittedParams: { length: 0.06 },
	notes: 'Chrome cap glows on hits'
};

describe('parseAssetManifest function', () => {
	it('should accept a valid manifest and drop unknown keys', () => {
		const [isManifestOk, , manifest] = parseAssetManifest(
			JSON.stringify({ ...valid, extra: true })
		);

		expect(isManifestOk).toBe(true);
		expect(manifest).toEqual(valid);
		if (manifest == null) return;
		expect(serializeAssetManifest(manifest)).toContain('"$schema": "marble-asset@1"');
	});

	it('should reject a wrong schema, role or ID', () => {
		for (const manifest of [
			{ ...valid, $schema: 'marble-asset@2' },
			{ ...valid, $schema: undefined },
			{ ...valid, role: 'theme' },
			{ ...valid, id: '../brass' },
			{ ...valid, label: '' }
		]) {
			const [isManifestOk] = parseAssetManifest(JSON.stringify(manifest));
			expect(isManifestOk, JSON.stringify(manifest)).toBe(false);
		}
	});

	it('should turn an agent-chosen ID into a valid item ID for candidates', () => {
		const json = JSON.stringify({ ...valid, id: 'Brass Bar' });

		expect(parseAssetManifest(json)[0]).toBe(false);
		expect(parseCandidateManifest(json)[2]?.id).toBe('brass-bar');
	});

	it('should reject invalid JSON with a readable error', () => {
		const [isManifestOk, manifestErr] = parseAssetManifest('{');

		expect(isManifestOk).toBe(false);
		expect(manifestErr?.message).toContain('not valid JSON');
	});
});

describe('uniqueItemId function', () => {
	it('should slugify and append a free suffix', () => {
		expect(toItemId('Brass Bar (Chrome cap)')).toBe('brass-bar-chrome-cap');
		expect(toItemId('***')).toBe('asset');
		expect(uniqueItemId('brass-bar', ['brass-bar', 'brass-bar-2'])).toBe('brass-bar-3');
		expect(uniqueItemId('Brass bar', [])).toBe('brass-bar');
	});
});
