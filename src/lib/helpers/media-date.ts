/**
 * Write a message's send time inside a photo or video, so photo apps
 * (iPhone Photos, Google Photos, Immich) sort the saved file correctly.
 * Works in any browser: the date travels inside the file, not on it.
 *
 * - JPEG: adds EXIF DateTimeOriginal when the photo has no EXIF (WhatsApp
 *   strips it). A photo that already has EXIF is left untouched.
 * - MP4 / MOV: sets the creation time in the movie, track and media headers.
 * - Anything else is returned unchanged.
 */

const pad = (n: number, width = 2) => String(Math.abs(n)).padStart(width, '0');

function exifDate(date: Date): string {
	return `${date.getFullYear()}:${pad(date.getMonth() + 1)}:${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function exifOffset(date: Date): string {
	const minutes = -date.getTimezoneOffset();
	return `${minutes < 0 ? '-' : '+'}${pad(Math.trunc(minutes / 60))}:${pad(minutes % 60)}`;
}

/** A little-endian TIFF block with DateTime, DateTimeOriginal/Digitized and the offset. */
function buildExif(date: Date): Uint8Array {
	const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0)).concat(0);
	const when = ascii(exifDate(date)); // 20 bytes
	const offset = ascii(exifOffset(date)); // 7 bytes

	// Layout: header(8) | IFD0: 2 entries | Exif IFD: 3 entries | values
	const ifd0At = 8;
	const ifd0Size = 2 + 2 * 12 + 4;
	const exifAt = ifd0At + ifd0Size;
	const exifSize = 2 + 3 * 12 + 4;
	let valuesAt = exifAt + exifSize;
	const dateAt = valuesAt;
	valuesAt += when.length;
	const offsetAt = valuesAt;
	valuesAt += offset.length;

	const tiff = new Uint8Array(valuesAt);
	const view = new DataView(tiff.buffer);
	tiff.set([0x49, 0x49, 0x2a, 0x00]); // "II*\0"
	view.setUint32(4, ifd0At, true);

	const entry = (
		at: number,
		tag: number,
		type: number,
		count: number,
		value: number,
	) => {
		view.setUint16(at, tag, true);
		view.setUint16(at + 2, type, true);
		view.setUint32(at + 4, count, true);
		view.setUint32(at + 8, value, true);
	};
	const ASCII = 2;
	const LONG = 4;

	view.setUint16(ifd0At, 2, true);
	entry(ifd0At + 2, 0x0132, ASCII, when.length, dateAt); // DateTime
	entry(ifd0At + 14, 0x8769, LONG, 1, exifAt); // Exif IFD pointer
	view.setUint32(ifd0At + 26, 0, true);

	view.setUint16(exifAt, 3, true);
	entry(exifAt + 2, 0x9003, ASCII, when.length, dateAt); // DateTimeOriginal
	entry(exifAt + 14, 0x9004, ASCII, when.length, dateAt); // DateTimeDigitized
	entry(exifAt + 26, 0x9011, ASCII, offset.length, offsetAt); // OffsetTimeOriginal
	view.setUint32(exifAt + 38, 0, true);

	tiff.set(when, dateAt);
	tiff.set(offset, offsetAt);

	// APP1 segment: marker, length, "Exif\0\0", TIFF
	const segment = new Uint8Array(4 + 6 + tiff.length);
	const sv = new DataView(segment.buffer);
	sv.setUint16(0, 0xffe1);
	sv.setUint16(2, 2 + 6 + tiff.length);
	segment.set([0x45, 0x78, 0x69, 0x66, 0, 0], 4);
	segment.set(tiff, 10);
	return segment;
}

function stampJpeg(bytes: Uint8Array, date: Date): Uint8Array {
	if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
	// Walk the header segments: keep any existing EXIF, insert after JFIF
	let insertAt = 2;
	let at = 2;
	while (at + 4 <= bytes.length && bytes[at] === 0xff) {
		const marker = bytes[at + 1];
		if (marker === 0xda || marker === 0xd9) break; // image data starts
		const length = (bytes[at + 2] << 8) | bytes[at + 3];
		if (
			marker === 0xe1 &&
			bytes[at + 4] === 0x45 &&
			bytes[at + 5] === 0x78 &&
			bytes[at + 6] === 0x69 &&
			bytes[at + 7] === 0x66
		) {
			// shortcut: existing EXIF is kept as is, even without a date; merge tags if that turns up
			return bytes;
		}
		if (marker === 0xe0) insertAt = at + 2 + length;
		at += 2 + length;
	}
	const exif = buildExif(date);
	const out = new Uint8Array(bytes.length + exif.length);
	out.set(bytes.subarray(0, insertAt));
	out.set(exif, insertAt);
	out.set(bytes.subarray(insertAt), insertAt + exif.length);
	return out;
}

// Seconds between 1904-01-01 (QuickTime epoch) and 1970-01-01
const QT_EPOCH = 2_082_844_800;
const CONTAINERS = new Set(['moov', 'trak', 'mdia']);
const HEADERS = new Set(['mvhd', 'tkhd', 'mdhd']);

function stampMp4(bytes: Uint8Array, date: Date): Uint8Array {
	const type = (at: number) =>
		String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);
	if (bytes.length < 12 || type(4) !== 'ftyp') return bytes;
	const out = bytes.slice();
	const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
	const seconds = BigInt(Math.floor(date.getTime() / 1000) + QT_EPOCH);
	let changed = false;

	const walk = (start: number, end: number) => {
		let at = start;
		while (at + 8 <= end) {
			let size = view.getUint32(at);
			let header = 8;
			if (size === 1) {
				if (at + 16 > end) return;
				size = Number(view.getBigUint64(at + 8));
				header = 16;
			} else if (size === 0) {
				size = end - at;
			}
			if (size < header || at + size > end) return;
			const name = type(at + 4);
			const body = at + header;
			if (CONTAINERS.has(name)) {
				walk(body, at + size);
			} else if (HEADERS.has(name) && body + 20 <= at + size) {
				const version = out[body];
				if (version === 1) {
					view.setBigUint64(body + 4, seconds);
					view.setBigUint64(body + 12, seconds);
				} else {
					view.setUint32(body + 4, Number(seconds & 0xffffffffn));
					view.setUint32(body + 8, Number(seconds & 0xffffffffn));
				}
				changed = true;
			}
			at += size;
		}
	};
	walk(0, out.length);
	return changed ? out : bytes;
}

export function stampMediaDate(
	bytes: Uint8Array,
	fileName: string,
	date: Date | null,
): Uint8Array {
	if (!date || !Number.isFinite(date.getTime())) return bytes;
	const ext = fileName.toLowerCase().split('.').pop();
	if (ext === 'jpg' || ext === 'jpeg') return stampJpeg(bytes, date);
	if (ext === 'mp4' || ext === 'mov' || ext === 'm4v' || ext === '3gp')
		return stampMp4(bytes, date);
	return bytes;
}
