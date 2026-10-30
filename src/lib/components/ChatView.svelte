<script lang="ts">
import { onDestroy, tick, untrack } from 'svelte';
import { bookmarksState } from '$lib/bookmarks.svelte';
import { getNextMessageIndex } from '$lib/helpers/message-list-navigation';
import * as m from '$lib/paraglide/messages';
import { getLocale } from '$lib/paraglide/runtime';
import type { ChatMessage } from '$lib/parser';
import { groupMessagesByDate } from '$lib/parser';
import type { FlatItem } from '$lib/parser/zip-parser';
import Icon from './Icon.svelte';
import MessageBubble from './MessageBubble.svelte';

// Get current locale for date formatting
const locale = $derived(getLocale());

// Format a date key (YYYY-MM-DD) for display in the current locale
function formatDateSeparator(dateKey: string): string {
	const date = new Date(`${dateKey}T00:00:00`);
	return date.toLocaleDateString(locale, {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	});
}

interface Props {
	messages: ChatMessage[];
	archiveId: string;
	chatTitle: string;
	currentUser?: string;
	searchQuery?: string;
	// O(1) lookup function to check if a message matches search
	isSearchMatch?: (messageId: string) => boolean;
	currentSearchResultId?: string | null;
	scrollToMessageId?: string | null;
	autoLoadMedia?: boolean;
	precomputedMessageIndex?: Map<string, number>;
	precomputedFlatItems?: FlatItem[];
	precomputedMessagesById?: Map<string, ChatMessage>;
	/** Opens the shared media lightbox for the media file at this path (GH-92). */
	onOpenMedia?: (path: string) => void;
	/** Show sender names above bubbles (off for 1:1 chats on mobile). */
	showSenders?: boolean;
	/** Touch long-press on a message (mobile action sheet). */
	onMessageLongPress?: (message: ChatMessage) => void;
	/** Animate jumps to search results/bookmarks (off: jump instantly). */
	smoothNavigation?: boolean;
}

// Default no-op function for isSearchMatch
const defaultIsSearchMatch = () => false;

let {
	messages,
	archiveId,
	chatTitle,
	currentUser,
	searchQuery = '',
	isSearchMatch = defaultIsSearchMatch,
	currentSearchResultId = null,
	scrollToMessageId = null,
	autoLoadMedia = false,
	precomputedMessageIndex,
	precomputedFlatItems,
	precomputedMessagesById,
	onOpenMedia,
	showSenders = true,
	onMessageLongPress,
	smoothNavigation = false,
}: Props = $props();

// Performance optimization: only a window of the flat item list is in the DOM.
// Scrolling near either edge slides the window; jumps re-center it on the
// target. Capping the window keeps huge chats as smooth as small ones.
const WINDOW_INITIAL = 200; // Items rendered when a chat opens (from the bottom)
const WINDOW_STEP = 200; // Items added when scrolling near an edge
const WINDOW_MAX = 600; // Items kept in the DOM at most
const JUMP_CONTEXT = 150; // Items rendered on each side of a jump target

// Flatten messages with date separators for virtualization
type RenderItem =
	| { type: 'date'; dateKey: string }
	| { type: 'message'; message: ChatMessage };

// Check if precomputed data is available
const hasPrecomputedData = $derived(
	!!precomputedFlatItems && precomputedFlatItems.length > 0,
);

// Build a message lookup map - use precomputed if available, otherwise build lazily
let cachedMessagesById: Map<string, ChatMessage> | null = null;
let cachedMessagesArchiveId: string | null = null;
let cacheBuiltFully = false;

