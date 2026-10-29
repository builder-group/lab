import * as THREE from 'three';
import type { TSample } from '../project';

/** Reuses a fixed-capacity vertex buffer while a worker appends physically computed samples. */
export function updateTrajectoryLine(
	existing: THREE.Line | undefined,
	samples: TSample[],
	duration: number,
	color: string
): THREE.Line {
	const capacity = Math.max(2, Math.ceil((duration * 240) / 4) + 2);
	let line = existing;
	if (!line || line.geometry.getAttribute('position').count < capacity) {
		if (line) {
			line.geometry.dispose();
			(line.material as THREE.Material).dispose();
		}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
		geometry.setAttribute('lineDistance', new THREE.BufferAttribute(new Float32Array(capacity), 1));
		line = new THREE.Line(
			geometry,
			new THREE.LineDashedMaterial({
				color,
				transparent: true,
				opacity: 0.48,
				dashSize: 0.09,
				gapSize: 0.09,
				depthWrite: false
			})
		);
		line.raycast = () => {};
	}
	(line.material as THREE.LineDashedMaterial).color.set(color);
	const positions = line.geometry.getAttribute('position'),
		distances = line.geometry.getAttribute('lineDistance');
	let count = 0,
		distance = 0;
	const previous = new THREE.Vector3();
	for (let index = 0; index < samples.length; index += 4) {
		const sample = samples[index];
		if (!sample) continue;
		const point = new THREE.Vector3(...sample.position);
		if (count) distance += point.distanceTo(previous);
		positions.setXYZ(count, ...sample.position);
		distances.setX(count, distance);
		previous.copy(point);
		count++;
	}
	positions.needsUpdate = true;
	distances.needsUpdate = true;
	line.geometry.setDrawRange(0, count);
	line.geometry.computeBoundingSphere();
	line.userData['sampleCount'] = count;
	return line;
}
