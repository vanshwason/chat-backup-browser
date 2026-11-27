import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { stampMediaDate } from '../../src/lib/helpers/media-date.ts';

const sent = new Date(2026, 4, 3, 15, 8, 52); // local time

/** SOI, APP0 JFIF, a tiny SOS + EOI */
function plainJpeg(): Uint8Array {
	return new Uint8Array([
		0xff, 0xd8,
		0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
		0xff, 0xda, 0x00, 0x02, 0x11, 0x22,
		0xff, 0xd9,
	]);
}

function box(type: string, body: Uint8Array): Uint8Array {
	const out = new Uint8Array(8 + body.length);
	new DataView(out.buffer).setUint32(0, out.length);
	out.set([...type].map((c) => c.charCodeAt(0)), 4);
	out.set(body, 8);
	return out;
}
const concat = (...parts: Uint8Array[]) => {
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
};

describe('stampMediaDate', () => {
	it('adds EXIF dates to a JPEG without EXIF, after JFIF, keeping the image', () => {
		const input = plainJpeg();
		const out = stampMediaDate(input, 'IMG.jpg', sent);
		const text = new TextDecoder('latin1').decode(out);
		assert.ok(text.includes('Exif\0\0II*'));
		assert.equal(text.split('2026:05:03 15:08:52').length - 1, 1); // shared by all three date tags
		assert.equal(out[20], 0xff);
		assert.equal(out[21], 0xe1); // APP1 right after APP0
		assert.deepEqual([...out.slice(-8)], [...input.slice(-8)]); // scan data intact
	});

	it('leaves a JPEG that already has EXIF untouched', () => {
		const withExif = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0, 0, 0xff, 0xd9]);
		assert.equal(stampMediaDate(withExif, 'a.jpeg', sent), withExif);
	});

	it('sets creation time in mvhd/tkhd/mdhd of an MP4', () => {
		const header = () => new Uint8Array(100); // version 0, zero times
		const mp4 = concat(
			box('ftyp', new Uint8Array(8)),
			box('moov', concat(box('mvhd', header()), box('trak', concat(box('tkhd', header()), box('mdia', box('mdhd', header())))))),
		);
		const out = stampMediaDate(mp4, 'VID.mp4', sent);
		const view = new DataView(out.buffer);
		const expected = Math.floor(sent.getTime() / 1000) + 2_082_844_800;
		const find = (name: string) => new TextDecoder('latin1').decode(out).indexOf(name) + 4;
		for (const name of ['mvhd', 'tkhd', 'mdhd']) {
			assert.equal(view.getUint32(find(name) + 4), expected, name);
		}
	});

	it('returns other files and missing dates unchanged', () => {
		const opus = new Uint8Array([1, 2, 3]);
		assert.equal(stampMediaDate(opus, 'a.opus', sent), opus);
		assert.equal(stampMediaDate(plainJpeg(), 'a.jpg', null).length, plainJpeg().length);
	});
});
