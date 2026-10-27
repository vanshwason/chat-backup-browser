/**
 * Web Worker for computing chat statistics
 * Runs in a separate thread to prevent UI blocking
 */

/**
 * Simplified message format for statistics computation.
 * Only includes fields needed for stats (subset of ChatMessage from chat-parser.ts)
 */
interface ChatMessage {
	timestamp: string; // ISO string (Date doesn't survive postMessage)
	sender: string;
	isSystemMessage: boolean;
	content: string;
	isMediaMessage: boolean;
	mediaType?: string;
	/** True when the export contains the media file for this message */
	hasFile: boolean;
}

interface StatsWorkerInput {
	messages: ChatMessage[];
	messageCount: number;
	startDate: string | null;
	endDate: string | null;
}

export interface PersonStats {
	messages: number;
	words: number;
	emojis: number;
	photos: number;
	videos: number;
	voiceNotes: number;
	stickers: number;
	gifs: number;
	documents: number;
	viewOncePhotos: number;
	viewOnceVideos: number;
	links: number;
	deleted: number;
	edited: number;
	callsMade: number;
	videoCallsMade: number;
	callsAnswered: number;
	callsMissed: number;
	callSeconds: number;
	conversationsStarted: number;
	/** Median seconds before replying to the other person, or null */
	medianReplySeconds: number | null;
}

export interface CallStats {
	total: number;
	voice: number;
	video: number;
	answered: number;
	missed: number;
	totalSeconds: number;
	longest: { seconds: number; caller: string; timestamp: string } | null;
}

export interface StatsResult {
	messagesByParticipant: Record<string, number>;
	messagesByDate: Record<string, number>;
	messagesByHour: number[];
	mostActiveParticipant: string;
	mostActiveHour: number;
	avgMessagesPerDay: number;
	totalDays: number;
	people: Record<string, PersonStats>;
	calls: CallStats;
	busiestDay: { date: string; count: number } | null;
}

// A new "conversation" starts after this much silence
const CONVERSATION_GAP_MS = 4 * 60 * 60 * 1000;
// Replies slower than this are not counted as replies
const MAX_REPLY_MS = 12 * 60 * 60 * 1000;

const INVISIBLE = /[\u200B-\u200F\u2028-\u202F\uFEFF]/g;
const CALL = /^(missed )?(voice|video) call(?:,\s*(.*))?$/i;
const URL = /https?:\/\/\S+/g;
const EMOJI = /\p{Extended_Pictographic}/gu;
const DELETED = /^(this message was deleted|you deleted this message)\.?$/i;
const EDITED = /<this message was edited>/i;

function emptyPerson(): PersonStats {
	return {
		messages: 0,
		words: 0,
		emojis: 0,
		photos: 0,
		videos: 0,
		voiceNotes: 0,
		stickers: 0,
		gifs: 0,
		documents: 0,
		viewOncePhotos: 0,
		viewOnceVideos: 0,
		links: 0,
		deleted: 0,
		edited: 0,
		callsMade: 0,
		videoCallsMade: 0,
		callsAnswered: 0,
		callsMissed: 0,
		callSeconds: 0,
		conversationsStarted: 0,
		medianReplySeconds: null,
	};
}

/** "1 hr 5 min", "12 min", "45 sec" -> seconds; null when not a duration */
function parseDuration(text: string): number | null {
	const hr = /(\d+)\s*(?:hr|hrs|hour|hours|h)\b/i.exec(text);
	const min = /(\d+)\s*(?:min|mins|minute|minutes|m)\b/i.exec(text);
	const sec = /(\d+)\s*(?:sec|secs|second|seconds|s)\b/i.exec(text);
	if (!hr && !min && !sec) return null;
	return (
		(hr ? Number(hr[1]) * 3600 : 0) +
		(min ? Number(min[1]) * 60 : 0) +
		(sec ? Number(sec[1]) : 0)
	);
}

