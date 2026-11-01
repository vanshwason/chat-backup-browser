import JSZip from 'jszip';
import { describe, expect, it, vi } from 'vitest';
import { openLazyZip, type RangeReader } from '../../src/lib/parser/lazy-zip';

async function buildZip(compression: 'STORE' | 'DEFLATE') {
	const zip = new JSZip();
	zip.file('_chat.txt', 'héllo wörld '.repeat(500));
	zip.file('photos/IMG-1.jpg', new Uint8Array([1, 2, 3, 4, 5]));
	zip.file('empty.txt', '');
	zip.folder('folder');
	const bytes = await zip.generateAsync({ type: 'uint8array', compression });
	const read: RangeReader = async (offset, length) =>
		bytes.slice(offset, offset + length).buffer as ArrayBuffer;
	return { bytes, read };
}

describe('openLazyZip', () => {
	it.each(['STORE', 'DEFLATE'] as const)(
		'reads %s entries with their contents and sizes',
		async (compression) => {
			const { bytes, read } = await buildZip(compression);
			const archive = await openLazyZip('a.zip', bytes.length, read);

			const chat = archive.files['_chat.txt'];
			expect(await chat.async('string')).toBe('héllo wörld '.repeat(500));

			const image = archive.files['photos/IMG-1.jpg'];
			const data = await image.async('arraybuffer');
			expect([...new Uint8Array(data)]).toEqual([1, 2, 3, 4, 5]);
			expect(
				(image as unknown as { _data: { uncompressedSize: number } })._data
					.uncompressedSize,
			).toBe(5);

			expect(await archive.files['empty.txt'].async('string')).toBe('');
			expect(archive.files['folder/'].dir).toBe(true);
		},
	);

	it('reads only the directory until an entry is requested', async () => {
		const { bytes, read } = await buildZip('DEFLATE');
		const spy = vi.fn(read);
		const archive = await openLazyZip('a.zip', bytes.length, spy);
		const openedBytes = spy.mock.calls.reduce((n, [, len]) => n + len, 0);
		expect(spy).toHaveBeenCalledTimes(2);

		spy.mockClear();
		await archive.files['photos/IMG-1.jpg'].async('blob');
		expect(spy).toHaveBeenCalledTimes(2);
		expect(openedBytes).toBeGreaterThan(0);
	});

	it('rejects a file that is not a ZIP', async () => {
		const bytes = new Uint8Array(1024);
		const read: RangeReader = async (o, l) =>
			bytes.slice(o, o + l).buffer as ArrayBuffer;
		await expect(openLazyZip('a.zip', 1024, read)).rejects.toThrow(
			'Not a ZIP file',
		);
	});

	it('rejects encrypted entries so callers can fall back', async () => {
		const { bytes } = await buildZip('STORE');
		const copy = bytes.slice();
		const view = new DataView(copy.buffer);
		for (let i = 0; i + 4 <= copy.length; i++) {
			if (view.getUint32(i, true) === 0x02014b50) {
				view.setUint16(i + 8, view.getUint16(i + 8, true) | 1, true);
				break;
			}
		}
		const read: RangeReader = async (o, l) =>
			copy.slice(o, o + l).buffer as ArrayBuffer;
		await expect(openLazyZip('a.zip', copy.length, read)).rejects.toThrow(
			'Encrypted',
		);
	});

	it('rejects an entry whose size does not match its directory record', async () => {
		const { bytes } = await buildZip('STORE');
		const copy = bytes.slice();
		const view = new DataView(copy.buffer);
		for (let i = 0; i + 4 <= copy.length; i++) {
			if (view.getUint32(i, true) === 0x02014b50) {
				view.setUint32(i + 24, view.getUint32(i + 24, true) + 1, true);
				break;
			}
		}
		const read: RangeReader = async (o, l) =>
			copy.slice(o, o + l).buffer as ArrayBuffer;
		const archive = await openLazyZip('a.zip', copy.length, read);
		await expect(archive.files['_chat.txt'].async('string')).rejects.toThrow(
			'Corrupt ZIP entry',
		);
	});
});
