const email = 'support@builder.group';

export const appConfig = {
	name: 'MidiMarble',
	website: 'https://builder.group',
	help: {
		discord: 'https://discord.com/invite/w4xE3bSjhQ',
		email,
		githubIssues: 'https://github.com/builder-group/lab/issues',
		mailto: (subject: string) =>
			`mailto:${email}?subject=${encodeURIComponent(`[MidiMarble] ${subject}`)}`
	},
	distribution: {
		website: 'https://builder.group',
		github: 'https://github.com/builder-group/lab'
	}
} as const;
