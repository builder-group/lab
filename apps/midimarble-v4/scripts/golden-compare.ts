// Compares two golden dumps from `golden-dump.ts` exactly and names the first difference in each file.
// Usage: tsx scripts/golden-compare.ts <golden-dir> <other-dir> [--all]
//   Stops at the first differing file unless --all. Exits 1 on any difference.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

function firstDifference(a: unknown, b: unknown, path: string): string | null {
	if (Object.is(a, b)) return null;
	if (Array.isArray(a) && Array.isArray(b)) {
		for (let index = 0; index < Math.min(a.length, b.length); index++) {
			const found = firstDifference(a[index], b[index], `${path}[${index}]`);
			if (found != null) return found;
		}
		return a.length === b.length ? null : `${path}: ${a.length} items, now ${b.length}`;
	}
	if (a != null && b != null && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
		const left = a as Record<string, unknown>;
		const right = b as Record<string, unknown>;
		for (const key of [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()) {
			if (!(key in left)) return `${path}.${key}: absent, now ${JSON.stringify(right[key])?.slice(0, 200)}`;
			if (!(key in right)) return `${path}.${key}: ${JSON.stringify(left[key])?.slice(0, 200)}, now absent`;
			const found = firstDifference(left[key], right[key], `${path}.${key}`);
			if (found != null) return found;
		}
		return null;
	}
	return `${path}: ${JSON.stringify(a)?.slice(0, 200)}, now ${JSON.stringify(b)?.slice(0, 200)}`;
}

function files(root: string): string[] {
	return readdirSync(root)
		.filter((name) => statSync(join(root, name)).isDirectory())
		.sort()
		.flatMap((name) => readdirSync(join(root, name)).sort().map((file) => join(name, file)));
}

const [goldenDir, otherDir] = process.argv.slice(2);
const isAll = process.argv.includes('--all');
if (goldenDir == null || otherDir == null) throw new Error('Usage: golden-compare <golden-dir> <other-dir> [--all]');

const names = [...new Set([...files(goldenDir), ...files(otherDir)])].sort();
let differences = 0;
for (const name of names) {
	const [left, right] = [join(goldenDir, name), join(otherDir, name)];
	if (!existsSync(left) || !existsSync(right)) {
		console.log(`${name}: only in ${existsSync(left) ? goldenDir : otherDir}`);
		differences += 1;
	} else {
		const [leftText, rightText] = [readFileSync(left, 'utf8'), readFileSync(right, 'utf8')];
		if (leftText === rightText) continue;
		console.log(`${name}: ${firstDifference(JSON.parse(leftText), JSON.parse(rightText), '$') ?? 'same values, different bytes'}`);
		differences += 1;
	}
	if (!isAll) break;
}
if (differences > 0) process.exit(1);
console.log(`Identical: ${names.length} files`);
