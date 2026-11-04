import { useFeatureState } from 'feature-react/state';
import React from 'react';
import { flakeAt, GARLAND_PERIOD, type TFlake } from './decor-effects';
import type { DraftPreviewCx, TDraftEffect } from './DraftPreviewCx';

// Snowfall and Garland in the Draft Preview: a cheap stand-in for what Blender builds, over the frame. One canvas, a soft
// sprite per flake and a few strokes per sprig, redrawn when the playhead moves. Reduce Motion stops the snow where it is.

function reducesMotion(): boolean {
	return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export const DraftEffects: React.FC<{ draft: DraftPreviewCx }> = (props) => {
	const { draft } = props;
	useFeatureState(draft.$frame);
	const canvasRef = React.useRef<HTMLCanvasElement>(null);
	const effects = draft.frameEffects();
	React.useEffect(() => {
		const element = canvasRef.current;
		if (element != null) draw(element, effects, draft.studio.$playhead.get());
	});
	return effects.length > 0 ? <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden /> : null;
};

function draw(canvas: HTMLCanvasElement, effects: readonly TDraftEffect[], time: number): void {
	const ratio = Math.min(2, window.devicePixelRatio || 1);
	const [width, height] = [Math.round(canvas.clientWidth * ratio), Math.round(canvas.clientHeight * ratio)];
	if (canvas.width !== width || canvas.height !== height) {
		canvas.width = width;
		canvas.height = height;
	}
	const context = canvas.getContext('2d');
	if (context == null) return;
	context.clearRect(0, 0, width, height);
	for (const effect of effects) {
		context.globalAlpha = effect.opacity;
		if (effect.kind === 'garland') drawGarland(context, effect, width, height);
		else drawSnow(context, effect.flakes, effect.color, effect.size, effect.speed, reducesMotion() ? 0 : time, width, height);
	}
	context.globalAlpha = 1;
}

const sprites = new Map<string, HTMLCanvasElement>();

/** A soft round flake, drawn once per colour */
function flakeSprite(color: string): HTMLCanvasElement {
	const known = sprites.get(color);
	if (known != null) return known;
	const sprite = document.createElement('canvas');
	sprite.width = sprite.height = 64;
	const context = sprite.getContext('2d');
	if (context != null) {
		const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
		gradient.addColorStop(0, color);
		gradient.addColorStop(0.42, color);
		// A faint warm shade at the rim, as in Blender: a pale flake on a pale wall still reads
		gradient.addColorStop(0.8, 'rgb(90 55 25 / 0.14)');
		gradient.addColorStop(1, 'rgb(90 55 25 / 0)');
		context.fillStyle = gradient;
		context.fillRect(0, 0, 64, 64);
	}
	sprites.set(color, sprite);
	return sprite;
}

function drawSnow(context: CanvasRenderingContext2D, flakes: readonly TFlake[], color: string, size: number, speed: number, time: number, width: number, height: number): void {
	const sprite = flakeSprite(color);
	const base = context.globalAlpha;
	const unit = Math.min(width, height);
	for (const flake of flakes) {
		const { u, v } = flakeAt(flake, time, speed);
		const diameter = flake.diameter * size * unit;
		context.globalAlpha = base * flake.alpha;
		context.drawImage(sprite, u * width - diameter / 2, v * height - diameter / 2, diameter, diameter);
	}
	context.globalAlpha = base;
}

const NEEDLE = '#30463a';
const WIRE = '#201c18';
const BULB = '#ffe9bd';
const BAUBLES = { red: '#c31f28', gold: '#d9b45a' };

function drawGarland(context: CanvasRenderingContext2D, effect: Extract<TDraftEffect, { kind: 'garland' }>, width: number, height: number): void {
	const unit = Math.min(width, height);
	const step = Math.max(0.04, effect.spacing) * height;
	const period = step * GARLAND_PERIOD;
	for (const side of effect.sides) {
		const edge = side < 0 ? 0 : width;
		const inward = side < 0 ? 1 : -1;
		const wireX = (y: number): number => edge + inward * unit * 0.05 + inward * unit * 0.016 * Math.sin(((y - effect.scroll * height) / period) * Math.PI * 6);
		context.strokeStyle = WIRE;
		context.lineWidth = Math.max(1, unit * 0.0024);
		context.beginPath();
		for (let y = -step; y <= height + step; y += step / 6) context.lineTo(wireX(y), y);
		context.stroke();
		for (const sprig of effect.sprigs) {
			const y = sprig.v * height;
			const length = unit * 0.17;
			context.strokeStyle = NEEDLE;
			context.lineWidth = Math.max(1, unit * 0.0035);
			context.beginPath();
			context.moveTo(edge, y);
			context.lineTo(edge + inward * length, y);
			for (let needle = 0; needle < 9; needle++) {
				const at = edge + inward * length * ((needle + 0.5) / 9);
				const reach = length * (0.24 - needle * 0.012);
				context.moveTo(at, y);
				context.lineTo(at + inward * reach * 0.55, y - reach * 0.8);
				context.moveTo(at, y);
				context.lineTo(at + inward * reach * 0.55, y + reach * 0.8);
			}
			context.stroke();
			for (const share of [0.2, 0.7]) {
				const at = y - share * step;
				context.fillStyle = BULB;
				context.beginPath();
				context.arc(wireX(at), at, Math.max(1.2, unit * 0.005), 0, Math.PI * 2);
				context.fill();
			}
			if (sprig.bauble != null) {
				context.fillStyle = BAUBLES[sprig.bauble];
				context.beginPath();
				context.arc(wireX(y + step * 0.32) + inward * unit * 0.018, y + step * 0.32, unit * 0.024, 0, Math.PI * 2);
				context.fill();
			}
		}
	}
}
