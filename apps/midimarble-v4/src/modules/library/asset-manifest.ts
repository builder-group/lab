import { Err, Ok, type TResult } from 'tuple-result';
import { defineSchema, prepareSchemaValue, type TSchemaValue } from 'versjon';
import { z } from 'zod';
import { SPackOrigin } from '@/modules/project/schema';

// Library item IDs double as folder names, so they stay short and filesystem-safe
const SItemId = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

const SAssetReaction = z.strictObject({
	// Child object name, such as `MM_REACT_Key`
	part: z.string().min(1),
	kind: z.enum(['press', 'wobble', 'glow'])
});

const SHexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/**
 * An extra property of an agent-made skin, shown as a row in the Skin panel. Blender writes its value to the material
 * inputs and to the Value or RGB nodes of this `name` (`apply_properties` in assets.py); a material without one ignores it.
 */
const SAssetProperty = z.strictObject({
	name: z.string().regex(/\S/).max(40),
	type: z.enum(['number', 'color']),
	default: z.union([z.number(), SHexColor]).optional(),
	min: z.number().optional(),
	max: z.number().optional()
});


export const SAssetManifest = z.strictObject({
	$schema: z.literal('marble-asset@1'),
	id: SItemId,
	label: z.string().regex(/\S/).max(80),
	role: z.enum(['skin', 'decoration', 'text']),
	pieceType: z.string().min(1).optional(),
	// Physical parameters the model was built for, in meters or radians
	fittedParams: z.record(z.string(), z.number()).optional(),
	reactions: z.array(SAssetReaction).optional(),
	// Extra skin properties beside Color, On Hit, Glow Color and Variant
	properties: z.array(SAssetProperty).optional(),
	notes: z.string().optional(),
	// Read and ignored: a skin no longer sets a marble's label color
	color: SHexColor.optional(),
	// Where the item comes from: `agent` is set when a Result is accepted; absent means it was brought in another way
	origin: z.enum(['agent', 'imported']).optional(),
	// The Pack it came from: its origin line reads "Christmas Pack", and still names it where the Pack isn't added
	pack: SPackOrigin.optional(),
});

export const assetManifestDefinition = defineSchema({
	family: 'marble-asset',
	version: 1,
	schema: SAssetManifest
});

export type TAssetManifest = TSchemaValue<typeof assetManifestDefinition>;
export type TAssetProperty = z.infer<typeof SAssetProperty>;

export function parseAssetManifest(json: string): TResult<TAssetManifest, Error> {
	return parseManifest(json, (value) => value);
}

/** Parses an agent's manifest, turning its `id` into a valid item ID such as `BrassBar` into `brassbar` */
export function parseCandidateManifest(json: string): TResult<TAssetManifest, Error> {
	return parseManifest(json, (value) => {
		return typeof value['id'] === 'string' ? { ...value, id: toItemId(value['id']) } : value;
	});
}

function parseManifest(
	json: string,
	prepare: (value: Record<string, unknown>) => Record<string, unknown>
): TResult<TAssetManifest, Error> {
	let value: unknown;
	try {
		value = JSON.parse(json);
	} catch (error) {
		return Err(new Error(`manifest.json is not valid JSON: ${(error as Error).message}`));
	}
	const input = isRecord(value) ? prepare(pickKnownKeys(value)) : value;
	const [isManifestOk, manifestErr, manifest] = prepareSchemaValue(assetManifestDefinition, input);
	if (!isManifestOk) return Err(manifestErr);
	return Ok(manifest as TAssetManifest);
}

const MANIFEST_KEYS = Object.keys(SAssetManifest.shape);

// Unknown top-level keys an agent adds are dropped rather than rejected, so a useful candidate is not lost to
// an extra field. versjon rejects schemas that change their input, so this happens before validation.
function pickKnownKeys(value: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(value).filter(([key]) => MANIFEST_KEYS.includes(key)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function serializeAssetManifest(manifest: TAssetManifest): string {
	return `${JSON.stringify(manifest, null, '\t')}\n`;
}

/** Lowercase, dash-separated ID derived from any label or agent-chosen ID */
export function toItemId(value: string): string {
	const slug = value
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 56)
		.replace(/-+$/, '');
	return slug.length > 0 ? slug : 'asset';
}

/** First free ID for `wanted`, appending `-2`, `-3`, … when the library already holds it */
export function uniqueItemId(wanted: string, taken: Iterable<string>): string {
	const takenIds = new Set(taken);
	const base = toItemId(wanted);
	if (!takenIds.has(base)) return base;
	for (let index = 2; ; index++) {
		const id = `${base}-${index}`;
		if (!takenIds.has(id)) return id;
	}
}
