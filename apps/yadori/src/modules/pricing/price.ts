/** Parse an explicit EUR price, not a whole offer sentence. Unknown or ambiguous input stays null. */
export function parseGermanPrice(value: unknown): number | null {
	if (typeof value === 'number')
		return Number.isFinite(value) && value >= 0 ? roundPrice(value) : null;
	if (typeof value !== 'string') return null;
	let text = value.trim();
	if (/^(?:kostenlos|gratis|versandkostenfrei)$/i.test(text)) return 0;
	text = text
		.replace(/^(?:ab|from|ca\.?)\s+/i, '')
		.replace(/^(?:€|EUR)\s*/i, '')
		.replace(/\s*(?:€|EUR)$/i, '')
		.trim();
	if (!text) return null;
	text = text.replace(/^(\d+(?:\.\d{3})*),-$/, '$1,00');
	if (/^\d{1,3}(?:[\s\u00a0\u202f]\d{3})+(?:,\d{1,2})?$/.test(text))
		text = text.replace(/[\s\u00a0\u202f]/g, '');
	let normalized: string;
	if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(text))
		normalized = text.replace(/\./g, '').replace(',', '.');
	else if (/^\d+(?:,\d{1,2})?$/.test(text)) normalized = text.replace(',', '.');
	else if (/^\d+\.\d{1,2}$/.test(text)) normalized = text;
	else return null;
	const price = Number(normalized);
	return Number.isFinite(price) && price >= 0 ? roundPrice(price) : null;
}

export function roundPrice(value: number): number {
	return Math.round((value + Number.EPSILON) * 100) / 100;
}
