/**
 * Regenerates every app icon and social image from branding/logo.svg.
 *
 *   node branding/generate-icons.mjs
 *
 * Uses sharp, which is already installed as a dependency of
 * @huggingface/transformers. Writes into static/ and src/lib/assets/.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = (p) => path.join(ROOT, p);

const logo = await readFile(out('branding/logo.svg'), 'utf8');

// Full-bleed variant: the tile fills the square. iOS and Android mask icons
// themselves and show black where a PNG is transparent.
const fullBleed = logo.replace(
	/<rect x="64" y="64" width="896" height="896" rx="208"/,
	'<rect x="0" y="0" width="1024" height="1024"',
);

const render = (svg, size) =>
	sharp(Buffer.from(svg), { density: Math.max(72, (72 * size) / 1024) * 4 })
		.resize(size, size)
		.png({ compressionLevel: 9 })
		.toBuffer();

async function png(svg, size, file) {
	await writeFile(out(file), await render(svg, size));
}

/** ICO with PNG-compressed entries (supported since Windows Vista). */
async function ico(sizes, file) {
	const images = await Promise.all(sizes.map((s) => render(logo, s)));
	const header = Buffer.alloc(6 + 16 * sizes.length);
	header.writeUInt16LE(0, 0);
	header.writeUInt16LE(1, 2);
	header.writeUInt16LE(sizes.length, 4);
	let offset = header.length;
	sizes.forEach((size, i) => {
		const e = 6 + 16 * i;
		header.writeUInt8(size >= 256 ? 0 : size, e);
		header.writeUInt8(size >= 256 ? 0 : size, e + 1);
		header.writeUInt16LE(1, e + 4); // colour planes
		header.writeUInt16LE(32, e + 6); // bits per pixel
		header.writeUInt32LE(images[i].length, e + 8);
		header.writeUInt32LE(offset, e + 12);
		offset += images[i].length;
	});
	await writeFile(out(file), Buffer.concat([header, ...images]));
}

/** ICNS with PNG entries (macOS 10.7+). */
async function icns(file) {
	const types = [
		['icp4', 16],
		['icp5', 32],
		['icp6', 64],
		['ic07', 128],
		['ic08', 256],
		['ic09', 512],
		['ic10', 1024],
	];
	const chunks = [];
	for (const [type, size] of types) {
		const data = await render(padded, size);
		const head = Buffer.alloc(8);
		head.write(type, 0, 'ascii');
		head.writeUInt32BE(data.length + 8, 4);
		chunks.push(head, data);
	}
	const body = Buffer.concat(chunks);
	const head = Buffer.alloc(8);
	head.write('icns', 0, 'ascii');
	head.writeUInt32BE(body.length + 8, 4);
	await writeFile(out(file), Buffer.concat([head, body]));
}

// macOS icons sit inside a ~80% grid with transparent margin
const padded = logo.replace(
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">',
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-40 -40 1104 1104">',
);

/** Social preview card with the logo and the app name. */
function card(width, height) {
	const square = width === height;
	const logoSize = square ? 360 : 280;
	const logoX = square ? (width - logoSize) / 2 : 100;
	const logoY = square ? 120 : (height - logoSize) / 2;
	const textX = square ? width / 2 : 430;
	const anchor = square ? 'middle' : 'start';
	const titleY = square ? 580 : 290;
	const inner = logo
		.replace(/^<svg[^>]*>/, '')
		.replace(/<\/svg>\s*$/, '')
		.replace('id="tile"', 'id="cardtile"')
		.replace('url(#tile)', 'url(#cardtile)');
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
	<defs>
		<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
			<stop offset="0" stop-color="#0B141A" />
			<stop offset="1" stop-color="#103529" />
		</linearGradient>
	</defs>
	<rect width="${width}" height="${height}" fill="url(#bg)" />
	<svg x="${logoX}" y="${logoY}" width="${logoSize}" height="${logoSize}" viewBox="0 0 1024 1024">${inner}</svg>
	<g font-family="Segoe UI, Helvetica, Arial, sans-serif" text-anchor="${anchor}">
		<text x="${textX}" y="${titleY}" font-size="${square ? 64 : 66}" font-weight="700" fill="#FFFFFF">Chat Backup Browser</text>
		<text x="${textX}" y="${titleY + (square ? 60 : 64)}" font-size="${square ? 28 : 30}" fill="#8696A0">Your WhatsApp chat exports, offline</text>
		<text x="${textX}" y="${titleY + (square ? 102 : 110)}" font-size="${square ? 28 : 30}" fill="#25D366">Desktop · Phone · 100% private</text>
	</g>
</svg>`;
}

await Promise.all([
	png(logo, 512, 'static/icon.png'),
	png(padded, 1024, 'static/icon_macos_padded.png'),
	png(logo, 96, 'static/favicon-96x96.png'),
	png(logo, 256, 'src/lib/assets/favicon.png'),
	png(fullBleed, 180, 'static/apple-touch-icon.png'),
	png(fullBleed, 192, 'static/web-app-manifest-192x192.png'),
	png(fullBleed, 512, 'static/web-app-manifest-512x512.png'),
	ico([16, 24, 32, 48, 64, 128, 256], 'static/icon.ico'),
	ico([16, 32, 48], 'static/favicon.ico'),
	icns('static/icon.icns'),
	sharp(Buffer.from(card(1200, 630))).png().toFile(out('static/og-image.png')),
	sharp(Buffer.from(card(1200, 630)))
		.png()
		.toFile(out('static/og-image-twitter.png')),
	sharp(Buffer.from(card(800, 800)))
		.png()
		.toFile(out('static/og-image-square.png')),
]);

console.log('Icons and social images regenerated from branding/logo.svg');
