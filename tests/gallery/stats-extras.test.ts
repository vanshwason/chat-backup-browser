import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { addWords, longestStreak, topN } from '../../src/lib/workers/stats-extras.ts';

describe('stats extras', () => {
	it('counts meaningful words, skipping filler and numbers', () => {
		const counts = new Map<string, number>();
		addWords(counts, 'Kya scene hai? Pizza tonight! pizza, 2024 the pizza');
		addWords(counts, "Movie tonight, don't forget");
		assert.deepEqual(topN(counts, 3), [
			['pizza', 3],
			['tonight', 2],
			['forget', 1],
		]);
	});

	it('finds the longest run of consecutive days', () => {
		assert.deepEqual(
			longestStreak(['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-05', '2026-02-06']),
			{ days: 3, start: '2026-01-30', end: '2026-02-01' },
		);
		assert.equal(longestStreak([]), null);
	});
});