function getMessageById(id: string): ChatMessage | undefined {
	// Use precomputed map if available (fast path - no iteration needed)
	if (precomputedMessagesById) {
		return precomputedMessagesById.get(id);
	}

	// Invalidate cache if chat changed
	if (cachedMessagesArchiveId !== archiveId) {
		cachedMessagesById = new Map();
		cachedMessagesArchiveId = archiveId;
		cacheBuiltFully = false;
	}

	// If we have it cached, return it
	if (cachedMessagesById?.has(id)) {
		return cachedMessagesById.get(id);
	}

	// If cache is fully built and we don't have it, it doesn't exist
	if (cacheBuiltFully) {
		return undefined;
	}

	// Build full cache on first miss - this only happens once per chat
	// and only when precomputedMessagesById is not available
	if (!cacheBuiltFully) {
		for (const msg of messages) {
			cachedMessagesById!.set(msg.id, msg);
		}
		cacheBuiltFully = true;
	}

	return cachedMessagesById!.get(id);
}

// Get the total number of items (for chunking calculations)
const totalFlatItemsCount = $derived.by(() => {
	if (precomputedFlatItems && precomputedFlatItems.length > 0) {
		return precomputedFlatItems.length;
	}
	return fallbackFlatItems?.length ?? 0;
});

// Get the message index map
const messageIndexMap = $derived(
	precomputedMessageIndex ?? new Map<string, number>(),
);

// Fallback: compute full flat items only when precomputed data is NOT available
const fallbackFlatItems = $derived.by(() => {
	// Only compute if we don't have precomputed data
	if (precomputedFlatItems && precomputedFlatItems.length > 0) {
		return null;
	}

	const grouped = groupMessagesByDate(messages);
	const items: RenderItem[] = [];
	const indexMap = new Map<string, number>();

	for (const [dateKey, dayMessages] of grouped.entries()) {
		items.push({ type: 'date', dateKey });
		for (const message of dayMessages) {
			indexMap.set(message.id, items.length);
			items.push({ type: 'message', message });
		}
	}

	// Update the cached index map if we computed it
	if (!precomputedMessageIndex) {
		// We can't mutate messageIndexMap derived, but the fallback case is rare
		// The index will be available via precomputed in most cases
	}

	return items;
});

// Rendered window [start, end) over the flat items. null means "anchored to
// the latest messages", so the window follows the list when it changes.
let windowStartState = $state<number | null>(null);
let windowEndState = $state<number | null>(null);

const windowEnd = $derived(
	Math.min(windowEndState ?? totalFlatItemsCount, totalFlatItemsCount),
);
const windowStart = $derived(
	Math.max(
		0,
		Math.min(windowStartState ?? windowEnd - WINDOW_INITIAL, windowEnd),
	),
);

// Calculate which items to render
// This only resolves the items we actually need to display
const renderedItems = $derived.by(() => {
	const startIdx = windowStart;
	const endIdx = windowEnd;

	// If we have precomputed data, only resolve the slice we need
	if (precomputedFlatItems && precomputedFlatItems.length > 0) {
		const slice = precomputedFlatItems.slice(startIdx, endIdx);
		const items: RenderItem[] = [];
		let skippedCount = 0;
		const skippedIds: string[] = [];

		for (const item of slice) {
			if (item.type === 'date') {
				items.push({ type: 'date', dateKey: item.dateKey });
			} else {
				const message = getMessageById(item.messageId);
				if (message) {
					items.push({ type: 'message', message });
				} else {
					skippedCount++;
					if (skippedIds.length < 5) {
						skippedIds.push(item.messageId);
					}
				}
			}
		}

		// Only log if messages were skipped
		if (skippedCount > 0) {
			console.warn(
				'[renderedItems] Skipped',
				skippedCount,
				'messages because getMessageById returned undefined',
			);
			console.warn('[renderedItems] First few skipped IDs:', skippedIds);
		}

		return {
			items,
			startIndex: startIdx,
			hasMore: startIdx > 0,
			hasNewer: endIdx < totalFlatItemsCount,
		};
	}

	// Fallback: use computed flat items
	const fallback = fallbackFlatItems ?? [];
	return {
		items: fallback.slice(startIdx, endIdx),
		startIndex: startIdx,
		hasMore: startIdx > 0,
		hasNewer: endIdx < totalFlatItemsCount,
	};
});

