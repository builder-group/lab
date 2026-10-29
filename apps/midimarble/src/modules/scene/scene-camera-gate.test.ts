import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { cameraContextFov, cameraPassepartout, fitCameraGate } from './scene-camera-gate';

describe('camera context projection', () => {
	it.each([
		[1400, 800, 9 / 16],
		[900, 1000, 16 / 9],
		[1200, 800, 1],
		[640, 360, 9 / 16],
		[1, 1000, 16 / 9]
	])(
		'should preserve every output pixel inside a %s×%s host with aspect %s',
		(width, height, aspect) => {
			const gate = fitCameraGate(width, height, aspect);
			const output = new THREE.PerspectiveCamera(38, aspect, 0.05, 1500);
			const context = new THREE.PerspectiveCamera(
				cameraContextFov(38, height, gate.height),
				width / height,
				0.05,
				1500
			);
			for (const position of [
				[-2, -1, -8],
				[0, 0, -12],
				[1.5, 2, -10]
			]) {
				const framed = new THREE.Vector3(...position).project(output);
				const full = new THREE.Vector3(...position).project(context);
				expect(((full.x + 1) * width) / 2).toBeCloseTo(
					gate.x + ((framed.x + 1) * gate.width) / 2,
					8
				);
				expect(((1 - full.y) * height) / 2).toBeCloseTo(
					gate.y + ((1 - framed.y) * gate.height) / 2,
					8
				);
			}
		}
	);
	it('should resize four nonoverlapping passepartout bars to exactly cover the area outside the gate', () => {
		for (const [width, height, aspect] of [
			[1400, 800, 9 / 16],
			[700, 1000, 16 / 9],
			[800, 800, 1]
		]) {
			if (width == null || height == null || aspect == null) continue;
			const gate = fitCameraGate(width, height, aspect);
			const bars = cameraPassepartout(width, height, gate);
			const covered = bars.reduce(
				(area, bar) => area + bar.width * bar.height,
				gate.width * gate.height
			);
			expect(covered).toBeCloseTo(width * height);
			for (const bar of bars) {
				expect(bar.width).toBeGreaterThanOrEqual(0);
				expect(bar.height).toBeGreaterThanOrEqual(0);
				expect(bar.x + bar.width).toBeLessThanOrEqual(width + 1e-8);
				expect(bar.y + bar.height).toBeLessThanOrEqual(height + 1e-8);
			}
		}
	});
});
