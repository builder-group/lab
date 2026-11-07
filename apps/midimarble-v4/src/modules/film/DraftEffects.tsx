import { useFeatureState } from 'feature-react/state';
import React from 'react';
import { flakeAt, type TFlake } from '@/modules/scene';
import type { DraftPreviewCx, TDraftEffect } from './DraftPreviewCx';

// Particles in the Draft Preview: a cheap stand-in for what Blender builds, over the frame. One canvas, a soft
// sprite per flake, redrawn when the playhead moves. Reduce Motion stops the snow where it is.

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
		drawSnow(context, effect.flakes, effect.color, effect.size, effect.speed, reducesMotion() ? 0 : time, width, height);
	}
	context.globalAlpha = 1;
}

const sprites = new Map<string, HTMLCanvasElement>();

/** A soft round flake, drawn once per color */
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