// Archive-scoped bookmark map (messageId -> Bookmark). Reactively rebuilt when
// the bookmarksByArchive derived recomputes for this archive.
const bookmarkedMessageIds = $derived(
	bookmarksState.bookmarksByMessageIdForArchive(archiveId),
);

// Reference to message elements for scrolling
let messageRefs = new Map<string, HTMLElement>();
let chatContainer: HTMLElement;
let hasScrolledToBottom = $state(false);
let isLoadingMore = $state(false);

// Action to register message refs
function registerMessageRef(node: HTMLElement, messageId: string) {
	messageRefs.set(messageId, node);
	return {
		destroy() {
			messageRefs.delete(messageId);
		},
	};
}

// Track if we should trigger the highlight animation (after scroll completes)
let highlightReady = $state(false);
let highlightedId = $state<string | null>(null);
let pendingHighlightId = $state<string | null>(null);

// Persistent highlight - stays until user scrolls or navigates elsewhere
let persistentHighlightId = $state<string | null>(null);

// Slide the window when scrolling near the top or bottom edge
let topSentinel = $state<HTMLElement | null>(null);
let bottomSentinel = $state<HTMLElement | null>(null);

$effect(() => {
	if (typeof IntersectionObserver === 'undefined' || !chatContainer) return;
	// Re-observe whenever the window moves: a new observer reports right away
	// if a sentinel is still in range, so fast scrolling keeps loading.
	void windowStart;
	void windowEnd;
	void isLoadingMore;

	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				if (entry.target === topSentinel) loadOlderMessages();
				else if (entry.target === bottomSentinel) loadNewerMessages();
			}
		},
		{
			root: chatContainer,
			rootMargin: '500px 0px', // Trigger 500px before reaching an edge
			threshold: 0,
		},
	);
	if (topSentinel) observer.observe(topSentinel);
	if (bottomSentinel) observer.observe(bottomSentinel);
	return () => observer.disconnect();
});

/**
 * Changes the window while keeping the first visible message at the same spot
 * on screen, so items added or dropped above it don't make the view jump.
 */
async function moveWindowKeepingAnchor(start: number, end: number) {
	if (!chatContainer || isLoadingMore) return;
	isLoadingMore = true;

	const containerTop = chatContainer.getBoundingClientRect().top;
	let anchorId: string | null = null;
	let anchorOffset = 0;
	for (const item of renderedItems.items) {
		if (item.type !== 'message') continue;
		const el = messageRefs.get(item.message.id);
		if (!el) continue;
		const rect = el.getBoundingClientRect();
		if (rect.bottom > containerTop) {
			anchorId = item.message.id;
			anchorOffset = rect.top - containerTop;
			break;
		}
	}

	windowStartState = start;
	windowEndState = end >= totalFlatItemsCount ? null : end;
	await tick();

	const anchor = anchorId ? messageRefs.get(anchorId) : undefined;
	if (anchor && chatContainer) {
		const newOffset =
			anchor.getBoundingClientRect().top -
			chatContainer.getBoundingClientRect().top;
		chatContainer.scrollTop += newOffset - anchorOffset;
	}
	isLoadingMore = false;
}

function loadOlderMessages() {
	if (!renderedItems.hasMore) return;
	const start = Math.max(0, windowStart - WINDOW_STEP);
	const end = Math.min(windowEnd, start + WINDOW_MAX);
	void moveWindowKeepingAnchor(start, end);
}

function loadNewerMessages() {
	if (!renderedItems.hasNewer) return;
	const end = Math.min(totalFlatItemsCount, windowEnd + WINDOW_STEP);
	const start = Math.max(windowStart, end - WINDOW_MAX);
	void moveWindowKeepingAnchor(start, end);
}

