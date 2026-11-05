<script lang="ts">
import { untrack } from 'svelte';
import { browser } from '$app/environment';
import {
	type GalleryItem,
	galleryState,
	inViewerOrder,
} from '$lib/gallery.svelte';
import { resolveLightboxItem } from '$lib/helpers/lightbox';
import { isMobileViewport } from '$lib/helpers/responsive';
import * as m from '$lib/paraglide/messages';
import { getLocale } from '$lib/paraglide/runtime';
import { loadMediaFile } from '$lib/parser';
import Icon from './Icon.svelte';
import IconButton from './IconButton.svelte';

interface Props {
	onNavigateToMessage: (messageId: string) => void;
	/** Invoked after navigating on a mobile viewport, so a caller-owned panel
	 * (e.g. the Media Gallery) can close itself to reveal the chat. No-op if
	 * the lightbox was opened from a chat bubble instead of the gallery. */
	onCloseGallery?: () => void;
}

let { onNavigateToMessage, onCloseGallery }: Props = $props();

const lightboxPath = $derived.by(() => galleryState.lightboxMediaPath);

// Resolved against the UNFILTERED list (galleryState.allItems), not the
// gallery's filtered `items`, so a bubble click resolves even while the
// Media Gallery has a participant/type filter active (GH-92 decision 2).
const lightboxItem = $derived.by(() =>
	resolveLightboxItem(galleryState.allItems, lightboxPath),
);

// Previous/next walk the media the gallery's filters show, oldest to newest.
// Media opened from a chat bubble that the filters hide walks everything.
const sequence = $derived.by(() => {
	if (!lightboxPath) return [] as GalleryItem[];
	const filtered = galleryState.items;
	const list = filtered.some((item) => item.path === lightboxPath)
		? filtered
		: galleryState.allItems;
	return inViewerOrder(list);
});
const position = $derived(
	sequence.findIndex((item) => item.path === lightboxPath),
);
const previousItem = $derived(position > 0 ? sequence[position - 1] : null);
const nextItem = $derived(
	position !== -1 && position < sequence.length - 1
		? sequence[position + 1]
		: null,
);

function showPrevious() {
	if (previousItem) galleryState.setLightbox(previousItem.path);
}

function showNext() {
	if (nextItem) galleryState.setLightbox(nextItem.path);
}

let playerEl = $state<HTMLMediaElement | null>(null);

function togglePlayback() {
	if (!playerEl) return;
	if (playerEl.paused) void playerEl.play().catch(() => {});
	else playerEl.pause();
}

// Horizontal swipe on touch screens; mostly-vertical drags are left alone
const SWIPE_MIN_PX = 50;
let touchStartX = 0;
let touchStartY = 0;

function handleTouchStart(e: TouchEvent) {
	touchStartX = e.touches[0].clientX;
	touchStartY = e.touches[0].clientY;
}

function handleTouchEnd(e: TouchEvent) {
	const dx = e.changedTouches[0].clientX - touchStartX;
	const dy = e.changedTouches[0].clientY - touchStartY;
	if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
	if (dx < 0) showNext();
	else showPrevious();
}

let lightboxUrl = $state<string | null>(null);
let lightboxLoading = $state(false);
let lightboxError = $state<string | null>(null);

// The item whose media is on screen. While the next one loads, the current
// one stays up, so moving left/right swaps instantly instead of flashing.
let shownItem = $state.raw<GalleryItem | null>(null);

$effect(() => {
	const it = lightboxItem;
	if (!it) {
		lightboxUrl = null;
		shownItem = null;
		lightboxError = null;
		lightboxLoading = false;
		return;
	}

	// Read without subscribing: this effect sets shownItem itself
	lightboxLoading = untrack(() => shownItem) === null;
	lightboxError = null;

	let isCancelled = false;

	loadMediaFile(it.media)
		.then((url) => {
			if (isCancelled) return;
			lightboxUrl = url;
			shownItem = it;
		})
		.catch((err) => {
			if (isCancelled) return;
			lightboxError = err instanceof Error ? err.message : String(err);
			shownItem = null;
		})
		.finally(() => {
			if (isCancelled) return;
			lightboxLoading = false;
		});

	return () => {
		isCancelled = true;
	};
});

