import { afterEach, describe, expect, it, vi } from 'vitest';
import { savedThumbnailKey } from '../../src/lib/gallery-thumbnails';
import type { MediaFile } from '../../src/lib/parser/zip-parser';

const photo = (extra: Partial<MediaFile> = {}): MediaFile =>
	({
		name: 'IMG-1.jpg',
		path: 'IMG-1.jpg',
		type: 'image',
		size: 5,
		_zipEntry: { _data: { crc32: 1234 } },
		...extra,
	}) as MediaFile;

describe('savedThumbnailKey', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('keys laptop-served photos by their URL', () => {
		expect(savedThumbnailKey(photo({ remoteUrl: 'api/chats/abc/file/x' }))).toBe(
			'api/chats/abc/file/x',
		);
	});

	it('keys desktop photos by checksum, size and name', () => {
		vi.stubGlobal('window', { electronAPI: {} });
		expect(savedThumbnailKey(photo())).toBe('zip:1234:5:IMG-1.jpg');
	});

	it('saves nothing for the web version, or for non-images', () => {
		expect(savedThumbnailKey(photo())).toBeNull();
		vi.stubGlobal('window', { electronAPI: {} });
		expect(savedThumbnailKey(photo({ type: 'video' }))).toBeNull();
		expect(savedThumbnailKey(photo({ _zipEntry: undefined }))).toBeNull();
	});
});