/** Re-centers the window on a flat item index if it isn't rendered yet. */
function ensureIndexRendered(index: number): boolean {
	if (index >= windowStart && index < windowEnd) return false;
	const start = Math.max(0, index - JUMP_CONTEXT);
	const end = Math.min(totalFlatItemsCount, index + JUMP_CONTEXT);
	windowStartState = start;
	windowEndState = end >= totalFlatItemsCount ? null : end;
	return true;
}

/** Shows the latest messages again (the window may have moved away). */
async function jumpToLatest() {
	windowStartState = null;
	windowEndState = null;
	await tick();
	scrollToBottomSettled();
}

/**
 * Scrolls to the bottom, then again once stickers/thumbnails near the bottom
 * have sized themselves, unless the user has scrolled up in the meantime.
 */
function scrollToBottomSettled() {
	if (!chatContainer) return;
	chatContainer.scrollTop = chatContainer.scrollHeight;
	for (const delay of [150, 600]) {
		setTimeout(() => {
			if (!chatContainer || renderedItems.hasNewer) return;
			const gap =
				chatContainer.scrollHeight -
				chatContainer.scrollTop -
				chatContainer.clientHeight;
			if (gap > 0 && gap < chatContainer.clientHeight) {
				chatContainer.scrollTop = chatContainer.scrollHeight;
			}
		}, delay);
	}
}

// Track previous archiveId to detect actual changes
let previousArchiveId = $state<string | null>(null);

// Reset the window when chat changes
$effect(() => {
	if (previousArchiveId !== null && previousArchiveId !== archiveId) {
		windowStartState = null;
		windowEndState = null;
		hasScrolledToBottom = false;
		focusedMessageId = null; // Reset keyboard navigation on chat switch (GH-79)
		// DON'T clear messageRefs here - let the destroy() callbacks handle cleanup
		// and the new elements will register themselves
		lastProcessedScrollId = null; // Reset so bookmarks work after chat switch
	}
	previousArchiveId = archiveId;
});

// Scroll to bottom when messages first load
$effect(() => {
	if (messages.length > 0 && chatContainer && !hasScrolledToBottom) {
		requestAnimationFrame(() => {
			if (chatContainer) {
				scrollToBottomSettled();
				hasScrolledToBottom = true;
			}
		});
	}
});

// Cleanup on destroy
onDestroy(() => {
	if (scrollTimeout) {
		clearTimeout(scrollTimeout);
	}
});

// Ensure message is loaded when navigating to search result
$effect(() => {
	if (currentSearchResultId) {
		// Capture current values to ensure deriveds are evaluated
		const messageIndex = messageIndexMap.get(currentSearchResultId);
		if (messageIndex !== undefined) {
			untrack(() => ensureIndexRendered(messageIndex));
		}
	}
});

// Scroll to current search result when it changes
$effect(() => {
	const targetId = currentSearchResultId;
	if (!targetId) return;

	// Capture current values to ensure deriveds are evaluated
	const currentIndexMap = messageIndexMap;

	// Run async navigation with retry mechanism. Untracked: moving the window
	// must not re-run this effect, or scrolling would snap back to the result.
	untrack(() =>
		(async () => {
			const maxRetries = 20; // 20 * 50ms = 1 second max
			const retryDelay = 50;

			// Capture targetId at the start to detect if it changes during retries
			const capturedTargetId = targetId;

			for (let attempt = 0; attempt < maxRetries; attempt++) {
				// Check if currentSearchResultId changed during retry loop (race condition)
				if (currentSearchResultId !== capturedTargetId) {
					return; // Exit early, a newer navigation is in progress
				}

				// Move the window to the target if it isn't rendered
				const messageIndex = currentIndexMap.get(capturedTargetId);

				if (messageIndex !== undefined && ensureIndexRendered(messageIndex)) {
					// Check again before async operation
					if (currentSearchResultId !== capturedTargetId) {
						return;
					}
					await tick(); // Wait for DOM update after the window moved
				}

				// Check if message ref exists in DOM
				if (messageRefs.has(capturedTargetId)) {
					const element = messageRefs.get(capturedTargetId);

					if (element) {
						highlightReady = false;
						highlightedId = null;
						pendingHighlightId = capturedTargetId;
						isNavigationScroll = true;

						element.scrollIntoView({
							behavior: smoothNavigation ? 'smooth' : 'auto',
							block: 'center',
						});
						if (!smoothNavigation) setTimeout(handleScrollEnd, 50);

						// Check again before async operation
						if (currentSearchResultId !== capturedTargetId) {
							return;
						}

						setTimeout(() => {
							isNavigationScroll = false;
						}, 500);

						return; // Success, exit retry loop
					}
				}

				// Ref not ready yet, check again before waiting
				if (currentSearchResultId !== capturedTargetId) {
					return;
				}
				await new Promise((resolve) => setTimeout(resolve, retryDelay));
			}
		})(),
	);
});

