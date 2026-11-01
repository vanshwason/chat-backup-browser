// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces

interface FileReadResult {
	success: boolean;
	buffer?: ArrayBuffer;
	name?: string;
	error?: string;
}

interface ElectronAPI {
	zipFileSize: (filePath: string) => Promise<number | null>;
	readZipRange: (
		filePath: string,
		offset: number,
		length: number,
	) => Promise<ArrayBuffer>;
	readFileFromPath: (filePath: string) => Promise<FileReadResult>;
	getPathForFile: (file: File) => string;
	openExternal: (url: string) => Promise<void>;
	platform: string;
	isElectron: boolean;
	updater?: {
		checkForUpdates: () => Promise<void>;
		downloadUpdate: () => Promise<void>;
		quitAndInstall: () => void;
		onStatus: (
			callback: (data: { event: string; data?: unknown }) => void,
		) => () => void;
	};
}

declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	// File System Access API types (experimental, not in default TypeScript libs)
	// See https://wicg.github.io/file-system-access/
	interface FileSystemHandlePermissionDescriptor {
		mode?: 'read' | 'readwrite';
	}

	interface OpenFilePickerOptions {
		types?: {
			description?: string;
			accept: Record<string, string[]>;
		}[];
		multiple?: boolean;
		excludeAcceptAllOption?: boolean;
	}

	interface FileSystemFileHandle {
		queryPermission(
			descriptor?: FileSystemHandlePermissionDescriptor,
		): Promise<PermissionState>;
		requestPermission(
			descriptor?: FileSystemHandlePermissionDescriptor,
		): Promise<PermissionState>;
	}

	interface DataTransferItem {
		getAsFileSystemHandle(): Promise<FileSystemHandle | null>;
	}

	interface Window {
		electronAPI?: ElectronAPI;
		showOpenFilePicker(
			options?: OpenFilePickerOptions,
		): Promise<FileSystemFileHandle[]>;
	}
}

export {};
