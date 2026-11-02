import type {
	TAppearanceCapability,
	TDimensionsCapability,
	TPart,
	TPoint,
	TPort,
	TPortKind
} from '../project/model/types';

export function getDimensions(part: Pick<TPart, 'capabilities'>): TDimensionsCapability | null {
	const value = part.capabilities['dimensions'];
	return value?.$schema === 'yadori/dimensions@1' ? (value as TDimensionsCapability) : null;
}
export function getAppearance(part: Pick<TPart, 'capabilities'>): TAppearanceCapability | null {
	const value = part.capabilities['appearance'];
	return value?.$schema === 'yadori/appearance@1' ? (value as TAppearanceCapability) : null;
}
export function getDisplaySize(
	part: Pick<TPart, 'capabilities'>,
	rotation = 0
): { width: number; height: number; calibrated: boolean } {
	const dimensions = getDimensions(part);
	const projection = getAppearance(part)?.projection ?? 'front';
	const physicalWidth = projection === 'side' ? dimensions?.depthMm : dimensions?.widthMm;
	const physicalHeight = projection === 'top' ? dimensions?.depthMm : dimensions?.heightMm;
	const calibrated = physicalWidth != null && physicalHeight != null;
	const width = physicalWidth ?? 160;
	const height = physicalHeight ?? 110;
	return {
		width: rotation % 180 === 0 ? width : height,
		height: rotation % 180 === 0 ? height : width,
		calibrated
	};
}
export function rotateAnchor(point: TPoint, rotation: number): TPoint {
	if (rotation === 90) return { x: 1 - point.y, y: point.x };
	if (rotation === 180) return { x: 1 - point.x, y: 1 - point.y };
	if (rotation === 270) return { x: point.y, y: 1 - point.x };
	return point;
}
export function getPortAnchor(
	part: TPart,
	port: TPort,
	index: number,
	count: number,
	rotation: number
): TPoint {
	const normalized = getAppearance(part)?.anchors[port.id] ?? {
		x: (index + 1) / (count + 1),
		y: 1
	};
	return rotateAnchor(normalized, rotation);
}
export function orthogonalRoute(from: TPoint, to: TPoint): TPoint[] {
	const x = Math.round((from.x + to.x) / 20) * 10;
	return simplifyRoute([from, { x, y: from.y }, { x, y: to.y }, to]);
}
export function simplifyRoute(points: TPoint[]): TPoint[] {
	return points.filter((p, i) => i === 0 || p.x !== points[i - 1]?.x || p.y !== points[i - 1]?.y);
}
export function orthogonalizeRoute(points: TPoint[]): TPoint[] {
	const result: TPoint[] = [];
	for (const p of points) {
		const previous = result.at(-1);
		if (previous != null && previous.x !== p.x && previous.y !== p.y)
			result.push({ x: p.x, y: previous.y });
		result.push(p);
	}
	return simplifyRoute(result);
}
export function polylineLengthM(points: TPoint[]): number {
	return (
		points.slice(1).reduce((length, point, index) => {
			const previous = points[index];
			return (
				length + (previous == null ? 0 : Math.hypot(point.x - previous.x, point.y - previous.y))
			);
		}, 0) / 1000
	);
}
export function routePath(points: TPoint[]): string {
	return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
}
export function portColor(kind: TPortKind): string {
	if (kind === 'positive') return '#c75c50';
	if (kind === 'negative') return '#53616a';
	if (kind === 'live') return '#946c42';
	if (kind === 'neutral') return '#467bc0';
	if (kind === 'earth') return '#8b9b37';
	if (kind === 'signal') return '#8a789e';
	return '#7e8984';
}
export function readableWireWidth(crossSectionMm2: number | null): number {
	return crossSectionMm2 == null ? 1.8 : Math.min(5.5, 1.5 + Math.log2(1 + crossSectionMm2) * 0.45);
}
export function snapPoint(point: TPoint, grid = 10): TPoint {
	return { x: Math.round(point.x / grid) * grid, y: Math.round(point.y / grid) * grid };
}