// Track last processed scroll to avoid duplicate processing
let lastProcessedScrollId: string | null = null;

// Reset tracking when scrollToMessageId is cleared (allows re-navigation to same message)
$effect(() => {
	if (scrollToMessageId === null) {
		lastProcessedScrollId = null;
	}
});

// Robust scroll-to-message function with retry mechanism
// This handles timing issues where DOM refs might not be available immediately
async function scrollToMessageWithRetry(targetId: string): Promise<boolean> {
	const maxRetries = 30; // 30 * 50ms = 1.5 seconds max
	const retryDelay = 50;

	for (let attempt = 0; attempt < maxRetries; attempt++) {
		// 1. Check if target exists in current chat's index
		const messageIndex = messageIndexMap.get(targetId);

		if (messageIndex === undefined) {
			// Message not in this chat - nothing we can do
			console.log('[scrollToMessage] Message not in index, attempt:', attempt);
			// Give it a few attempts in case chat is still switching
			if (attempt < 5) {
				await new Promise((resolve) => setTimeout(resolve, retryDelay));
				continue;
			}
			return false;
		}

		// 2. Move the window to the target message if it isn't rendered
		if (ensureIndexRendered(messageIndex)) {
			await tick(); // Wait for DOM update after the window moved
		}

		// 3. Check if message ref exists in DOM
		if (messageRefs.has(targetId)) {
			const element = messageRefs.get(targetId);

			if (element && chatContainer) {
				// Success! Perform scroll and highlight
				highlightReady = false;
				highlightedId = null;
				pendingHighlightId = targetId;
				isNavigationScroll = true;

				const elementRect = element.getBoundingClientRect();
				const containerRect = chatContainer.getBoundingClientRect();
				const elementOffsetTop =
					elementRect.top - containerRect.top + chatContainer.scrollTop;
				const scrollToPosition =
					elementOffsetTop - containerRect.height / 2 + elementRect.height / 2;

				chatContainer.scrollTo({
					top: scrollToPosition,
					behavior: smoothNavigation ? 'smooth' : 'auto',
				});
				// Instant jumps may not fire scrollend; highlight right away
				if (!smoothNavigation) setTimeout(handleScrollEnd, 50);

				setTimeout(() => {
					isNavigationScroll = false;
				}, 500);

				console.log('[scrollToMessage] Success on attempt:', attempt);
				return true;
			}
		}

		// 4. Ref not ready yet, wait and retry
		console.log(
			'[scrollToMessage] Ref not ready, attempt:',
			attempt,
			'refsSize:',
			messageRefs.size,
		);
		await new Promise((resolve) => setTimeout(resolve, retryDelay));
	}

	console.log(
		'[scrollToMessage] Failed after',
		maxRetries,
		'attempts for:',
		targetId,
	);
	return false;
}

