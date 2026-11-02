const currencyFormatter = new Intl.NumberFormat('de-DE', {
	style: 'currency',
	currency: 'EUR',
	maximumFractionDigits: 2
});
const quantityFormatter = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 2 });

export function money(value: number | null | undefined): string {
	return value == null ? '—' : currencyFormatter.format(value);
}
export function quantity(value: number, unit: string): string {
	return `${quantityFormatter.format(value)}${unit === 'each' ? '' : ` ${unit}`}`;
}
