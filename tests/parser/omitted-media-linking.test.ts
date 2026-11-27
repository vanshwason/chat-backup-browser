import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { describe, it } from 'vitest';
import { parseZipFile } from '../../src/lib/parser/zip-parser.ts';

async function parse(chat: string, files: string[]) {
	const zip = new JSZip();
	zip.file('_chat.txt', chat);
	for (const name of files) zip.file(name, new Uint8Array([0]));
	return parseZipFile(await zip.generateAsync({ type: 'arraybuffer' }));
}

describe('linking "omitted" media to files', () => {
	it('links files whose names sit a time-zone offset (and a second) away', async () => {
		// Seen in a real iOS export: names 1h30m behind the chat clock
		const chat = [
			'[03/05/26, 15:08:52] Ana: ‎image omitted',
			'[03/05/26, 15:15:58] Ben: ‎sticker omitted',
			'[03/05/26, 18:34:03] Ana: ‎audio omitted',
		].join('\n');
		const parsed = await parse(chat, [
			'00000055-PHOTO-2026-05-03-13-38-52.jpg',
			'00000057-STICKER-2026-05-03-13-45-57.webp',
			'00000063-AUDIO-2026-05-03-17-04-03.opus',
		]);
		const senders = parsed.mediaFiles.map((m) => m.messageSender);
		assert.deepEqual(senders, ['Ana', 'Ben', 'Ana']);
		assert.ok(parsed.mediaFiles.every((m) => m.messageId));
	});

	it('links documents named without the "<seq>-" prefix', async () => {
		const chat =
			'[08/05/26, 21:43:49] Ana: Paytm_1778251420909.pdf • ‎3 pages ‎document omitted';
		const parsed = await parse(chat, ['00000606-Paytm_1778251420909.pdf']);
		assert.equal(parsed.mediaFiles[0].messageSender, 'Ana');
	});
});
