import type { ChatMessage } from '../parser/chat-parser';

export interface ChatLink {
	url: string;
	messageId: string;
	sender: string;
	timestamp: Date;
}

export interface LinkGroup {
	domain: string;
	links: ChatLink[];
}

const URL_RE = /https?:\/\/[^\s<>"'\u200E\u200F]+/gi;
// Sentence punctuation that commonly trails a pasted link
const TRAILING = /[).,;:!?\]}*_~]+$/;

function domainOf(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
	} catch {
		return url;
	}
}

/** Every link in the chat, grouped by site, biggest group first, newest link first. */
export function groupChatLinks(messages: readonly ChatMessage[]): LinkGroup[] {
	const groups = new Map<string, ChatLink[]>();
	for (const message of messages) {
		if (!message.content.includes('http')) continue;
		for (const raw of message.content.match(URL_RE) ?? []) {
			const url = raw.replace(TRAILING, '');
			const domain = domainOf(url);
			const list = groups.get(domain) ?? [];
			list.push({
				url,
				messageId: message.id,
				sender: message.sender,
				timestamp: message.timestamp,
			});
			groups.set(domain, list);
		}
	}
	return [...groups]
		.map(([domain, links]) => ({ domain, links: links.reverse() }))
		.sort(
			(a, b) =>
				b.links.length - a.links.length || a.domain.localeCompare(b.domain),
		);
}
