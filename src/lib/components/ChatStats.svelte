<script lang="ts">
import { onMount } from 'svelte';
import * as m from '$lib/paraglide/messages';
import { getLocale } from '$lib/paraglide/runtime';
import type { ChatData } from '$lib/state.svelte';
import type { PersonStats, StatsResult } from '$lib/workers/stats-worker';
import Icon from './Icon.svelte';
import IconButton from './IconButton.svelte';

interface Props {
	chat: ChatData;
	onClose: () => void;
}

let { chat, onClose }: Props = $props();

let stats = $state<StatsResult | null>(null);
let isLoading = $state(true);
let error = $state<string | null>(null);

const locale = $derived(getLocale());

onMount(() => {
	// Create worker using Vite's recommended syntax for ES module workers
	const worker = new Worker(
		new URL('../workers/stats-worker.ts', import.meta.url),
		{ type: 'module' },
	);

	worker.onmessage = (event: MessageEvent<StatsResult>) => {
		stats = event.data;
		isLoading = false;
		worker.terminate();
	};

	worker.onerror = (err) => {
		console.error('Stats worker error:', err);
		error = m.stats_failed();
		isLoading = false;
		worker.terminate();
	};

	// Serialize messages for the worker (Date objects don't survive postMessage)
	const serializedMessages = chat.messages.map((msg) => ({
		timestamp: msg.timestamp.toISOString(),
		sender: msg.sender,
		isSystemMessage: msg.isSystemMessage,
		content: msg.content,
		isMediaMessage: msg.isMediaMessage,
		mediaType: msg.mediaType,
		hasFile: !!(msg as { mediaFile?: unknown }).mediaFile,
	}));

	worker.postMessage({
		messages: serializedMessages,
		messageCount: chat.messageCount,
		startDate: chat.startDate?.toISOString() ?? null,
		endDate: chat.endDate?.toISOString() ?? null,
	});

	return () => {
		worker.terminate();
	};
});

function formatDuration(startDate: Date | null, endDate: Date | null): string {
	if (!startDate || !endDate) return m.stats_unknown();

	const diff = endDate.getTime() - startDate.getTime();
	const days = Math.floor(diff / (1000 * 60 * 60 * 24));
	const months = Math.floor(days / 30);
	const years = Math.floor(days / 365);

	if (years > 0) {
		const remainingMonths = months % 12;
		const yearLabel = years > 1 ? m.stats_years() : m.stats_year();
		const monthLabel =
			remainingMonths !== 1 ? m.stats_months() : m.stats_month();
		return `${years} ${yearLabel}, ${remainingMonths} ${monthLabel}`;
	}
	if (months > 0) {
		const remainingDays = days % 30;
		const monthLabel = months > 1 ? m.stats_months() : m.stats_month();
		const dayLabel = remainingDays !== 1 ? m.stats_days() : m.stats_day();
		return `${months} ${monthLabel}, ${remainingDays} ${dayLabel}`;
	}
	const dayLabel = days !== 1 ? m.stats_days() : m.stats_day();
	return `${days} ${dayLabel}`;
}

function formatHour(hour: number): string {
	// Use locale-aware time formatting
	const date = new Date();
	date.setHours(hour, 0, 0, 0);
	return date.toLocaleTimeString(locale, { hour: 'numeric', hour12: true });
}

const participantEntries = $derived(
	stats
		? Object.entries(stats.messagesByParticipant).sort((a, b) => b[1] - a[1])
		: [],
);

const maxMessages = $derived(
	stats ? Math.max(...Object.values(stats.messagesByParticipant)) : 0,
);

const maxHourCount = $derived(stats ? Math.max(...stats.messagesByHour) : 0);

function formatSeconds(total: number | null): string {
	if (total === null) return '–';
	const s = Math.round(total);
	const h = Math.floor(s / 3600);
	const min = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	if (h > 0) return `${h}h ${String(min).padStart(2, '0')}m`;
	if (min > 0) return `${min}m ${String(sec).padStart(2, '0')}s`;
	return `${sec}s`;
}

// People ordered like the "messages by participant" list
const peopleColumns = $derived(
	stats
		? participantEntries
				.map(([name]) => name)
				.filter((name) => stats?.people[name])
		: [],
);

