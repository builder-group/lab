import { useFeatureState } from 'feature-react/state';
import { ExternalLink, RefreshCw, Search } from 'lucide-react';
import React from 'react';
import { Button, Modal, NumberField } from '../../components/ui';
import { isDesktop } from '../../environment/desktop';
import { openLink } from '../../environment/open-link';
import { money } from '../../lib/format';
import type { TCommand, TPart, TProject } from '../project/model';
import type { TIdealoProduct } from './idealo';
import type { TMarketQuote } from './market-types';
import { adoptQuoteEstimate, createQuoteObservation } from './observations';
import { pricingCx, type PricingCx } from './PricingCx';

interface TPricingSectionProps {
	part: TPart;
	project: TProject;
	onCommands(commands: TCommand[]): boolean;
	cx?: PricingCx;
}
export const PricingSection: React.FC<TPricingSectionProps> = (props) => (
	<PricingContent key={`${props.part.id}:${props.part.name}`} {...props} />
);
const PricingContent: React.FC<TPricingSectionProps> = ({
	part,
	project,
	onCommands,
	cx = pricingCx
}) => {
	const status = useFeatureState(cx.$status);
	const results = useFeatureState(cx.$results);
	const busy = useFeatureState(cx.$busy);
	const error = useFeatureState(cx.$error);
	const [query, setQuery] = React.useState(part.name);
	const [requestedQuery, setRequestedQuery] = React.useState<string | null>(null);
	const [selected, setSelected] = React.useState<TIdealoProduct | null>(null);
	const [confirmed, setConfirmed] = React.useState(false);
	const [pack, setPack] = React.useState<number | null>(part.purchasePackQuantity ?? 1);
	const [offer, setOffer] = React.useState<TMarketQuote | null>(null);
	const [localError, setLocalError] = React.useState<string | null>(null);
	const [settings, setSettings] = React.useState(false);
	const canSearch = ['ready', 'connected'].includes(status.state);
	const requestRef = React.useRef(0);
	const mountedRef = React.useRef(true);
	React.useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);
	const quotes = project.quotes
		.filter((quote) => quote.partId === part.id)
		.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
	const startSearch = (): void => {
		if (busy || !query.trim()) return;
		requestRef.current++;
		setSelected(null);
		setOffer(null);
		setConfirmed(false);
		setRequestedQuery(query);
		void cx.search(query);
	};
	const lookup = async (): Promise<void> => {
		if (!selected || !confirmed) return;
		const generation = ++requestRef.current;
		setOffer(null);
		const result = await cx.offers(part.id, selected);
		if (mountedRef.current && generation === requestRef.current) setOffer(result);
	};
	const visibleError = localError ?? (requestedQuery !== null ? error : null);
	return (
		<section className="pricing-section">
			<div className="actions">
				<Button variant="ghost" onClick={() => setSettings(true)}>
					{status.state === 'connected' ? 'Idealo settings' : 'Connect Idealo'}
				</Button>
			</div>
			{settings && <IntegrationSettings cx={cx} onClose={() => setSettings(false)} />}
			{visibleError && (
				<p role="alert" className="error">
					{visibleError}
				</p>
			)}
			{canSearch && (
				<div className="search-row">
					<input
						aria-label="Search Idealo products"
						value={query}
						onChange={(event) => setQuery(event.currentTarget.value)}
						placeholder="Exact manufacturer and model"
						onKeyDown={(event) => {
							if (event.key === 'Enter') startSearch();
						}}
					/>
					<Button
						icon={<Search size={14} />}
						disabled={
							!isDesktop() ||
							busy ||
							!query.trim() ||
							!['ready', 'connected'].includes(status.state)
						}
						onClick={startSearch}
					>
						Search
					</Button>
				</div>
			)}
			{busy && (
				<p role="status" className="muted">
					Looking up Idealo…{' '}
					<Button
						variant="ghost"
						onClick={() => {
							void cx.cancel();
						}}
					>
						Cancel
					</Button>
				</p>
			)}
			{canSearch && requestedQuery === query && results.length > 0 && !selected && (
				<div className="price-results">
					{results.map((product) => (
						<div key={product.productRef} className="price-result">
							<div>
								<strong>{product.name}</strong>
								<span className="muted"> {product.price ?? 'Price unavailable'}</span>
							</div>
							<Button
								disabled={busy}
								onClick={() => {
									requestRef.current++;
									setSelected(product);
									setConfirmed(false);
									setOffer(null);
								}}
							>
								Select
							</Button>
						</div>
					))}
				</div>
			)}
			{canSearch && requestedQuery === query && !busy && !error && results.length === 0 && (
				<p className="muted">No matching products.</p>
			)}
			{canSearch && selected && (
				<div className="price-match">
					<div className="section-heading">
						<strong>{selected.name}</strong>
						<Button
							variant="ghost"
							icon={<ExternalLink size={13} />}
							onClick={() => {
								void openLink(selected.url);
							}}
						>
							Product page
						</Button>
					</div>
					<label className="checkbox-row">
						<input
							type="checkbox"
							checked={confirmed}
							onChange={(event) => setConfirmed(event.currentTarget.checked)}
						/>
						I checked the exact model, variant and pack size.
					</label>
					<NumberField
						label={
							part.unit === 'm' ? 'Metres included in the offer' : 'Items included in the offer'
						}
						value={pack}
						min={0.001}
						required
						onChange={(value) => {
							setPack(value);
							setOffer(null);
						}}
					/>
					<Button
						icon={<RefreshCw size={14} />}
						disabled={!confirmed || pack == null || pack <= 0 || busy}
						onClick={() => {
							void lookup();
						}}
					>
						Get current offer
					</Button>
					<Button
						variant="ghost"
						onClick={() => {
							requestRef.current++;
							setSelected(null);
							setOffer(null);
						}}
					>
						Choose another
					</Button>
				</div>
			)}
			{canSearch && offer && (
				<div className="price-observation">
					<p>
						<strong>{money(offer.unitPrice)}</strong>
						{pack != null && pack !== 1
							? ` per ${pack} ${part.unit === 'm' ? 'm' : 'items'}`
							: ''}{' '}
						· Shipping {offer.shippingPrice == null ? 'unknown' : money(offer.shippingPrice)}
						{offer.seller ? ` · ${offer.seller}` : ''}
					</p>
					<p className="muted">
						VAT: {offer.taxBasis}. Condition: {offer.condition}.{' '}
						{offer.availability === 'unknown' ? 'Availability unconfirmed.' : ''}
					</p>
					<details>
						<summary>Offer scope</summary>
						<p style={{ whiteSpace: 'pre-wrap' }}>{offer.notes}</p>
					</details>
					<Button
						disabled={busy || !confirmed || pack == null || pack <= 0}
						onClick={() => {
							try {
								const observation = createQuoteObservation(project, part, offer, pack ?? 0);
								if (onCommands(observation.commands) !== false) {
									setOffer(null);
									setSelected(null);
									setRequestedQuery(null);
									setLocalError(null);
								}
							} catch (value) {
								setLocalError(value instanceof Error ? value.message : String(value));
							}
						}}
					>
						Save observation
					</Button>
				</div>
			)}
			{quotes.length > 0 ? (
				<div className="price-history">
					{quotes.slice(0, 5).map((quote) => (
						<div key={quote.id} className="price-result">
							<div>
								<strong>
									{money(quote.price / quote.packQuantity)} / {quote.unit === 'm' ? 'm' : 'item'}
								</strong>
								<p className="muted">
									{new Date(quote.observedAt).toLocaleDateString()} · Offer {quote.packQuantity}{' '}
									{quote.unit === 'm' ? 'm' : 'items'} · {quote.seller ?? 'Seller unknown'} ·
									Shipping {quote.shipping == null ? 'unknown' : money(quote.shipping)} · VAT{' '}
									{quote.tax}
								</p>
							</div>
							<Button
								variant="ghost"
								disabled={
									quote.tax === 'net' || quote.condition === 'used' || quote.unit !== part.unit
								}
								onClick={() => {
									try {
										onCommands([adoptQuoteEstimate(part, quote)]);
									} catch (value) {
										setLocalError(value instanceof Error ? value.message : String(value));
									}
								}}
							>
								Use price
							</Button>
							{quote.packQuantity > 1 && (
								<Button
									variant="ghost"
									disabled={
										quote.tax === 'net' || quote.condition === 'used' || quote.unit !== part.unit
									}
									onClick={() => {
										try {
											onCommands([adoptQuoteEstimate(part, quote, { usePackSize: true })]);
										} catch (value) {
											setLocalError(value instanceof Error ? value.message : String(value));
										}
									}}
								>
									Use price and pack
								</Button>
							)}
						</div>
					))}
				</div>
			) : null}
		</section>
	);
};
export const IntegrationSettings: React.FC<{ onClose(): void; cx?: PricingCx }> = ({
	onClose,
	cx = pricingCx
}) => {
	const status = useFeatureState(cx.$status);
	const error = useFeatureState(cx.$error);
	const connecting = ['connecting', 'authorizing'].includes(status.state);
	return (
		<Modal title="Idealo connection" onClose={onClose}>
			<p>{status.message}</p>
			{error && (
				<p className="error" role="alert">
					{error}
				</p>
			)}{' '}
			<details className="integration-details">
				<summary>Connection details</summary>
				<p>
					Product search and offers use your Idealo account. Access and service terms are handled by
					Idealo.
				</p>
				<p>Sign-in stays in the OS Keychain. Project exports include saved observations.</p>
				<p>
					{status.callsRemaining} calls remain in the local counter. Your account’s service quota
					applies.
				</p>
			</details>
			<div className="actions">
				{connecting ? (
					<Button
						onClick={() => {
							void cx.cancel();
						}}
					>
						Cancel connection
					</Button>
				) : (
					<Button
						variant="primary"
						disabled={!isDesktop() || status.state === 'connected'}
						onClick={() => {
							void cx.connect();
						}}
					>
						Connect Idealo
					</Button>
				)}
				<Button
					disabled={!isDesktop() || connecting}
					onClick={() => {
						void cx.disconnect();
					}}
				>
					Disconnect and clear sign-in
				</Button>
			</div>
		</Modal>
	);
};