// Photos either side load ahead (videos are too heavy to fetch on a guess)
$effect(() => {
	for (const neighbour of [previousItem, nextItem]) {
		if (neighbour?.type !== 'image') continue;
		// loadMediaFile reads and sets fields on the media object; tracking
		// them would re-run this effect
		untrack(() => loadMediaFile(neighbour.media))
			.then((url) => {
				const img = new Image();
				img.decoding = 'async';
				img.src = url;
			})
			.catch(() => {
				// Shown with its own error if the user gets there
			});
	}
});

let isSaving = $state(false);

/** Saves the open file under its original name (Downloads on desktop) */
async function saveCurrent() {
	const it = lightboxItem;
	if (!it || isSaving) return;
	isSaving = true;
	try {
		const url = await loadMediaFile(it.media);
		const link = document.createElement('a');
		link.href = url;
		link.download = it.name;
		document.body.appendChild(link);
		link.click();
		link.remove();
	} catch (err) {
		lightboxError = err instanceof Error ? err.message : String(err);
	} finally {
		isSaving = false;
	}
}

function closeLightbox() {
	galleryState.setLightbox(null);
}

function handleKeydown(e: KeyboardEvent) {
	if (!lightboxPath) return;
	if (e.key === 'Escape') {
		// The gallery panel also closes on Escape and its handler may run
		// after this one, when the lightbox already looks closed
		e.stopImmediatePropagation();
		closeLightbox();
		return;
	}
	if (e.altKey || e.ctrlKey || e.metaKey) return;
	const target = e.target as HTMLElement | null;
	// Leave keys to text fields. Checkboxes don't count: Safari keeps focus
	// on a ticked gallery filter after a tile is clicked
	if (
		target?.closest(
			'input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"]',
		)
	) {
		return;
	}
	// preventDefault also stops a focused video from seeking or a focused
	// button from being pressed by the same key
	if (e.key === 'ArrowLeft') {
		e.preventDefault();
		showPrevious();
	} else if (e.key === 'ArrowRight') {
		e.preventDefault();
		showNext();
	} else if (e.key === ' ' && playerEl) {
		e.preventDefault();
		togglePlayback();
	}
}
</script>

<svelte:window onkeydown={handleKeydown} />

