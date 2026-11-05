import type { TPathNode, TVec2 } from '@/modules/project';

// Rails drawn with the path tool are cubic Bézier curves like a Figma vector path. Each node keeps its
// handles as offsets from its point, so moving a node carries its handles. The engine gets the curve
// sampled densely into `path.points`, which its smoothing passes through almost unchanged.

/** Spacing of the sampled polyline in meters, fine enough that the engine's smoothing keeps the curve */
export const PATH_SAMPLE_SPACING = 0.006;

/** Point on the cubic segment from node `a` to node `b` at `t` */
export function segmentPoint(a: TPathNode, b: TPathNode, t: number): TVec2 {
	const p0 = a.point;
	const p1 = add(a.point, a.out);
	const p2 = add(b.point, b.in);
	const p3 = b.point;
	const u = 1 - t;
	const w0 = u * u * u;
	const w1 = 3 * u * u * t;
	const w2 = 3 * u * t * t;
	const w3 = t * t * t;
	return { x: w0 * p0.x + w1 * p1.x + w2 * p2.x + w3 * p3.x, y: w0 * p0.y + w1 * p1.y + w2 * p2.y + w3 * p3.y };
}

/** The curve as a polyline with about `spacing` between points, starting at the first node */
export function sampleNodes(nodes: TPathNode[], spacing = PATH_SAMPLE_SPACING): TVec2[] {
	const first = nodes[0];
	if (first == null) return [];
	const points: TVec2[] = [{ ...first.point }];
	for (let i = 1; i < nodes.length; i++) {
		const a = nodes[i - 1] as TPathNode;
		const b = nodes[i] as TPathNode;
		// The control polygon bounds the segment length from above, which is enough for the spacing
		const hull = distance(a.point, add(a.point, a.out)) + distance(add(a.point, a.out), add(b.point, b.in)) + distance(add(b.point, b.in), b.point);
		const count = Math.max(1, Math.ceil(hull / spacing));
		for (let s = 1; s <= count; s++) {
			const point = segmentPoint(a, b, s / count);
			const last = points[points.length - 1] as TVec2;
			if (distance(point, last) > 1e-6) points.push(point);
		}
	}
	return points;
}

/** Nodes shifted so the first one sits at the origin, with the shift that was taken out */
export function rebaseNodes(nodes: TPathNode[]): { nodes: TPathNode[]; shift: TVec2 } {
	const shift = nodes[0]?.point ?? { x: 0, y: 0 };
	return { nodes: nodes.map((node) => ({ ...node, point: { x: node.point.x - shift.x, y: node.point.y - shift.y } })), shift: { ...shift } };
}

/** Moves node `index` to `point`; its handles move with it */
export function withNodePoint(nodes: TPathNode[], index: number, point: TVec2): TPathNode[] {
	return nodes.map((node, i) => (i === index ? { ...node, point: { ...point } } : node));
}

/**
 * Sets one handle of node `index` to `offset` from its point. The opposite handle mirrors it, like
 * Figma's default, unless `mirror` is false.
 */
export function withNodeHandle(nodes: TPathNode[], index: number, handle: 'in' | 'out', offset: TVec2, mirror = true): TPathNode[] {
	const opposite = handle === 'in' ? 'out' : 'in';
	return nodes.map((node, i) => {
		if (i !== index) return node;
		const next: TPathNode = { ...node, [handle]: { ...offset } };
		if (mirror) next[opposite] = { x: -offset.x, y: -offset.y };
		return next;
	});
}

/** Points and handles of the curve mapped through `map`, such as from local to screen coordinates */
export function mapNodes(nodes: TPathNode[], map: (point: TVec2) => TVec2): { point: TVec2; in: TVec2 | null; out: TVec2 | null }[] {
	return nodes.map((node) => ({
		point: map(node.point),
		in: node.in != null && length(node.in) > 1e-9 ? map(add(node.point, node.in)) : null,
		out: node.out != null && length(node.out) > 1e-9 ? map(add(node.point, node.out)) : null
	}));
}

/** SVG path data for the curve, after mapping its points to screen space */
export function nodesPathData(nodes: TPathNode[], map: (point: TVec2) => TVec2): string {
	const first = nodes[0];
	if (first == null) return '';
	const start = map(first.point);
	let data = `M ${start.x} ${start.y}`;
	for (let i = 1; i < nodes.length; i++) {
		const a = nodes[i - 1] as TPathNode;
		const b = nodes[i] as TPathNode;
		const c1 = map(add(a.point, a.out));
		const c2 = map(add(b.point, b.in));
		const end = map(b.point);
		data += ` C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${end.x} ${end.y}`;
	}
	return data;
}

function add(point: TVec2, offset: TVec2 | undefined): TVec2 {
	return offset == null ? point : { x: point.x + offset.x, y: point.y + offset.y };
}

function length(vector: TVec2): number {
	return Math.hypot(vector.x, vector.y);
}

function distance(a: TVec2, b: TVec2): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}
