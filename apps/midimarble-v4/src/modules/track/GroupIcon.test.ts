import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GroupIcon } from './GroupIcon';

const icon = (group: React.ComponentProps<typeof GroupIcon>['group']): string => renderToStaticMarkup(React.createElement(GroupIcon, { group }));

describe('GroupIcon', () => {
	it("draws a live Pattern's shape and a plain Group's folder, so Flatten changes it", () => {
		const zigzag = icon({ pattern: { kind: 'zigzag', hitIds: [], width: 0.1, bounce: 0.5 } });
		expect(zigzag).toContain('mm-group-icon');
		expect(zigzag).not.toBe(icon({ pattern: { kind: 'staircase', hitIds: [], width: 0.1, bounce: 0.5 } }));
		expect(icon({})).toContain('lucide-folder');
	});
});