type Row = {
	label: string;
	isViewOnce?: boolean;
	value: (p: PersonStats) => string;
	show?: (s: StatsResult) => boolean;
};

const n = (v: number) => v.toLocaleString(locale);
const any = (key: keyof PersonStats) => (s: StatsResult) =>
	Object.values(s.people).some((p) => Number(p[key]) > 0);

const personRows: Row[] = [
	{ label: m.stats_messages(), value: (p) => n(p.messages) },
	{ label: m.stats_row_words(), value: (p) => n(p.words) },
	{ label: m.stats_row_emojis(), value: (p) => n(p.emojis) },
	{ label: m.stats_row_photos(), value: (p) => n(p.photos) },
	{ label: m.stats_row_videos(), value: (p) => n(p.videos) },
	{
		label: m.stats_row_view_once_photos(),
		isViewOnce: true,
		value: (p) => n(p.viewOncePhotos),
		show: any('viewOncePhotos'),
	},
	{
		label: m.stats_row_view_once_videos(),
		isViewOnce: true,
		value: (p) => n(p.viewOnceVideos),
		show: any('viewOnceVideos'),
	},
	{ label: m.stats_row_voice_notes(), value: (p) => n(p.voiceNotes) },
	{ label: m.stats_row_stickers(), value: (p) => n(p.stickers) },
	{ label: m.stats_row_gifs(), value: (p) => n(p.gifs), show: any('gifs') },
	{
		label: m.stats_row_documents(),
		value: (p) => n(p.documents),
		show: any('documents'),
	},
	{ label: m.stats_row_links(), value: (p) => n(p.links) },
	{
		label: m.stats_row_deleted(),
		value: (p) => n(p.deleted),
		show: any('deleted'),
	},
	{
		label: m.stats_row_edited(),
		value: (p) => n(p.edited),
		show: any('edited'),
	},
	{
		label: m.stats_row_calls_made(),
		value: (p) => n(p.callsMade),
		show: any('callsMade'),
	},
	{
		label: m.stats_row_video_calls_made(),
		value: (p) => n(p.videoCallsMade),
		show: any('videoCallsMade'),
	},
	{
		label: m.stats_row_calls_answered(),
		value: (p) => n(p.callsAnswered),
		show: any('callsMade'),
	},
	{
		label: m.stats_row_calls_missed(),
		value: (p) => n(p.callsMissed),
		show: any('callsMade'),
	},
	{
		label: m.stats_row_talk_time(),
		value: (p) => formatSeconds(p.callSeconds),
		show: any('callsMade'),
	},
	{
		label: m.stats_row_conversations_started(),
		value: (p) => n(p.conversationsStarted),
	},
	{
		label: m.stats_row_reply_time(),
		value: (p) => formatSeconds(p.medianReplySeconds),
	},
];

const visibleRows = $derived(
	stats
		? personRows.filter((row) => !row.show || (stats && row.show(stats)))
		: [],
);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
	onclick={onClose}
	onkeydown={(e) => e.key === 'Escape' && onClose()}
	role="presentation"
