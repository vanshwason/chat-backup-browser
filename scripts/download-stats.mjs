#!/usr/bin/env node
// Download counts per release and platform, from GitHub's public API.
// The app itself sends nothing; this is the only usage signal we collect.
// Usage: npm run stats:downloads [-- owner/repo]

const repo = process.argv[2] ?? 'vanshwason/chat-backup-browser';
const res = await fetch(`https://api.github.com/repos/${repo}/releases?per_page=100`, {
	headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'download-stats-script' },
});
if (!res.ok) {
	console.error(`GitHub API ${res.status}: ${await res.text()}`);
	process.exit(1);
}

const platformOf = (name) =>
	/\.(exe|msi)$/i.test(name)
		? 'Windows'
		: /\.(dmg|pkg)$/i.test(name) || /mac.*\.zip$/i.test(name)
			? 'Mac'
			: /\.(AppImage|deb|rpm)$/i.test(name)
				? 'Linux'
				: null; // update metadata (.yml, .blockmap) is not a download

const totals = { Windows: 0, Mac: 0, Linux: 0 };
for (const release of await res.json()) {
	const row = { Windows: 0, Mac: 0, Linux: 0 };
	for (const asset of release.assets) {
		const platform = platformOf(asset.name);
		if (platform) row[platform] += asset.download_count;
	}
	for (const k of Object.keys(totals)) totals[k] += row[k];
	const sum = row.Windows + row.Mac + row.Linux;
	console.log(
		`${release.tag_name.padEnd(10)} ${release.published_at?.slice(0, 10) ?? '          '}  total ${String(sum).padStart(5)}  win ${row.Windows}  mac ${row.Mac}  linux ${row.Linux}`,
	);
}
console.log(`\nAll releases: Windows ${totals.Windows}, Mac ${totals.Mac}, Linux ${totals.Linux}`);