{#if lightboxItem}
	<!-- Lightbox: rendered once at the app root so it is visible whether or
	     not the Media Gallery panel is open (GH-92). -->
	<div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
		<button
			type="button"
			class="absolute inset-0 cursor-default"
			onclick={closeLightbox}
			aria-label={m.close()}
		></button>
		<div class="relative w-full max-w-4xl bg-white dark:bg-gray-800 rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 shadow-xl">
			<div class="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700">
				<div class="min-w-0">
					<p class="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
						{#if sequence.length > 1 && position !== -1}
							<span class="tabular-nums text-gray-500 dark:text-gray-400 font-normal mr-1">{m.media_position({ current: position + 1, total: sequence.length })}</span>
						{/if}
						{lightboxItem.name}
					</p>
					<p class="text-xs text-gray-500 dark:text-gray-400 truncate">
						{#if lightboxItem.messageSender}
							{lightboxItem.messageSender}
						{:else}
							{m.media_gallery_unknown_sender()}
						{/if}
						·
						{#if lightboxItem.messageTimestamp}
							{new Date(lightboxItem.messageTimestamp).toLocaleString(getLocale())}
						{:else}
							{m.media_gallery_unknown_date()}
						{/if}
					</p>
				</div>
				<div class="flex items-center gap-2">
					{#if lightboxItem.messageId}
						<button
							type="button"
							class="h-9 px-2.5 inline-flex items-center justify-center gap-1.5 rounded-lg text-sm font-medium whitespace-nowrap text-[var(--color-whatsapp-teal)] hover:bg-[var(--color-whatsapp-teal)]/10 dark:hover:bg-[var(--color-whatsapp-teal)]/15 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-whatsapp-teal)]/60"
							onclick={() => {
								const messageId = lightboxItem?.messageId;
								closeLightbox();
								if (messageId) {
									onNavigateToMessage(messageId);
									// On mobile devices, close the gallery after navigating
									// This ensures the message is visible and not hidden behind the gallery overlay
									if (browser && isMobileViewport()) {
										onCloseGallery?.();
									}
								}
							}}
							aria-label={m.media_gallery_go_to_message()}
							title={m.media_gallery_go_to_message()}
						>
							<Icon name="arrow-circle-right" size="md" />
							<span class="hidden sm:inline">{m.media_gallery_go_to_message()}</span>
						</button>
					{:else}
						<span class="text-xs text-gray-500 dark:text-gray-400 px-2 py-1 rounded-lg bg-gray-100 dark:bg-gray-700">
							{m.media_gallery_unlinked()}
						</span>
					{/if}
					<IconButton
						theme="light"
						size="sm"
						onclick={saveCurrent}
						disabled={isSaving}
						aria-label={m.media_save()}
						title={m.media_save()}
					>
						<Icon name="download" size="md" />
					</IconButton>
					<IconButton
						theme="light"
						size="sm"
						onclick={closeLightbox}
						aria-label={m.close()}
					>
						<Icon name="close" size="md" />
					</IconButton>
				</div>
			</div>

			<!-- Swipe is a touch shortcut; the arrow buttons and keys do the same -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div
				class="bg-black/5 dark:bg-black/20"
				ontouchstart={handleTouchStart}
				ontouchend={handleTouchEnd}
			>
				{#if lightboxLoading}
					<div class="p-10 text-center text-sm text-gray-500 dark:text-gray-400">{m.media_gallery_loading()}</div>
				{:else if lightboxError}
					<div class="p-10 text-center text-sm text-red-600 dark:text-red-400">
						{m.media_gallery_load_error()}{#if lightboxError}: {lightboxError}{/if}
					</div>
				{:else if lightboxUrl && shownItem}
					<!-- A fixed height keeps the card still while moving between items -->
					{#if shownItem.type === 'image'}
						<div class="h-[70vh] flex items-center justify-center">
							<img src={lightboxUrl} alt={shownItem.name} class="max-h-full max-w-full object-contain" />
						</div>
					{:else if shownItem.type === 'video'}
						<div class="h-[70vh] flex items-center justify-center bg-black">
							<video
								bind:this={playerEl}
								src={lightboxUrl}
								controls
								class="max-h-full max-w-full"
								aria-label={shownItem.name}
							>
								<track kind="captions" />
							</video>
						</div>
					{:else if shownItem.type === 'audio'}
						<audio
							bind:this={playerEl}
							src={lightboxUrl}
							controls
							class="w-full p-4"
							aria-label={shownItem.name}
						></audio>
					{:else}
						<div class="p-6 text-center">
							<a
								href={lightboxUrl}
								download={shownItem.name}
								class="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--color-whatsapp-teal)] text-white hover:opacity-90 transition-opacity"
							>
								{shownItem.name}
							</a>
						</div>
					{/if}
				{/if}
			</div>
		</div>
		{#if previousItem}
			<button
				type="button"
				class="wa-lightbox-arrow left-2 sm:left-4"
				onclick={showPrevious}
				aria-label={m.media_previous()}
				title={m.media_previous()}
			>
				<Icon name="chevron-left" size="lg" />
			</button>
		{/if}
		{#if nextItem}
			<button
				type="button"
				class="wa-lightbox-arrow right-2 sm:right-4"
				onclick={showNext}
				aria-label={m.media_next()}
				title={m.media_next()}
			>
				<Icon name="chevron-right" size="lg" />
			</button>
		{/if}
	</div>
{/if}

<style>
	.wa-lightbox-arrow {
		position: absolute;
		top: 50%;
		transform: translateY(-50%);
		z-index: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 2.75rem;
		height: 2.75rem;
		border-radius: 9999px;
		background: rgb(0 0 0 / 0.55);
		color: white;
		cursor: pointer;
		transition: background-color 150ms;
	}

	.wa-lightbox-arrow:hover {
		background: rgb(0 0 0 / 0.75);
	}

	.wa-lightbox-arrow:focus-visible {
		outline: 2px solid var(--color-whatsapp-teal);
		outline-offset: 2px;
	}
</style>