function median(values: number[]): number | null {
	if (values.length === 0) return null;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2
		? sorted[mid]
		: Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

self.onmessage = (event: MessageEvent<StatsWorkerInput>) => {
	const { messages, messageCount, startDate, endDate } = event.data;

	const messagesByParticipant = new Map<string, number>();
	const messagesByDate = new Map<string, number>();
	const messagesByHour = new Array(24).fill(0);
	const people = new Map<string, PersonStats>();
	const replyTimes = new Map<string, number[]>();
	const calls: CallStats = {
		total: 0,
		voice: 0,
		video: 0,
		answered: 0,
		missed: 0,
		totalSeconds: 0,
		longest: null,
	};

	let prevSender: string | null = null;
	let prevTime = 0;

	for (const message of messages) {
		if (message.isSystemMessage || !message.sender) continue;

		const sender = message.sender;
		const count = messagesByParticipant.get(sender) || 0;
		messagesByParticipant.set(sender, count + 1);

		// Parse date from ISO string
		const timestamp = new Date(message.timestamp);
		const time = timestamp.getTime();

		// Count by date (local day)
		const dateKey = `${timestamp.getFullYear()}-${String(timestamp.getMonth() + 1).padStart(2, '0')}-${String(timestamp.getDate()).padStart(2, '0')}`;
		messagesByDate.set(dateKey, (messagesByDate.get(dateKey) || 0) + 1);

		// Count by hour
		messagesByHour[timestamp.getHours()]++;

		let person = people.get(sender);
		if (!person) {
			person = emptyPerson();
			people.set(sender, person);
		}
		person.messages++;

		// Conversation starts and reply times
		if (prevSender === null || time - prevTime > CONVERSATION_GAP_MS) {
			person.conversationsStarted++;
		} else if (prevSender !== sender && time - prevTime <= MAX_REPLY_MS) {
			const list = replyTimes.get(sender) ?? [];
			list.push(Math.max(0, (time - prevTime) / 1000));
			replyTimes.set(sender, list);
		}
		prevSender = sender;
		prevTime = time;

		const text = message.content.replace(INVISIBLE, '').trim();

		// Calls: the sender of the call line is the person who called
		const call = CALL.exec(text);
		if (call) {
			const isMissed = !!call[1];
			const isVideo = call[2].toLowerCase() === 'video';
			const detail = call[3] ?? '';
			const seconds = isMissed ? null : parseDuration(detail);
			calls.total++;
			if (isVideo) calls.video++;
			else calls.voice++;
			person.callsMade++;
			if (isVideo) person.videoCallsMade++;
			if (seconds !== null) {
				calls.answered++;
				calls.totalSeconds += seconds;
				person.callsAnswered++;
				person.callSeconds += seconds;
				if (!calls.longest || seconds > calls.longest.seconds) {
					calls.longest = {
						seconds,
						caller: sender,
						timestamp: message.timestamp,
					};
				}
			} else {
				calls.missed++;
				person.callsMissed++;
			}
			continue;
		}

		if (message.isMediaMessage) {
			const omitted = /\bomitted\b/i.test(text);
			const isGif = /\bgif\b/i.test(text);
			switch (message.mediaType) {
				case 'image':
					person.photos++;
					if (omitted && !message.hasFile) person.viewOncePhotos++;
					break;
				case 'video':
					if (isGif) {
						person.gifs++;
					} else {
						person.videos++;
						if (omitted && !message.hasFile) person.viewOnceVideos++;
					}
					break;
				case 'audio':
					person.voiceNotes++;
					break;
				case 'sticker':
					person.stickers++;
					break;
				case 'document':
					person.documents++;
					break;
			}
			continue;
		}

		if (DELETED.test(text)) {
			person.deleted++;
			continue;
		}
		if (EDITED.test(text)) person.edited++;

		const links = text.match(URL)?.length ?? 0;
		person.links += links;
		person.emojis += text.match(EMOJI)?.length ?? 0;
		const words = text
			.replace(URL, ' ')
			.replace(EDITED, ' ')
			.split(/\s+/)
			.filter((w) => /[\p{L}\p{N}]/u.test(w));
		person.words += words.length;
	}

	for (const [sender, list] of replyTimes) {
		const person = people.get(sender);
		if (person) person.medianReplySeconds = median(list);
	}

	// Find most active participant
	let mostActiveParticipant = '';
	let maxMessages = 0;
	for (const [participant, count] of messagesByParticipant) {
		if (count > maxMessages) {
			maxMessages = count;
			mostActiveParticipant = participant;
		}
	}

	// Find most active hour
	const mostActiveHour = messagesByHour.indexOf(Math.max(...messagesByHour));

	let busiestDay: StatsResult['busiestDay'] = null;
	for (const [date, count] of messagesByDate) {
		if (!busiestDay || count > busiestDay.count) busiestDay = { date, count };
	}

	// Calculate average messages per day
	const start = startDate ? new Date(startDate) : null;
	const end = endDate ? new Date(endDate) : null;
	const daysDiff =
		start && end
			? Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) ||
				1
			: 1;
	const avgMessagesPerDay = Math.round(messageCount / daysDiff);

	const result: StatsResult = {
		messagesByParticipant: Object.fromEntries(messagesByParticipant),
		messagesByDate: Object.fromEntries(messagesByDate),
		messagesByHour,
		mostActiveParticipant,
		mostActiveHour,
		avgMessagesPerDay,
		totalDays: daysDiff,
		people: Object.fromEntries(people),
		calls,
		busiestDay,
	};

	self.postMessage(result);
};
