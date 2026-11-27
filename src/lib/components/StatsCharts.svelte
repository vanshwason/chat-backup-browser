<script lang="ts">
import * as m from '$lib/paraglide/messages';
import { getLocale } from '$lib/paraglide/runtime';
import type { StatsResult } from '$lib/workers/stats-worker';

interface Props {
	stats: StatsResult;
	people: string[];
}

let { stats, people }: Props = $props();

const locale = getLocale();
const n = (value: number) => value.toLocaleString(locale);

// ── Messages per month ──
const months = $derived.by(() => {
	const byMonth = new Map<string, number>();
	for (const [date, count] of Object.entries(stats.messagesByDate)) {
		const key = date.slice(0, 7);
		byMonth.set(key, (byMonth.get(key) ?? 0) + count);
	}
	const keys = [...byMonth.keys()].sort();
	if (keys.length === 0) return [];
	// Fill empty months so gaps show as gaps
	const result: { key: string; count: number }[] = [];
	let [y, mo] = keys[0].split('-').map(Number);
	const last = keys[keys.length - 1];
	for (;;) {
		const key = `${y}-${String(mo).padStart(2, '0')}`;
		result.push({ key, count: byMonth.get(key) ?? 0 });
		if (key === last) break;
		mo++;
		if (mo > 12) {
			mo = 1;
			y++;
		}
	}
	return result;
});
const maxMonth = $derived(Math.max(1, ...months.map((x) => x.count)));
const monthLabel = (key: string, style: 'short' | 'long' = 'short') =>
	new Date(`${key}-01T00:00:00`).toLocaleDateString(locale, {
		month: style,
		year: 'numeric',
	});

