<script lang="ts">
import { onMount, tick } from 'svelte';
import { fly } from 'svelte/transition';
import { bookmarksState } from '$lib/bookmarks.svelte';
import { galleryState } from '$lib/gallery.svelte';
import { getInitials } from '$lib/helpers/format';
import * as m from '$lib/paraglide/messages';
import { getLocale } from '$lib/paraglide/runtime';
import type { ChatMessage } from '$lib/parser';
import { appState, type ChatData, type LoadingChat } from '$lib/state.svelte';
import BookmarkModal from '../BookmarkModal.svelte';
import BookmarksPanel from '../BookmarksPanel.svelte';
import ChatStats from '../ChatStats.svelte';
import ChatView from '../ChatView.svelte';
import Icon from '../Icon.svelte';
import MediaGallery from '../MediaGallery.svelte';

interface Props {
	chats: ChatData[];
	loadingChats: LoadingChat[];
	isRemoteLibrary: boolean;
	isDarkMode: boolean;
	onToggleDarkMode: () => void;
	onSelectChat: (index: number) => void;
	onImportFiles: (files: File[]) => void;
	currentUser?: string;
	currentPerspective: string | null;
	onSelectPerspective: (participant: string | null) => void;
	autoLoadMedia: boolean;
	onAutoLoadMediaChange: (archiveId: string, enabled: boolean) => void;
	scrollToMessageId: string | null;
	onNavigateToMessage: (messageId: string, archiveId: string) => void;
}

let {
	chats,
	loadingChats,
	isRemoteLibrary,
	isDarkMode,
	onToggleDarkMode,
	onSelectChat,
	onImportFiles,
	currentUser,
	currentPerspective,
	onSelectPerspective,
	autoLoadMedia,
	onAutoLoadMediaChange,
	scrollToMessageId,
	onNavigateToMessage,
}: Props = $props();

const locale = $derived(getLocale());

// ── Screens ────────────────────────────────────────────────────────────────
let openArchiveId = $state<string | null>(null);
let showInfo = $state(false);
let showGallery = $state(false);
let showBookmarks = $state(false);
let showStats = $state(false);
let showPerspectivePicker = $state(false);
let showViewAsPrompt = $state(false);
let isSearching = $state(false);
let listQuery = $state('');
let fileInput = $state<HTMLInputElement | null>(null);
let searchInput = $state<HTMLInputElement | null>(null);

const openChat = $derived(
	openArchiveId
		? (chats.find((c) => c.archiveId === openArchiveId) ?? null)
		: null,
);
const isGroup = $derived((openChat?.participants.length ?? 0) > 2);

// The person who exported the chats appears in every one of them. When there
// are at least two chats, use that name to put "my" messages on the right.
const likelyMe = $derived.by(() => {
	if (chats.length < 2) return null;
	const [first, ...rest] = chats;
	const common = first.participants.filter((p) =>
		rest.every((c) => c.participants.includes(p)),
	);
	return common.length === 1 ? common[0] : null;
});
// "View as" choices per chat, remembered on this phone. Chats served by the
// laptop aren't persisted like imported ones, so without this the choice
// would be lost on every reload. A stored null means "None" was picked.
const VIEW_AS_KEY = 'wa-mobile-view-as';

function loadViewAsChoices(): Record<string, string | null> {
	try {
		return JSON.parse(localStorage.getItem(VIEW_AS_KEY) ?? '{}');
	} catch {
		return {};
	}
}

function saveViewAsChoice(archiveId: string, participant: string | null) {
	try {
		const choices = loadViewAsChoices();
		choices[archiveId] = participant;
		localStorage.setItem(VIEW_AS_KEY, JSON.stringify(choices));
	} catch {
		// Storage unavailable (private mode): the choice lasts this visit only
	}
}

/** Sets who "I" am in the open chat and remembers it for next time. */
function choosePerspective(participant: string | null) {
	if (openChat) saveViewAsChoice(openChat.archiveId, participant);
	onSelectPerspective(participant);
	showViewAsPrompt = false;
}

// Participants for the first-open prompt: the likely exporter first
const viewAsOptions = $derived.by(() => {
	if (!openChat) return [];
	const list = [...openChat.participants];
	const me = likelyMe ? list.indexOf(likelyMe) : -1;
	if (me > 0) list.unshift(...list.splice(me, 1));
	return list;
});

