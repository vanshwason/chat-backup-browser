import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { parseChat } from '../../src/lib/parser/chat-parser.ts';

const day = (d: Date) =>
	`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;

describe('US iPhone exports with a 12-hour clock', () => {
	for (const [label, sp] of [
		['space', ' '],
		['narrow no-break space', ' '],
	]) {
		it(`reads month-first dates (${label} before AM/PM)`, () => {
			const chat = [
				`‎[1/12/24, 9:41:05${sp}PM] Alice: ‎Messages and calls are end-to-end encrypted.`,
				`[1/12/24, 9:41:05${sp}PM] Alice: hey`,
				`[1/13/24, 10:02:11${sp}AM] Bob: hi there`,
				`[2/28/24, 7:15:00${sp}PM] Bob: ‎image omitted`,
			].join('\n');
			const { messages } = parseChat(chat);
			assert.equal(messages.length, 4);
			assert.deepEqual(messages.map((m) => day(m.timestamp)), [
				'2024-1-12 21:41',
				'2024-1-12 21:41',
				'2024-1-13 10:02',
				'2024-2-28 19:15',
			]);
		});
	}

	it('finds messages when every date is month-first only (issue #1)', () => {
		const chat = '[11/25/26, 10:15:30 PM] Alice: hello\n[11/25/26, 10:16:01 PM] Bob: hi';
		assert.equal(parseChat(chat).messages.length, 2);
	});

	it('keeps day-first 12-hour exports day-first', () => {
		const chat = '[25/11/2026, 10:15:30 pm] Alice: hello\n[3/4/2026, 9:00:00 am] Bob: hi';
		const { messages } = parseChat(chat);
		assert.deepEqual(messages.map((m) => day(m.timestamp)), [
			'2026-11-25 22:15',
			'2026-4-3 9:00',
		]);
	});
});