// ── Calendar heatmap, one year at a time ──
const years = $derived(
	[
		...new Set(Object.keys(stats.messagesByDate).map((d) => d.slice(0, 4))),
	].sort(),
);
let chosenYear = $state<string | null>(null);
const year = $derived(
	chosenYear && years.includes(chosenYear)
		? chosenYear
		: (years.at(-1) ?? null),
);
const heatmap = $derived.by(() => {
	if (!year)
		return { weeks: [] as ({ key: string; count: number } | null)[][], max: 1 };
	const start = new Date(Number(year), 0, 1);
	const weeks: ({ key: string; count: number } | null)[][] = [];
	let week: ({ key: string; count: number } | null)[] = new Array(
		start.getDay(),
	).fill(null);
	let max = 1;
	for (
		const d = new Date(start);
		d.getFullYear() === Number(year);
		d.setDate(d.getDate() + 1)
	) {
		const key = `${year}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
		const count = stats.messagesByDate[key] ?? 0;
		max = Math.max(max, count);
		week.push({ key, count });
		if (week.length === 7) {
			weeks.push(week);
			week = [];
		}
	}
	if (week.length) weeks.push(week);
	return { weeks, max };
});
// Square-root scale so a few huge days don't wash out the rest
const shade = (count: number, max: number) =>
	count === 0 ? 0 : 0.15 + 0.85 * Math.sqrt(count / max);

// ── Weekday × hour ──
const maxCell = $derived(Math.max(1, ...stats.weekdayHour));
// Monday first
const weekdayOrder = [1, 2, 3, 4, 5, 6, 0];
const weekdayName = (day: number) =>
	new Date(2024, 0, 7 + day).toLocaleDateString(locale, { weekday: 'short' });

const dateText = (iso: string, withTime = false) =>
	new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString(
		locale,
		{
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
		},
	);
const silenceDays = $derived(
	stats.longestSilence ? Math.floor(stats.longestSilence.seconds / 86_400) : 0,
);
</script>

<!-- Highlights -->
{#if stats.longestStreak || stats.longestSilence}
	<div class="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
		{#if stats.longestStreak}
			<div class="p-4 rounded-xl bg-gray-50 dark:bg-gray-700/40">
				<div class="text-2xl font-bold text-gray-900 dark:text-white">{m.stats_day_count({ count: n(stats.longestStreak.days) })}</div>
				<div class="text-sm text-gray-500 dark:text-gray-400">{m.stats_longest_streak()}</div>
				<div class="text-xs text-gray-400 dark:text-gray-500 mt-1">{dateText(stats.longestStreak.start)} – {dateText(stats.longestStreak.end)}</div>
			</div>
		{/if}
		{#if stats.longestSilence && silenceDays >= 1}
			<div class="p-4 rounded-xl bg-gray-50 dark:bg-gray-700/40">
				<div class="text-2xl font-bold text-gray-900 dark:text-white">{m.stats_day_count({ count: n(silenceDays) })}</div>
				<div class="text-sm text-gray-500 dark:text-gray-400">{m.stats_longest_silence()}</div>
				<div class="text-xs text-gray-400 dark:text-gray-500 mt-1">{dateText(stats.longestSilence.from)} – {dateText(stats.longestSilence.to)}</div>
			</div>
		{/if}
	</div>
{/if}

<!-- Messages per month -->
{#if months.length > 1}
	<div class="mt-8">
		<h3 class="text-lg font-semibold text-gray-800 dark:text-white mb-4">{m.stats_messages_over_time()}</h3>
		<div class="flex items-end gap-px h-32" role="img" aria-label={m.stats_messages_over_time()}>
			{#each months as month (month.key)}
				<div class="flex-1 h-full flex items-end group relative">
					<div
						class="w-full bg-[var(--color-whatsapp-teal)] group-hover:bg-[var(--color-whatsapp-dark-green)] rounded-t {month.count ? 'min-h-[2px]' : ''}"
						style="height: {(month.count / maxMonth) * 100}%"
					></div>
					<div class="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block bg-gray-800 text-white text-xs px-2 py-1 rounded whitespace-nowrap z-10">
						{monthLabel(month.key, 'long')} – {m.stats_hour_messages({ count: n(month.count) })}
					</div>
				</div>
			{/each}
		</div>
		<div class="flex justify-between mt-1 text-xs text-gray-400 dark:text-gray-500">
			<span>{monthLabel(months[0].key)}</span>
			<span>{monthLabel(months[months.length - 1].key)}</span>
		</div>
	</div>
{/if}

<!-- Calendar heatmap -->
{#if year}
	<div class="mt-8">
		<div class="flex items-center justify-between gap-2 mb-3">
			<h3 class="text-lg font-semibold text-gray-800 dark:text-white">{m.stats_calendar()}</h3>
			{#if years.length > 1}
				<div class="flex gap-1 flex-wrap justify-end">
					{#each years as y (y)}
						<button
							type="button"
							class="px-2 h-7 rounded-md text-xs cursor-pointer {y === year
								? 'bg-[var(--color-whatsapp-teal)] text-white'
								: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300'}"
							onclick={() => (chosenYear = y)}
						>{y}</button>
					{/each}
				</div>
			{/if}
		</div>
		<div class="overflow-x-auto">
			<div class="flex gap-[3px] w-max">
				{#each heatmap.weeks as week, w (w)}
					<div class="flex flex-col gap-[3px]">
						{#each week as day, d (d)}
							{#if day}
								<div
									class="w-[11px] h-[11px] rounded-[2px] {day.count ? '' : 'bg-gray-100 dark:bg-gray-700/60'}"
									style={day.count ? `background: color-mix(in srgb, var(--color-whatsapp-teal) ${Math.round(shade(day.count, heatmap.max) * 100)}%, transparent)` : ''}
									title="{dateText(day.key)}: {n(day.count)}"
								></div>
							{:else}
								<div class="w-[11px] h-[11px]"></div>
							{/if}
						{/each}
					</div>
				{/each}
			</div>
		</div>
	</div>
{/if}

<!-- Weekday × hour -->
<div class="mt-8">
	<h3 class="text-lg font-semibold text-gray-800 dark:text-white mb-3">{m.stats_week_rhythm()}</h3>
	<div class="overflow-x-auto">
		<div class="grid gap-[2px] w-max" style="grid-template-columns: auto repeat(24, 14px)">
			{#each weekdayOrder as day (day)}
				<div class="pr-2 text-[10px] leading-[14px] text-gray-400 dark:text-gray-500">{weekdayName(day)}</div>
				{#each { length: 24 } as _, hour (hour)}
					{@const count = stats.weekdayHour[day * 24 + hour]}
					<div
						class="w-[14px] h-[14px] rounded-[2px] {count ? '' : 'bg-gray-100 dark:bg-gray-700/60'}"
						style={count ? `background: color-mix(in srgb, var(--color-whatsapp-teal) ${Math.round(shade(count, maxCell) * 100)}%, transparent)` : ''}
						title="{weekdayName(day)} {hour}:00 – {n(count)}"
					></div>
				{/each}
			{/each}
			<div></div>
			{#each { length: 24 } as _, hour (hour)}
				<div class="text-[9px] text-center text-gray-400 dark:text-gray-500">{hour % 6 === 0 ? hour : ''}</div>
			{/each}
		</div>
	</div>
</div>

<!-- Top words and emoji per person -->
{#if people.some((p) => stats.topWords[p]?.length || stats.topEmojis[p]?.length)}
	<div class="mt-8">
		<h3 class="text-lg font-semibold text-gray-800 dark:text-white mb-3">{m.stats_favourite_words()}</h3>
		<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
			{#each people as person (person)}
				{@const words = stats.topWords[person] ?? []}
				{@const emojis = stats.topEmojis[person] ?? []}
				{#if words.length || emojis.length}
					<div class="p-4 rounded-xl bg-gray-50 dark:bg-gray-700/40 min-w-0">
						<div class="text-sm font-medium text-gray-800 dark:text-gray-100 mb-2 truncate">{person}</div>
						{#if emojis.length}
							<div class="flex flex-wrap gap-1.5 mb-2">
								{#each emojis.slice(0, 8) as [emoji, count] (emoji)}
									<span class="text-lg" title={n(count)}>{emoji}</span>
								{/each}
							</div>
						{/if}
						<div class="flex flex-wrap gap-1.5">
							{#each words as [word, count] (word)}
								<span class="px-2 py-0.5 rounded-full text-xs bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200">{word} <span class="text-gray-400">{n(count)}</span></span>
							{/each}
						</div>
					</div>
				{/if}
			{/each}
		</div>
	</div>
{/if}
