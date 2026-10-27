/**
 * Chat library served by the laptop (server/wa-server.mjs).
 *
 * When the web app is opened from that server, the export ZIPs in the
 * laptop's chats folder are listed and opened from it. The server has already
 * extracted each ZIP, so instead of downloading a whole archive the app gets a
 * file list, reads the chat text, and streams each media file on demand.
 */

import type JSZip from 'jszip';
import type { ArchiveId } from './global-search/archive-identity';

export interface RemoteChatInfo {
	id: string;
	name: string;
	size: number;
	mtime: number;
}

/** A JSZip-compatible view of an archive the server has extracted. */
export interface RemoteArchive {
	name: string;
	files: Record<string, JSZip.JSZipObject>;
}

interface Manifest {
	id: string;
	name: string;
	files: Array<{ p: string; s: number }>;
}

/** Returns the server's chat list, or null when not opened from the server. */
export async function fetchRemoteLibrary(): Promise<RemoteChatInfo[] | null> {
	if (typeof window === 'undefined' || 'electronAPI' in window) return null;
	try {
		const res = await fetch('api/library', { cache: 'no-store' });
		if (!res.ok) return null;
		if (!res.headers.get('content-type')?.includes('application/json')) {
			return null;
		}
		const body = (await res.json()) as { chats?: RemoteChatInfo[] };
		return Array.isArray(body.chats) ? body.chats : null;
	} catch {
		return null;
	}
}

/** Stable per-export identity so bookmarks survive reloads on the phone. */
export function remoteArchiveId(chat: RemoteChatInfo): ArchiveId {
	return `remote-${chat.id}`;
}

export function remoteFileUrl(chatId: string, entryPath: string): string {
	const encoded = entryPath.split('/').map(encodeURIComponent).join('/');
	return `api/chats/${chatId}/file/${encoded}`;
}

/** Fetches the extracted file list and wraps it in a JSZip-like shape. */
export async function openRemoteArchive(
	chat: RemoteChatInfo,
): Promise<RemoteArchive> {
	const res = await fetch(`api/chats/${chat.id}/manifest`, {
		cache: 'no-store',
	});
	if (!res.ok) throw new Error(`Could not open ${chat.name} (${res.status})`);
	const manifest = (await res.json()) as Manifest;

	const files: Record<string, JSZip.JSZipObject> = {};
	for (const { p, s } of manifest.files) {
		const url = remoteFileUrl(chat.id, p);
		const entry = {
			name: p,
			dir: false,
			remoteUrl: url,
			// Read by zip-parser for the media size
			_data: { uncompressedSize: s },
			async async(type: string) {
				const r = await fetch(url);
				if (!r.ok) throw new Error(`Failed to load ${p} (${r.status})`);
				if (type === 'string' || type === 'text') return r.text();
				if (type === 'blob') return r.blob();
				return r.arrayBuffer();
			},
		};
		files[p] = entry as unknown as JSZip.JSZipObject;
	}
	return { name: chat.name, files };
}