// ── Chat list ──────────────────────────────────────────────────────────────
function lastMessage(chat: ChatData): ChatMessage | undefined {
	for (let i = chat.messages.length - 1; i >= 0; i--) {
		if (!chat.messages[i].isSystemMessage) return chat.messages[i];
	}
	return chat.messages[chat.messages.length - 1];
}

const sortedChats = $derived.by(() => {
	const q = listQuery.trim().toLowerCase();
	return chats
		.filter((c) => !q || c.title.toLowerCase().includes(q))
		.map((chat) => ({ chat, last: lastMessage(chat) }))
		.sort(
			(a, b) =>
				(b.last?.timestamp.getTime() ?? 0) - (a.last?.timestamp.getTime() ?? 0),
		);
});

function mediaLabel(message: ChatMessage): string {
	switch (message.mediaType) {
		case 'image':
			return `📷 ${m.media_photo()}`;
		case 'video':
			return `🎥 ${m.media_video()}`;
		case 'audio':
			return `🎤 ${m.media_audio()}`;
		case 'sticker':
			return `🏷️ ${m.media_sticker()}`;
		case 'contact':
			return `👤 ${m.media_contact()}`;
		default:
			return `📄 ${m.media_document()}`;
	}
}

function previewText(chat: ChatData, message: ChatMessage | undefined): string {
	if (!message) return '';
	const text = message.content
		.replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, '')
		.trim();
	// Keep the export's own wording ("image omitted", "video omitted")
	const body =
		message.isMediaMessage && !/\bomitted\b/i.test(text)
			? mediaLabel(message)
			: text;
	if (message.isSystemMessage || !message.sender) return body;
	if (likelyMe && message.sender === likelyMe)
		return `${m.mobile_you()}: ${body}`;
	if (chat.participants.length > 2) return `${message.sender}: ${body}`;
	return body;
}

function formatListDate(date: Date | undefined): string {
	if (!date) return '';
	const now = new Date();
	const startOfToday = new Date(
		now.getFullYear(),
		now.getMonth(),
		now.getDate(),
	);
	const dayMs = 24 * 60 * 60 * 1000;
	if (date >= startOfToday) {
		return date.toLocaleTimeString(locale, {
			hour: '2-digit',
			minute: '2-digit',
		});
	}
	if (date >= new Date(startOfToday.getTime() - dayMs))
		return m.time_yesterday();
	if (date >= new Date(startOfToday.getTime() - 6 * dayMs)) {
		return date.toLocaleDateString(locale, { weekday: 'long' });
	}
	return date.toLocaleDateString(locale, {
		day: '2-digit',
		month: '2-digit',
		year: '2-digit',
	});
}

function formatShortDate(date: Date | null): string {
	if (!date) return '';
	return date.toLocaleDateString(locale, {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
	});
}

