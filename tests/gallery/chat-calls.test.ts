import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { parseCall } from '../../src/lib/helpers/chat-calls.ts';

describe('parseCall', () => {
	it('reads the call lines real exports contain', () => {
		assert.deepEqual(parseCall('‎Voice call, ‎20 sec'), {
			video: false,
			missed: false,
			duration: '20 sec',
		});
		assert.deepEqual(parseCall('‎Missed voice call, ‎Tap to call back'), {
			video: false,
			missed: true,
			duration: null,
		});
		assert.deepEqual(parseCall('‎Voice call, ‎No answer'), {
			video: false,
			missed: true,
			duration: null,
		});
		assert.deepEqual(parseCall('Video call, 1 hr'), {
			video: true,
			missed: false,
			duration: '1 hr',
		});
	});

	it('ignores messages that only mention calls', () => {
		assert.equal(parseCall('People around me all love video calls'), null);
		assert.equal(parseCall('Does this refer to a video call or not'), null);
	});
});
