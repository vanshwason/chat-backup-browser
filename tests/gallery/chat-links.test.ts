import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { groupChatLinks } from '../../src/lib/helpers/chat-links.ts';
import type { ChatMessage } from '../../src/lib/parser/chat-parser.ts';

const msg = (id: string, content: string, t: number) =>
	({ id, content, sender: 'Ana', timestamp: new Date(t) }) as ChatMessage;

describe('groupChatLinks', () => {
	it('groups by site, strips trailing punctuation, newest first', () => {
		const groups = groupChatLinks([
			msg('1', 'see https://www.youtube.com/watch?v=a.', 1),
			msg('2', 'no link here', 2),
			msg('3', '(https://youtu.be/b) and https://example.com/x', 3),
			msg('4', 'https://youtube.com/shorts/c!', 4),
		]);
		assert.deepEqual(
			groups.map((g) => [g.domain, g.links.length]),
			[
				['youtube.com', 2],
				['example.com', 1],
				['youtu.be', 1],
			],
		);
		assert.deepEqual(groups[0].links.map((l) => l.url), [
			'https://youtube.com/shorts/c',
			'https://www.youtube.com/watch?v=a',
		]);
		assert.equal(groups[2].links[0].url, 'https://youtu.be/b');
	});
});