// Simple effect that triggers the retry-based scroll
$effect(() => {
	const targetId = scrollToMessageId;

	if (!targetId || targetId === lastProcessedScrollId) return;

	// Mark as processed immediately to prevent duplicate attempts
	lastProcessedScrollId = targetId;

	console.log('[Scroll Effect] Starting scroll to:', targetId);

	// Fire and forget - the retry mechanism handles all timing
	untrack(() => scrollToMessageWithRetry(targetId));
});

// Handle scroll end to trigger highlight
function handleScrollEnd() {
	if (scrollTimeout) {
		clearTimeout(scrollTimeout);
		scrollTimeout = null;
	}
	if (pendingHighlightId) {
		highlightReady = true;
		highlightedId = pendingHighlightId;
		persistentHighlightId = pendingHighlightId;
		pendingHighlightId = null;
	}
}

let scrollTimeout: ReturnType<typeof setTimeout> | null = null;
let isNavigationScroll = $state(false);

// Keyboard navigation state (GH-79): id of the message the user last moved to
// with the arrow keys. The container is an ARIA feed whose articles carry a
// roving tabindex, so arrow keys move DOM focus between messages while date
// separators are skipped.
let focusedMessageId = $state<string | null>(null);

// Roving tabindex (GH-79): exactly one message is reachable with Tab. Until the
// user picks one -- or when the focused message is no longer rendered by the
// windowing logic -- the first rendered message is the tab stop.
const tabStopMessageId = $derived.by(() => {
	const items = renderedItems.items;
	if (
		focusedMessageId !== null &&
		items.some(
			(item) => item.type === 'message' && item.message.id === focusedMessageId,
		)
	) {
		return focusedMessageId;
	}
	const first = items.find((item) => item.type === 'message');
	return first?.type === 'message' ? first.message.id : null;
});

// Find the rendered item index for a message id (or -1 when not rendered yet).
function findRenderedMessageIndex(messageId: string): number {
	return renderedItems.items.findIndex(
		(item) => item.type === 'message' && item.message.id === messageId,
	);
}

