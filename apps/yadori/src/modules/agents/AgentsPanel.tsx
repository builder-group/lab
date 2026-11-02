import { useFeatureState } from 'feature-react/state';
import { Check, Copy, Square, Terminal, X } from 'lucide-react';
import React from 'react';
import { Button, Modal } from '../../components/ui';
import { type AgentCx } from './AgentCx';

export const AgentsPanel: React.FC<{ cx: AgentCx; onClose(): void }> = ({ cx, onClose }) => {
	const capabilities = useFeatureState(cx.$capabilities);
	const jobs = useFeatureState(cx.$jobs);
	const proposals = useFeatureState(cx.$proposals);
	const error = useFeatureState(cx.$error);
	const [prompt, setPrompt] = React.useState('');
	const [copied, setCopied] = React.useState(false);
	const active = jobs.find((job) => job.state === 'running');
	const config = cx.mcpConfiguration();
	return (
		<Modal title="Local assistant" onClose={onClose} wide>
			{error && (
				<p role="alert" className="error">
					{error}
				</p>
			)}
			<div className="section-heading">
				<h3>Codex CLI</h3>
				<span className="muted">{capabilities?.codexPath ? 'Installed' : 'Not detected'}</span>
			</div>
			{!capabilities?.codexPath && (
				<p className="muted">
					Install Codex CLI and sign in using its terminal command. Tasks use your CLI account.
				</p>
			)}
			<label className="field">
				<span>Task</span>
				<textarea
					rows={3}
					value={prompt}
					placeholder="Check the selected battery and charging arrangement…"
					onChange={(event) => setPrompt(event.currentTarget.value)}
					disabled={!!active}
				/>
			</label>
			<div className="actions">
				<Button
					icon={<Terminal size={14} />}
					variant="primary"
					disabled={!capabilities?.codexPath || !!active || !prompt.trim()}
					onClick={() => {
						void cx.start(prompt);
					}}
				>
					Run task
				</Button>
				{active && (
					<Button
						icon={<Square size={12} />}
						onClick={() => {
							void cx.cancel();
						}}
					>
						Cancel
					</Button>
				)}
			</div>
			{jobs.slice(0, 3).map((job) => (
				<p key={job.id} role="status">
					<strong>
						{job.state === 'running'
							? 'Working'
							: job.state === 'completed'
								? 'Completed'
								: job.state === 'cancelled'
									? 'Cancelled'
									: 'Failed'}
					</strong>{' '}
					· {job.detail}
				</p>
			))}
			{proposals.length > 0 && (
				<section>
					<h3>Proposals</h3>
					{proposals.map((proposal) => (
						<ProposalCard
							key={proposal.id}
							cx={cx}
							proposal={proposal}
							revisionKey={cx.getProjectRevisionKey()}
						/>
					))}
				</section>
			)}
			<details>
				<summary>Connect an external assistant over MCP</summary>
				<p className="muted">
					The app binary serves project reads and reviewable proposals over stdio. Add this
					configuration to your assistant; changes return here for approval.
				</p>
				<pre style={{ fontSize: 11, maxHeight: 180, overflow: 'auto' }}>
					{config || 'Available in the desktop app.'}
				</pre>
				<Button
					icon={<Copy size={14} />}
					disabled={!config}
					onClick={() => {
						void navigator.clipboard
							.writeText(config)
							.then(() => {
								setCopied(true);
								setTimeout(() => setCopied(false), 1800);
							})
							.catch(() => cx.$error.set('Could not copy the configuration.'));
					}}
				>
					{copied ? 'Copied' : 'Copy configuration'}
				</Button>
			</details>
		</Modal>
	);
};

interface TProposalCardProps {
	cx: AgentCx;
	proposal: import('../../environment/desktop').TAgentProposal;
	revisionKey: string;
}
const ProposalCard: React.FC<TProposalCardProps> = ({ cx, proposal, revisionKey }) => {
	const inspection = React.useMemo(() => {
		if (!revisionKey) return { changes: [], issue: 'Open a project first.' };
		try {
			return { changes: [...new Set(cx.inspectProposal(proposal).changes)], issue: null };
		} catch (value) {
			return { changes: [], issue: value instanceof Error ? value.message : String(value) };
		}
	}, [cx, proposal, revisionKey]);
	const counts = new Map<string, number>();
	for (const command of proposal.commands) {
		if (
			command != null &&
			typeof command === 'object' &&
			'type' in command &&
			typeof command.type === 'string'
		) {
			const category = command.type.split('.')[0] ?? 'other';
			counts.set(category, (counts.get(category) ?? 0) + 1);
		}
	}
	const labels: Record<string, string> = {
		part: 'parts',
		instance: 'units',
		placement: 'placements',
		run: 'runs',
		source: 'sources',
		asset: 'assets',
		review: 'reviews',
		layout: 'layouts'
	};
	return (
		<article className="agent-proposal">
			<div className="section-heading">
				<strong>{proposalTime(proposal.createdAt)}</strong>
				<span className="muted">
					{proposal.commands.length} changes · revision {proposal.baseRevision} ·{' '}
					{proposal.id.slice(0, 6)}
				</span>
			</div>
			<div className="actions">
				<Button
					icon={<Check size={14} />}
					disabled={!!inspection.issue}
					onClick={() => {
						void cx.acceptProposal(proposal);
					}}
				>
					{proposal.commands.length ? 'Apply changes' : 'Mark reviewed'}
				</Button>
				<Button
					icon={<X size={14} />}
					variant="ghost"
					onClick={() => {
						void cx.dismiss(proposal);
					}}
				>
					Dismiss
				</Button>
			</div>
			{inspection.issue && <p className="error">{inspection.issue}</p>}
			<p className="muted">
				{[...counts].map(([type, count]) => `${count} ${labels[type] ?? type}`).join(' · ')}
			</p>
			<p style={{ whiteSpace: 'pre-wrap', maxHeight: 100, overflow: 'auto' }}>{proposal.summary}</p>
			{!inspection.issue && (
				<ul>
					{inspection.changes.slice(0, 5).map((change) => (
						<li key={change}>{change}</li>
					))}
				</ul>
			)}
			<details>
				<summary>All {proposal.commands.length} changes</summary>
				<ul style={{ maxHeight: 240, overflow: 'auto' }}>
					{inspection.changes.map((change) => (
						<li key={change}>{change}</li>
					))}
				</ul>
				<details>
					<summary>Command data</summary>
					<pre style={{ maxHeight: 240, overflow: 'auto', fontSize: 11 }}>
						{JSON.stringify(proposal.commands, null, 2)}
					</pre>
				</details>
			</details>
		</article>
	);
};
function proposalTime(value: string): string {
	const numeric = /^\d{10,13}$/.test(value)
		? Number(value) * (value.length === 10 ? 1000 : 1)
		: Date.parse(value);
	return Number.isFinite(numeric)
		? new Date(numeric).toLocaleString(undefined, {
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
				second: '2-digit'
			})
		: 'Time unavailable';
}
