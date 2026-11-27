import type { ChatMessage } from '../parser/chat-parser';

export interface CallInfo {
	video: boolean;
	missed: boolean;
	/** Duration as the export wrote it ("20 sec", "1 hr"), or null */
	duration: string | null;
}

const INVISIBLE = /[\u200B-\u200F\u2028-\u202F\uFEFF]/g;
const CALL = /^(missed )?(voice|video) call(?:,\s*(.*))?$/i;
const NOT_ANSWERED = /^(no answer|tap to call back|declined|busy)$/i;

/** A call entry from an English export ("Voice call, 20 sec"), else null. */
export function parseCall(content: string): CallInfo | null {
	if (content.length > 80) return null;
	const match = content.replace(INVISIBLE, '').trim().match(CALL);
	if (!match) return null;
	const detail = match[3]?.trim() || null;
	const unanswered = !!detail && NOT_ANSWERED.test(detail);
	return {
		video: match[2].toLowerCase() === 'video',
		missed: !!match[1] || unanswered,
		duration: detail && !unanswered ? detail : null,
	};
}

export interface CallEntry extends CallInfo {
	messageId: string;
	sender: string;
	timestamp: Date;
}

/** Every call in the chat, newest first. */
export function listCalls(messages: readonly ChatMessage[]): CallEntry[] {
	const calls: CallEntry[] = [];
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		const call = parseCall(message.content);
		if (call) {
			calls.push({
				...call,
				messageId: message.id,
				sender: message.sender,
				timestamp: message.timestamp,
			});
		}
	}
	return calls;
}