// Arrow-key navigation over the message list (GH-79). ArrowDown moves to the
// next message, ArrowUp to the previous one. The focused message is scrolled
// into view so the keyboard cursor is always visible.
function handleMessageListKeydown(event: KeyboardEvent) {
	const key = event.key;
	if (key !== 'ArrowDown' && key !== 'ArrowUp') return;
	// Don't hijack arrow keys used by interactive controls inside messages
	// (audio/video players, links, buttons).
	const target = event.target as HTMLElement | null;
	if (
		target?.closest(
			'a, button, audio, video, input, textarea, select, [contenteditable]',
		)
	) {
		return;
	}

	const items = renderedItems.items;
	if (items.length === 0) return;

	const currentIndex =
		focusedMessageId !== null ? findRenderedMessageIndex(focusedMessageId) : -1;
	const direction = key === 'ArrowDown' ? 'down' : 'up';
	const nextIndex = getNextMessageIndex(items, currentIndex, direction);

	if (nextIndex === -1) return;

	const item = items[nextIndex];
	if (item.type !== 'message') return;

	event.preventDefault();
	focusedMessageId = item.message.id;

	const element = messageRefs.get(item.message.id);
	// Move real DOM focus to the message (roving tabindex) so screen readers
	// announce the newly focused message; the list scrolls to keep it visible.
	element?.focus({ preventScroll: true });
	element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function handleScroll() {
	if (!isNavigationScroll && persistentHighlightId && !pendingHighlightId) {
		persistentHighlightId = null;
	}

	if (typeof window !== 'undefined' && 'onscrollend' in window) return;

	if (scrollTimeout) {
		clearTimeout(scrollTimeout);
	}
	scrollTimeout = setTimeout(() => {
		handleScrollEnd();
	}, 150);
}
</script>

<div class="relative flex-1 min-h-0 flex flex-col">
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
	bind:this={chatContainer}
	class="flex-1 overflow-y-auto p-4 chat-bg"
	role="feed"
	aria-label={m.messages_list_navigation_label()}
	onkeydown={handleMessageListKeydown}
	onscrollend={handleScrollEnd}
	onscroll={handleScroll}
>
	<!-- Top sentinel for loading more messages -->
	<div bind:this={topSentinel} class="h-1" aria-hidden="true"></div>
	
	<!-- Loading indicator -->
	{#if renderedItems.hasMore}
		<div class="flex justify-center py-4">
			<div class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
				{#if isLoadingMore}
					<div class="w-4 h-4 border-2 border-gray-300 border-t-[var(--color-whatsapp-teal)] rounded-full animate-spin"></div>
				{m.messages_loading_older()}
			{:else}
				<span class="opacity-60">{m.messages_scroll_older()}</span>
				{/if}
			</div>
		</div>
	{/if}

	<!-- Render items -->
	{#each renderedItems.items as item, idx (item.type === 'date' ? `date-${item.dateKey}-${idx}` : item.message.id)}
		{#if item.type === 'date'}
			<!-- Date separator -->
			<div class="flex justify-center my-4">
				<div
					class="bg-white/90 dark:bg-gray-800/90 text-gray-600 dark:text-gray-300 text-xs px-3 py-1 rounded-lg shadow-sm"
				>
					{formatDateSeparator(item.dateKey)}
				</div>
			</div>
		{:else}
			<!-- Message -->
			{@const message = item.message}
			{@const matchResult = isSearchMatch(message.id)}
			<!--
				WAI-ARIA feed pattern (GH-79): every article in a feed must be focusable
				so arrow-key navigation can move DOM focus onto it. svelte-check treats
				`article` as non-interactive and flags the required tabindex.
			-->
			<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
			<div
				use:registerMessageRef={message.id}
				role="article"
				tabindex={message.id === tabStopMessageId ? 0 : -1}
				onfocus={() => (focusedMessageId = message.id)}
				aria-current={message.id === focusedMessageId ? 'true' : undefined}
				class={message.id === focusedMessageId ? 'outline-2 outline-[var(--color-whatsapp-teal)] outline-offset-2 rounded-lg' : ''}
			>
				<MessageBubble
					{message}
					{archiveId}
					{chatTitle}
					{bookmarkedMessageIds}
					isOwn={currentUser !== undefined && message.sender === currentUser}
					showSender={showSenders}
					searchQuery={searchQuery}
					isSearchMatch={matchResult}
					isCurrentSearchResult={message.id === currentSearchResultId}
					triggerHighlight={highlightReady && message.id === highlightedId}
					isHighlighted={message.id === persistentHighlightId}
					{autoLoadMedia}
					{onOpenMedia}
					onLongPress={onMessageLongPress}
				/>
			</div>
		{/if}
	{/each}

	{#if renderedItems.hasNewer}
		<div class="flex justify-center py-4">
			<div class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
				{#if isLoadingMore}
					<div class="w-4 h-4 border-2 border-gray-300 border-t-[var(--color-whatsapp-teal)] rounded-full animate-spin"></div>
				{/if}
				{m.messages_loading_newer()}
			</div>
		</div>
		<!-- Bottom sentinel for loading newer messages -->
		<div bind:this={bottomSentinel} class="h-1" aria-hidden="true"></div>
	{/if}

	{#if messages.length === 0}
		<div class="flex items-center justify-center h-full text-gray-500 dark:text-gray-400">
			<p>{m.messages_no_display()}</p>
		</div>
	{/if}
</div>

{#if renderedItems.hasNewer}
	<button
		type="button"
		class="chat-jump-latest absolute bottom-4 right-4 w-10 h-10 rounded-full bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 shadow-lg flex items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-700"
		onclick={jumpToLatest}
		aria-label={m.messages_jump_to_latest()}
		title={m.messages_jump_to_latest()}
	>
		<Icon name="chevron-down" size="md" />
	</button>
{/if}
</div>