// Stable avatar colours per name, in the spirit of WhatsApp's palette
const AVATAR_COLORS = [
	'#25D366',
	'#128C7E',
	'#34B7F1',
	'#7E57C2',
	'#EC407A',
	'#FF7043',
	'#26A69A',
	'#5C6BC0',
	'#AB47BC',
	'#8D6E63',
];
function avatarColor(name: string): string {
	let hash = 0;
	for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
	return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

// ── Navigation ─────────────────────────────────────────────────────────────
let pushedHistory = false;

async function openChatScreen(chat: ChatData) {
	const index = chats.indexOf(chat);
	if (index === -1) return;
	onSelectChat(index);
	openArchiveId = chat.archiveId;
	closeOverlays();
	if (!pushedHistory) {
		history.pushState({ waMobileChat: true }, '');
		pushedHistory = true;
	}

	await tick();
	// Restore the remembered "view as" choice, or ask on the first open
	const choices = loadViewAsChoices();
	if (chat.archiveId in choices) {
		const saved = choices[chat.archiveId];
		if (saved === null || chat.participants.includes(saved)) {
			if (saved !== currentPerspective) onSelectPerspective(saved);
			return;
		}
	}
	if (currentPerspective !== null) {
		// Restored from an imported chat's saved settings
		saveViewAsChoice(chat.archiveId, currentPerspective);
		return;
	}
	if (chat.participants.length > 0) showViewAsPrompt = true;
}

function closeOverlays() {
	showInfo = false;
	showGallery = false;
	showBookmarks = false;
	showStats = false;
	showPerspectivePicker = false;
	showViewAsPrompt = false;
	actionMessage = null;
}

function closeChatScreen() {
	closeOverlays();
	stopSearch();
	openArchiveId = null;
	dragX = 0;
}

function goBack() {
	if (pushedHistory) {
		history.back(); // popstate closes the chat
	} else {
		closeChatScreen();
	}
}

onMount(() => {
	const onPopState = () => {
		pushedHistory = false;
		closeChatScreen();
	};
	window.addEventListener('popstate', onPopState);
	document.documentElement.classList.add('mobile-wa-root');
	return () => {
		window.removeEventListener('popstate', onPopState);
		document.documentElement.classList.remove('mobile-wa-root');
	};
});

// Close panels when the lightbox or bookmarks jump to a message
$effect(() => {
	if (scrollToMessageId) {
		showGallery = false;
		showBookmarks = false;
		showInfo = false;
	}
});

// ── Edge swipe back (home-screen app has no browser back gesture) ──────────
const isStandalone =
	typeof window !== 'undefined' &&
	((navigator as Navigator & { standalone?: boolean }).standalone === true ||
		window.matchMedia('(display-mode: standalone)').matches);
let dragX = $state(0);
let dragStart: { x: number; y: number } | null = null;
let dragging = $state(false);

function onTouchStart(e: TouchEvent) {
	if (!isStandalone || showInfo || showGallery || showBookmarks) return;
	const t = e.touches[0];
	if (t.clientX > 28) return;
	dragStart = { x: t.clientX, y: t.clientY };
}

function onTouchMove(e: TouchEvent) {
	if (!dragStart) return;
	const t = e.touches[0];
	const dx = t.clientX - dragStart.x;
	if (!dragging && Math.abs(t.clientY - dragStart.y) > Math.abs(dx)) {
		dragStart = null;
		return;
	}
	dragging = true;
	dragX = Math.max(0, dx);
}

function onTouchEnd() {
	if (!dragStart && !dragging) return;
	const shouldClose = dragX > window.innerWidth * 0.33;
	dragStart = null;
	dragging = false;
	if (shouldClose) {
		goBack();
	} else {
		dragX = 0;
	}
}

// ── In-chat search ─────────────────────────────────────────────────────────
async function startSearch() {
	isSearching = true;
	await tick();
	searchInput?.focus();
}

function stopSearch() {
	isSearching = false;
	appState.setSearchQuery('');
}

// ── Long-press actions ─────────────────────────────────────────────────────
let actionMessage = $state<ChatMessage | null>(null);
let bookmarkMessage = $state<ChatMessage | null>(null);

async function copyMessage() {
	const text = actionMessage?.content ?? '';
	actionMessage = null;
	try {
		await navigator.clipboard.writeText(text);
	} catch {
		// Clipboard needs a secure context; nothing else to do
	}
}

function bookmarkFromAction() {
	bookmarkMessage = actionMessage;
	actionMessage = null;
}

const messageCounts = $derived.by(() => {
	const counts = new Map<string, number>();
	if (!openChat) return counts;
	for (const msg of openChat.messages) {
		if (msg.sender) counts.set(msg.sender, (counts.get(msg.sender) ?? 0) + 1);
	}
	return counts;
});

const bookmarkCount = $derived(
	openChat
		? bookmarksState.getBookmarksForArchive(openChat.archiveId).length
		: 0,
);
</script>

<div class="mobile-wa fixed inset-0 overflow-hidden bg-white dark:bg-[#111B21] text-gray-900 dark:text-[#E9EDEF]">
	<!-- ── Chat list screen ── -->
	<div class="absolute inset-0 flex flex-col">
		<header class="wa-safe-top shrink-0 bg-white/90 dark:bg-[#111B21]/90 backdrop-blur-md">
			<div class="h-11 px-4 flex items-center justify-between">
				<button
					type="button"
					class="wa-icon-btn"
					onclick={onToggleDarkMode}
					aria-label={m.mobile_dark_mode()}
				>
					<Icon name={isDarkMode ? 'sun' : 'moon'} size="md" />
				</button>
				<button
					type="button"
					class="wa-icon-btn wa-accent"
					onclick={() => fileInput?.click()}
					aria-label={m.import_chat()}
				>
					<Icon name="plus" size="md" />
				</button>
			</div>
			<h1 class="px-4 pb-2 text-[34px] leading-tight font-bold tracking-tight">
				{m.mobile_chats_title()}
			</h1>
			<div class="px-4 pb-2">
				<label class="flex items-center gap-2 h-9 px-2.5 rounded-[10px] bg-[#767680]/12 dark:bg-[#202C33]">
					<Icon name="search" size="sm" class="text-gray-500 dark:text-[#8696A0]" />
					<input
						type="search"
						bind:value={listQuery}
						placeholder={m.mobile_search_chats()}
						class="flex-1 bg-transparent outline-none text-[16px] placeholder:text-gray-500 dark:placeholder:text-[#8696A0]"
					/>
				</label>
			</div>
		</header>

		<input
			bind:this={fileInput}
			type="file"
			accept=".zip,application/zip"
			multiple
			class="hidden"
			onchange={(e) => {
				const input = e.currentTarget as HTMLInputElement;
				if (input.files) onImportFiles(Array.from(input.files));
				input.value = '';
			}}
		/>

		<div class="flex-1 overflow-y-auto overscroll-contain wa-safe-bottom">
			{#each loadingChats as lc (lc.id)}
				<div class="wa-row">
					<div class="w-[52px] h-[52px] rounded-full bg-gray-200 dark:bg-[#202C33] animate-pulse shrink-0"></div>
					<div class="wa-row-body">
						<div class="font-semibold truncate">{lc.filename}</div>
						<div class="mt-1.5 h-1 rounded-full bg-gray-200 dark:bg-[#202C33] overflow-hidden">
							<div class="h-full bg-[#25D366] transition-all" style="width: {Math.round(lc.progress)}%"></div>
						</div>
					</div>
				</div>
			{/each}

			{#each sortedChats as { chat, last } (chat.archiveId)}
				<button type="button" class="wa-row w-full text-left active:bg-gray-100 dark:active:bg-[#202C33]" onclick={() => openChatScreen(chat)}>
					<div
						class="w-[52px] h-[52px] rounded-full flex items-center justify-center text-white text-lg font-semibold shrink-0"
						style="background-color: {avatarColor(chat.title)}"
					>
						{getInitials(chat.title)}
					</div>
					<div class="wa-row-body">
						<div class="flex items-baseline gap-2">
							<span class="flex-1 font-semibold text-[17px] truncate">{chat.title}</span>
							<span class="text-[14px] text-gray-500 dark:text-[#8696A0] shrink-0">{formatListDate(last?.timestamp)}</span>
						</div>
						<div class="text-[15px] leading-snug text-gray-500 dark:text-[#8696A0] line-clamp-2 mt-0.5">
							{previewText(chat, last)}
						</div>
					</div>
				</button>
			{/each}

			{#if chats.length === 0 && loadingChats.length === 0}
				<div class="px-8 py-16 text-center text-gray-500 dark:text-[#8696A0]">
					<Icon name="chat" size="2xl" class="mx-auto mb-4 opacity-50" />
					<p class="font-semibold text-gray-700 dark:text-[#E9EDEF]">{m.mobile_no_chats()}</p>
					<p class="mt-2 text-sm">{m.mobile_no_chats_hint()}</p>
				</div>
			{/if}

			{#if appState.error}
				<p class="mx-4 my-3 p-3 rounded-lg bg-red-50 dark:bg-red-900/30 text-sm text-red-700 dark:text-red-300 whitespace-pre-line">{appState.error}</p>
			{/if}

			{#if isRemoteLibrary && chats.length > 0}
				<p class="py-6 text-center text-xs text-gray-400 dark:text-[#8696A0] flex items-center justify-center gap-1">
					<Icon name="lock" size="xs" />
					{m.mobile_from_laptop()}
				</p>
			{/if}
		</div>
	</div>

	<!-- ── Chat screen ── -->
	{#if openChat}
		<div
			class="absolute inset-0 flex flex-col bg-[var(--color-chat-bg)] shadow-2xl z-10"
			style="transform: translateX({dragX}px); transition: {dragging ? 'none' : 'transform 0.25s ease-out'};"
			transition:fly={{ x: typeof window !== 'undefined' ? window.innerWidth : 400, duration: 280, opacity: 1 }}
			ontouchstart={onTouchStart}
			ontouchmove={onTouchMove}
			ontouchend={onTouchEnd}
			role="presentation"
		>
			<header class="wa-safe-top shrink-0 bg-[#F6F6F6]/95 dark:bg-[#202C33]/95 backdrop-blur-md border-b border-black/10 dark:border-white/5">
				{#if isSearching}
					<div class="h-[52px] px-3 flex items-center gap-2">
						<label class="flex-1 flex items-center gap-2 h-9 px-2.5 rounded-[10px] bg-[#767680]/12 dark:bg-[#111B21]">
							<Icon name="search" size="sm" class="text-gray-500 dark:text-[#8696A0]" />
							<input
								bind:this={searchInput}
								type="search"
								value={appState.searchQuery}
								oninput={(e) => appState.setSearchQuery(e.currentTarget.value)}
								onkeydown={(e) => {
									if (e.key === 'Enter') appState.nextSearchResult();
								}}
								placeholder={m.search_placeholder()}
								enterkeyhint="search"
								class="flex-1 bg-transparent outline-none text-[16px]"
							/>
						</label>
						<button type="button" class="wa-accent text-[17px] px-1" onclick={stopSearch}>
							{m.mobile_cancel()}
						</button>
					</div>
				{:else}
					<div class="h-[52px] pl-1 pr-2 flex items-center gap-1">
						<button type="button" class="wa-icon-btn wa-accent" onclick={goBack} aria-label={m.mobile_back()}>
							<Icon name="chevron-left" size="lg" />
						</button>
						<button type="button" class="flex-1 min-w-0 flex items-center gap-2.5 text-left" onclick={() => (showInfo = true)}>
							<div
								class="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0"
								style="background-color: {avatarColor(openChat.title)}"
							>
								{getInitials(openChat.title)}
							</div>
							<div class="min-w-0">
								<div class="font-semibold text-[16px] truncate leading-tight">{openChat.title}</div>
								<div class="text-[12px] text-gray-500 dark:text-[#8696A0] truncate leading-tight">
									{#if isGroup}
										{openChat.participants.join(', ')}
									{:else}
										{m.mobile_tap_for_info()}
									{/if}
								</div>
							</div>
						</button>
						<button type="button" class="wa-icon-btn wa-accent" onclick={startSearch} aria-label={m.search_placeholder()}>
							<Icon name="search" size="md" />
						</button>
						<button type="button" class="wa-icon-btn wa-accent" onclick={() => (showGallery = true)} aria-label={m.media_gallery_title()}>
							<Icon name="image" size="md" />
						</button>
					</div>
				{/if}
			</header>

			<div class="flex-1 flex flex-col min-h-0 {isSearching ? 'wa-searching' : ''}">
				<ChatView
					messages={appState.displayMessages}
					archiveId={openChat.archiveId}
					chatTitle={openChat.title}
					{currentUser}
					searchQuery={appState.activeSearchQuery}
					isSearchMatch={appState.isSearchMatch}
					currentSearchResultId={appState.currentSearchResultId}
					{scrollToMessageId}
					{autoLoadMedia}
					precomputedMessageIndex={openChat.messageIndex}
					precomputedFlatItems={openChat.flatItems}
					precomputedMessagesById={openChat.messagesById}
					onOpenMedia={(path) => galleryState.setLightbox(path)}
					showSenders={isGroup}
					onMessageLongPress={(message) => (actionMessage = message)}
					smoothNavigation={false}
				/>
			</div>

			{#if isSearching}
				<footer class="wa-safe-bottom shrink-0 bg-[#F6F6F6]/95 dark:bg-[#202C33]/95 backdrop-blur-md border-t border-black/10 dark:border-white/5">
					<div class="h-12 px-4 flex items-center justify-between">
						<span class="text-[15px] text-gray-600 dark:text-[#8696A0]">
							{#if !appState.searchQuery}
								&nbsp;
							{:else if appState.isSearching}
								{appState.searchProgress}%
							{:else if appState.totalSearchMatches > 0}
								{m.search_result_of({ current: appState.currentSearchIndex + 1, total: appState.totalSearchMatches })}
							{:else}
								{m.search_no_results()}
							{/if}
						</span>
						<div class="flex items-center gap-2">
							<!-- Older results are further up the chat -->
							<button type="button" class="wa-icon-btn wa-accent" disabled={appState.totalSearchMatches === 0} onclick={() => appState.prevSearchResult()} aria-label={m.search_previous()}>
								<Icon name="chevron-up" size="md" />
							</button>
							<button type="button" class="wa-icon-btn wa-accent" disabled={appState.totalSearchMatches === 0} onclick={() => appState.nextSearchResult()} aria-label={m.search_next()}>
								<Icon name="chevron-down" size="md" />
							</button>
						</div>
					</div>
				</footer>
			{/if}
		</div>
	{/if}

	<!-- ── Chat info screen ── -->
	{#if openChat && showInfo}
		<div
			class="absolute inset-0 z-20 flex flex-col bg-[#F2F2F7] dark:bg-[#0B141A]"
			transition:fly={{ x: typeof window !== 'undefined' ? window.innerWidth : 400, duration: 260, opacity: 1 }}
		>
			<header class="wa-safe-top shrink-0 bg-[#F2F2F7]/95 dark:bg-[#0B141A]/95 backdrop-blur-md">
				<div class="h-11 pl-1 pr-4 flex items-center">
					<button type="button" class="wa-icon-btn wa-accent" onclick={() => (showInfo = false)} aria-label={m.mobile_back()}>
						<Icon name="chevron-left" size="lg" />
					</button>
					<span class="flex-1 text-center font-semibold text-[17px] -ml-10">{m.mobile_chat_info()}</span>
				</div>
			</header>

			<div class="flex-1 overflow-y-auto overscroll-contain wa-safe-bottom pb-8">
				<div class="flex flex-col items-center pt-4 pb-6 px-6 text-center">
					<div
						class="w-28 h-28 rounded-full flex items-center justify-center text-white text-4xl font-semibold"
						style="background-color: {avatarColor(openChat.title)}"
					>
						{getInitials(openChat.title)}
					</div>
					<h2 class="mt-3 text-2xl font-semibold">{openChat.title}</h2>
					<p class="mt-1 text-[15px] text-gray-500 dark:text-[#8696A0]">
						{m.mobile_message_count({ count: openChat.messageCount.toLocaleString(locale) })}
					</p>
					<p class="text-[13px] text-gray-500 dark:text-[#8696A0]">
						{formatShortDate(openChat.startDate)} – {formatShortDate(openChat.endDate)}
					</p>
				</div>

				<div class="wa-group">
					<button type="button" class="wa-cell" onclick={() => (showGallery = true)}>
						<span class="wa-cell-icon bg-[#007AFF]"><Icon name="image" size="sm" /></span>
						<span class="flex-1">{m.mobile_media_links_docs()}</span>
						<span class="text-gray-500 dark:text-[#8696A0]">{openChat.mediaFiles.length.toLocaleString(locale)}</span>
						<Icon name="chevron-right" size="sm" class="text-gray-400" />
					</button>
					<button type="button" class="wa-cell" onclick={() => (showBookmarks = true)}>
						<span class="wa-cell-icon bg-[#FF9500]"><Icon name="bookmark" size="sm" filled /></span>
						<span class="flex-1">{m.bookmarks_title()}</span>
						<span class="text-gray-500 dark:text-[#8696A0]">{bookmarkCount || ''}</span>
						<Icon name="chevron-right" size="sm" class="text-gray-400" />
					</button>
					<button type="button" class="wa-cell" onclick={() => (showStats = true)}>
						<span class="wa-cell-icon bg-[#34C759]"><Icon name="chart-bar" size="sm" /></span>
						<span class="flex-1">{m.stats_view()}</span>
						<Icon name="chevron-right" size="sm" class="text-gray-400" />
					</button>
				</div>

				<div class="wa-group">
					<button type="button" class="wa-cell" onclick={() => (showPerspectivePicker = !showPerspectivePicker)}>
						<span class="wa-cell-icon bg-[#5856D6]"><Icon name="user" size="sm" /></span>
						<span class="flex-1">{m.perspective_view_as()}</span>
						<span class="text-gray-500 dark:text-[#8696A0] truncate max-w-[45%]">{currentPerspective ?? m.perspective_none()}</span>
					</button>
					{#if showPerspectivePicker}
						<button type="button" class="wa-cell pl-14" onclick={() => choosePerspective(null)}>
							<span class="flex-1 italic">{m.perspective_none()}</span>
							{#if currentPerspective === null}<Icon name="check" size="sm" class="wa-accent" />{/if}
						</button>
						{#each openChat.participants as participant}
							<button type="button" class="wa-cell pl-14" onclick={() => choosePerspective(participant)}>
								<span class="flex-1 truncate">{participant}</span>
								{#if currentPerspective === participant}<Icon name="check" size="sm" class="wa-accent" />{/if}
							</button>
						{/each}
					{/if}
					<label class="wa-cell">
						<span class="wa-cell-icon bg-[#FF2D55]"><Icon name="download" size="sm" /></span>
						<span class="flex-1">{m.mobile_show_media()}</span>
						<input
							type="checkbox"
							class="wa-switch"
							checked={autoLoadMedia}
							onchange={(e) => onAutoLoadMediaChange(openChat.archiveId, e.currentTarget.checked)}
						/>
					</label>
				</div>

				<p class="px-8 pt-2 pb-1 text-[13px] uppercase text-gray-500 dark:text-[#8696A0]">
					{m.participants_members({ count: openChat.participants.length })}
				</p>
				<div class="wa-group">
					{#each openChat.participants as participant}
						{@const contact = openChat.contacts?.get(participant.toLowerCase())}
						<div class="wa-cell">
							<div
								class="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-semibold shrink-0"
								style="background-color: {avatarColor(participant)}"
							>
								{getInitials(participant)}
							</div>
							<div class="flex-1 min-w-0">
								<div class="truncate">{participant}{participant === likelyMe ? ` (${m.mobile_you()})` : ''}</div>
								{#if contact?.phoneNumber}
									<div class="text-[13px] text-gray-500 dark:text-[#8696A0]">{contact.phoneNumber}</div>
								{/if}
							</div>
							<span class="text-[13px] text-gray-500 dark:text-[#8696A0]">
								{(messageCounts.get(participant) ?? 0).toLocaleString(locale)}
							</span>
						</div>
					{/each}
				</div>
			</div>
		</div>
	{/if}

	<!-- ── Media gallery (full screen) ── -->
	{#if openChat && showGallery}
		<div
			class="absolute inset-0 z-30 flex flex-col bg-white dark:bg-gray-900 wa-safe-top wa-safe-bottom"
			transition:fly={{ y: 40, duration: 220 }}
		>
			<MediaGallery onClose={() => (showGallery = false)} />
		</div>
	{/if}

	<!-- ── Bookmarks (full screen) ── -->
	{#if openChat && showBookmarks}
		<div
			class="absolute inset-0 z-30 flex flex-col bg-white dark:bg-gray-900 wa-safe-top wa-safe-bottom"
			transition:fly={{ y: 40, duration: 220 }}
		>
			<BookmarksPanel
				currentArchiveId={openChat.archiveId}
				onNavigateToMessage={(messageId, archiveId) => {
					showBookmarks = false;
					showInfo = false;
					onNavigateToMessage(messageId, archiveId);
				}}
				onClose={() => (showBookmarks = false)}
				indexedArchiveIds={appState.indexedArchiveIds}
			/>
		</div>
	{/if}

	{#if openChat && showStats}
		<ChatStats chat={openChat} onClose={() => (showStats = false)} />
	{/if}

	<!-- ── Long-press action sheet ── -->
	{#if actionMessage}
		<div class="absolute inset-0 z-40 flex flex-col justify-end">
			<button
				type="button"
				class="absolute inset-0 bg-black/40"
				aria-label={m.mobile_cancel()}
				onclick={() => (actionMessage = null)}
			></button>
			<div class="relative px-2 wa-safe-bottom pb-2" transition:fly={{ y: 200, duration: 220 }}>
				<div class="rounded-[14px] overflow-hidden bg-white/95 dark:bg-[#233138] backdrop-blur-md">
					<p class="px-4 py-3 text-center text-[13px] text-gray-500 dark:text-[#8696A0] line-clamp-3 border-b border-black/10 dark:border-white/10">
						{actionMessage.content}
					</p>
					{#if !actionMessage.isMediaMessage}
						<button type="button" class="wa-sheet-btn border-b border-black/10 dark:border-white/10" onclick={copyMessage}>
							{m.mobile_copy()}
						</button>
					{/if}
					<button type="button" class="wa-sheet-btn" onclick={bookmarkFromAction}>
						{m.bookmarks_add()}
					</button>
				</div>
				<button type="button" class="wa-sheet-btn mt-2 rounded-[14px] bg-white dark:bg-[#233138] font-semibold" onclick={() => (actionMessage = null)}>
					{m.mobile_cancel()}
				</button>
			</div>
		</div>
	{/if}

	<!-- ── First-open "view as" prompt ── -->
	{#if showViewAsPrompt && openChat}
		<div class="absolute inset-0 z-40 flex flex-col justify-end" role="dialog" aria-modal="true" aria-labelledby="wa-view-as-title">
			<button
				type="button"
				class="absolute inset-0 bg-black/40"
				aria-label={m.mobile_not_now()}
				onclick={() => (showViewAsPrompt = false)}
			></button>
			<div class="relative px-2 wa-safe-bottom pb-2" transition:fly={{ y: 200, duration: 220 }}>
				<div class="rounded-[14px] overflow-hidden bg-white/95 dark:bg-[#233138] backdrop-blur-md">
					<div class="px-4 py-3 text-center border-b border-black/10 dark:border-white/10">
						<p id="wa-view-as-title" class="text-[15px] font-semibold">{m.mobile_view_as_prompt_title()}</p>
						<p class="mt-0.5 text-[13px] text-gray-500 dark:text-[#8696A0]">{m.mobile_view_as_prompt_hint()}</p>
					</div>
					<div class="max-h-[50vh] overflow-y-auto">
						{#each viewAsOptions as participant (participant)}
							<button
								type="button"
								class="wa-view-as-row border-b border-black/10 dark:border-white/10"
								onclick={() => choosePerspective(participant)}
							>
								<span
									class="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-[13px] font-semibold text-white"
									style="background-color: {avatarColor(participant)}"
								>
									{getInitials(participant)}
								</span>
								<span class="flex-1 min-w-0 truncate">
									{participant}{participant === likelyMe ? ` (${m.mobile_you()})` : ''}
								</span>
								<span class="text-[13px] text-gray-500 dark:text-[#8696A0]">
									{m.mobile_message_count({ count: (messageCounts.get(participant) ?? 0).toLocaleString(locale) })}
								</span>
							</button>
						{/each}
						<button type="button" class="wa-sheet-btn italic" onclick={() => choosePerspective(null)}>
							{m.perspective_none()}
						</button>
					</div>
				</div>
				<button type="button" class="wa-sheet-btn mt-2 rounded-[14px] bg-white dark:bg-[#233138] font-semibold" onclick={() => (showViewAsPrompt = false)}>
					{m.mobile_not_now()}
				</button>
			</div>
		</div>
	{/if}

	{#if bookmarkMessage && openChat}
		{@const existing = bookmarksState.bookmarksByMessageIdForArchive(openChat.archiveId).get(bookmarkMessage.id)}
		<BookmarkModal
			bookmark={existing}
			newBookmarkData={existing ? undefined : {
				archiveId: openChat.archiveId,
				messageId: bookmarkMessage.id,
				chatTitle: openChat.title,
				messageContent: bookmarkMessage.content,
				sender: bookmarkMessage.sender,
				messageTimestamp: bookmarkMessage.timestamp,
			}}
			onClose={() => (bookmarkMessage = null)}
		/>
	{/if}
</div>