>
	<div
		class="bg-white dark:bg-gray-900 rounded-xl shadow-2xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-hidden"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
		role="dialog"
		aria-modal="true"
		aria-labelledby="stats-title"
		tabindex="-1"
	>
		<!-- Header -->
		<div class="p-6 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
			<h2 id="stats-title" class="text-xl font-bold text-gray-800 dark:text-white">{m.stats_title()}</h2>
			<IconButton size="lg" onclick={onClose} aria-label={m.stats_close()}>
				<Icon name="close" size="lg" />
			</IconButton>
		</div>

		<!-- Content -->
		<div class="p-6 overflow-y-auto max-h-[calc(90vh-80px)]">
			{#if isLoading}
				<!-- Loading state -->
				<div class="flex flex-col items-center justify-center py-16">
					<div class="w-12 h-12 border-4 border-gray-200 dark:border-gray-700 border-t-[var(--color-whatsapp-teal)] rounded-full animate-spin mb-4"></div>
					<p class="text-gray-500 dark:text-gray-400">{m.stats_computing()}</p>
				</div>
			{:else if error}
				<!-- Error state -->
				<div class="flex flex-col items-center justify-center py-16">
				<Icon name="alert" size="2xl" class="text-red-500 mb-4" />
					<p class="text-red-500">{error}</p>
				</div>
			{:else if stats}
				<!-- Overview cards -->
				<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
					<div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 text-center">
						<div class="text-2xl font-bold text-[var(--color-whatsapp-teal)]">
							{chat.messageCount.toLocaleString()}
						</div>
						<div class="text-sm text-gray-500 dark:text-gray-400">{m.stats_messages()}</div>
					</div>
					<div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 text-center">
						<div class="text-2xl font-bold text-[var(--color-whatsapp-teal)]">
							{chat.participants.length}
						</div>
						<div class="text-sm text-gray-500 dark:text-gray-400">{m.stats_participants()}</div>
					</div>
					<div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 text-center">
						<div class="text-2xl font-bold text-[var(--color-whatsapp-teal)]">
							{stats.avgMessagesPerDay}
						</div>
						<div class="text-sm text-gray-500 dark:text-gray-400">{m.stats_avg_day()}</div>
					</div>
					<div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 text-center">
						<div class="text-2xl font-bold text-[var(--color-whatsapp-teal)]">
							{chat.mediaCount}
						</div>
						<div class="text-sm text-gray-500 dark:text-gray-400">{m.stats_media()}</div>
					</div>
				</div>

				<!-- Duration -->
				<div class="mb-8">
					<h3 class="text-lg font-semibold text-gray-800 dark:text-white mb-2">{m.stats_duration()}</h3>
					<p class="text-gray-600 dark:text-gray-300">
						{formatDuration(chat.startDate, chat.endDate)}
					</p>
					<p class="text-sm text-gray-500 dark:text-gray-400">
						{chat.startDate?.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' })}
						→
						{chat.endDate?.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' })}
					</p>
				</div>

				<!-- Messages by participant -->
				<div class="mb-8">
					<h3 class="text-lg font-semibold text-gray-800 dark:text-white mb-4">{m.stats_messages_by_participant()}</h3>
					<div class="space-y-3">
						{#each participantEntries as [name, count] (name)}
							<div>
								<div class="flex justify-between items-center mb-1">
									<span class="text-sm text-gray-700 dark:text-gray-300 truncate">{name}</span>
									<span class="text-sm text-gray-500 dark:text-gray-400">{count.toLocaleString()}</span>
								</div>
								<div class="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
									<div
										class="h-full bg-[var(--color-whatsapp-teal)] rounded-full transition-all"
										style="width: {(count / maxMessages) * 100}%"
									></div>
								</div>
							</div>
						{/each}
					</div>
				</div>

				<!-- Per person comparison -->
				<div class="mb-8">
					<h3 class="text-lg font-semibold text-gray-800 dark:text-white mb-4">{m.stats_per_person()}</h3>
					<div class="overflow-x-auto -mx-2">
						<table class="w-full text-sm">
							<thead>
								<tr class="border-b border-gray-200 dark:border-gray-700">
									<th class="text-left font-normal text-gray-500 dark:text-gray-400 px-2 py-2"></th>
									{#each peopleColumns as name (name)}
										<th class="text-right font-semibold text-gray-700 dark:text-gray-200 px-2 py-2 max-w-[9rem] truncate" title={name}>{name}</th>
									{/each}
								</tr>
							</thead>
							<tbody>
								{#each visibleRows as row (row.label)}
									<tr class="border-b border-gray-100 dark:border-gray-800 last:border-b-0">
										<td class="text-gray-600 dark:text-gray-300 px-2 py-1.5">{row.label}</td>
										{#each peopleColumns as name (name)}
											<td class="text-right tabular-nums text-gray-800 dark:text-gray-100 px-2 py-1.5">{row.value(stats.people[name])}</td>
										{/each}
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
					{#if visibleRows.some((row) => row.isViewOnce)}
						<p class="mt-2 text-xs text-gray-400 dark:text-gray-500">{m.stats_view_once_note()}</p>
					{/if}
				</div>

				<!-- Calls -->
				{#if stats.calls.total > 0}
					<div class="mb-8">
						<h3 class="text-lg font-semibold text-gray-800 dark:text-white mb-4">{m.stats_calls()}</h3>
						<div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-3">
							<div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 text-center">
								<div class="text-2xl font-bold text-[var(--color-whatsapp-teal)]">{n(stats.calls.total)}</div>
								<div class="text-sm text-gray-500 dark:text-gray-400">{m.stats_calls_total()}</div>
							</div>
							<div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 text-center">
								<div class="text-2xl font-bold text-[var(--color-whatsapp-teal)]">{n(stats.calls.answered)}</div>
								<div class="text-sm text-gray-500 dark:text-gray-400">{m.stats_calls_answered()}</div>
							</div>
							<div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 text-center">
								<div class="text-2xl font-bold text-[var(--color-whatsapp-teal)]">{n(stats.calls.missed)}</div>
								<div class="text-sm text-gray-500 dark:text-gray-400">{m.stats_calls_missed()}</div>
							</div>
							<div class="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 text-center">
								<div class="text-2xl font-bold text-[var(--color-whatsapp-teal)]">{formatSeconds(stats.calls.totalSeconds)}</div>
								<div class="text-sm text-gray-500 dark:text-gray-400">{m.stats_talk_time()}</div>
							</div>
						</div>
						<p class="text-sm text-gray-600 dark:text-gray-300">
							{m.stats_voice_video({ voice: n(stats.calls.voice), video: n(stats.calls.video) })}
						</p>
						{#if stats.calls.longest}
							<p class="text-sm text-gray-600 dark:text-gray-300 mt-1">
								{m.stats_longest_call({
									duration: formatSeconds(stats.calls.longest.seconds),
									caller: stats.calls.longest.caller,
									date: new Date(stats.calls.longest.timestamp).toLocaleDateString(locale, { year: 'numeric', month: 'short', day: 'numeric' }),
								})}
							</p>
						{/if}
					</div>
				{/if}

				<!-- Busiest day -->
				{#if stats.busiestDay}
					<div class="mb-8">
						<h3 class="text-lg font-semibold text-gray-800 dark:text-white mb-2">{m.stats_busiest_day()}</h3>
						<p class="text-gray-600 dark:text-gray-300">
							{m.stats_busiest_day_value({
								date: new Date(`${stats.busiestDay.date}T00:00:00`).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' }),
								count: n(stats.busiestDay.count),
							})}
						</p>
					</div>
				{/if}

				<!-- Most active hour -->
				<div class="mb-8">
					<h3 class="text-lg font-semibold text-gray-800 dark:text-white mb-2">{m.stats_busiest_hour()}</h3>
					<p class="text-gray-600 dark:text-gray-300">
						{formatHour(stats.mostActiveHour)}
					</p>
				</div>

				<!-- Activity by hour -->
				<div>
					<h3 class="text-lg font-semibold text-gray-800 dark:text-white mb-4">{m.stats_activity_by_hour()}</h3>
					<div class="flex items-end gap-0.5 h-24">
						{#each stats.messagesByHour as count, hour (hour)}
							{@const height = maxHourCount > 0 ? (count / maxHourCount) * 100 : 0}
							<div
								class="flex-1 bg-[var(--color-whatsapp-teal)] hover:bg-[var(--color-whatsapp-dark-green)] rounded-t transition-all cursor-pointer group relative min-h-[2px]"
								style="height: {height}%"
							>
								<!-- Tooltip -->
								<div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-gray-800 text-white text-xs px-2 py-1 rounded whitespace-nowrap z-10">
									{hour}:00 - {m.stats_hour_messages({ count: count.toLocaleString(locale) })}
								</div>
							</div>
						{/each}
					</div>
					<div class="flex justify-between mt-1 text-xs text-gray-400 dark:text-gray-500">
						<span>{m.stats_hour_12am()}</span>
						<span>{m.stats_hour_6am()}</span>
						<span>{m.stats_hour_12pm()}</span>
						<span>{m.stats_hour_6pm()}</span>
						<span>{m.stats_hour_11pm()}</span>
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>
