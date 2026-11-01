/**
 * Shared file-picker helpers for ZIP imports.
 *
 * Centralises the showOpenFilePicker (Web) and Electron picker patterns so they
 * are not duplicated across FileDropZone, ReselectFileModal, and +page.svelte.
 */

/**
 * Open the native file picker for ZIP files (Web — File System Access API).
 * Returns null if the API is not supported or the user cancelled.
 */
export async function openZipFilePicker(multiple = false): Promise<{
	files: File[];
	handles?: FileSystemFileHandle[];
} | null> {
	if (!('showOpenFilePicker' in window)) return null;

	try {
		const handles = await window.showOpenFilePicker({
			types: [
				{
					description: 'WhatsApp ZIP files',
					accept: { 'application/zip': ['.zip'] },
				},
			],
			multiple,
		});
		if (!handles?.length) return null;

		const files: File[] = [];
		for (const h of handles) {
			files.push(await h.getFile());
		}
		return { files, handles };
	} catch {
		// User cancelled or API failed
		return null;
	}
}

/**
 * Open a ZIP in Electron and return a File + absolute path. A file input gives
 * a disk-backed File, so nothing is loaded into memory by picking it.
 * Returns null when not running in Electron or the user cancelled.
 */
export async function openElectronFile(): Promise<{
	file: File;
	path: string;
} | null> {
	if (!window.electronAPI) return null;

	return new Promise((resolve) => {
		const input = document.createElement('input');
		input.type = 'file';
		input.accept = '.zip';
		input.onchange = () => {
			const file = input.files?.[0];
			resolve(file ? { file, path: getElectronFilePath(file) ?? '' } : null);
		};
		input.oncancel = () => resolve(null);
		input.click();
	});
}

/**
 * Extract the absolute file path that Electron attaches to drag-dropped files.
 * Returns undefined when not running in Electron or the path cannot be resolved.
 *
 * Electron 32 removed the non-standard `File#path` property; `webUtils.getPathForFile`
 * (exposed via the preload script) is the supported replacement — it returns an empty
 * string (not undefined) for a File not backed by a real path, so that's normalized
 * here too. The `'path' in file` check is kept as a fallback for older Electron builds.
 */
export function getElectronFilePath(file: File): string | undefined {
	return (
		window.electronAPI?.getPathForFile?.(file) ||
		('path' in file ? (file as File & { path: string }).path : undefined)
	);
}
