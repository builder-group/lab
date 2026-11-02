import { ArrowUpRight, X } from 'lucide-react';
import React from 'react';
import { Button, IconButton } from '../../../components/ui';
import { money } from '../../../lib/format';
import { getParts, type TPart, type TProject } from '../../project/model';
import type { PartsCx } from '../PartsCx';
import { PartArtwork } from './PartArtwork';

export const AlternativesSection: React.FC<{ part: TPart; project: TProject; cx: PartsCx }> = ({
	part,
	project,
	cx
}) => {
	const alternatives = project.alternatives.filter(
		(a) => a.aPartId === part.id || a.bPartId === part.id
	);
	const ids = alternatives.map((a) => (a.aPartId === part.id ? a.bPartId : a.aPartId));
	return (
		<>
			<div className="alternatives-list">
				{alternatives.map((a) => {
					const other = project.parts.find(
						(p) => p.id === (a.aPartId === part.id ? a.bPartId : a.aPartId)
					);
					if (!other) return null;
					const row = getParts(project).find((row) => row.part.id === other.id);
					return (
						<div className="alternative-row" key={a.id}>
							<button onClick={() => cx.open(other.id)}>
								<PartArtwork part={other} project={project} />
								<span>
									{other.name}
									<small>{money(row?.estimate)}</small>
								</span>
								<ArrowUpRight size={12} />
							</button>
							<Button
								disabled={other.buildState === 'in-build'}
								onClick={() => {
									if (
										cx.session.execute(
											[{ type: 'alternative.use', chosenId: other.id, replacedId: part.id }],
											'Use alternative'
										)
									) {
										cx.open(other.id, cx.$fullPage.get());
										cx.session.notify(`Using ${other.name}. Review its canvas connections.`);
									}
								}}
							>
								{other.buildState === 'in-build' ? 'In build' : 'Use instead'}
							</Button>
							<IconButton
								label="Unlink alternative"
								onClick={() =>
									cx.session.execute(
										[{ type: 'alternative.remove', id: a.id }],
										'Unlink alternative'
									)
								}
							>
								<X size={12} />
							</IconButton>
						</div>
					);
				})}
			</div>
			<select
				aria-label="Link alternative"
				value=""
				onChange={(e) => {
					if (e.target.value)
						cx.session.execute(
							[
								{
									type: 'alternative.add',
									alternative: {
										id: crypto.randomUUID(),
										aPartId: part.id,
										bPartId: e.target.value
									}
								}
							],
							'Link alternative'
						);
				}}
			>
				<option value="">Link another part as an alternative…</option>
				{project.parts
					.filter((p) => p.id !== part.id && !ids.includes(p.id) && p.buildState !== 'archived')
					.map((p) => (
						<option key={p.id} value={p.id}>
							{p.name}
						</option>
					))}
			</select>
		</>
	);
};
