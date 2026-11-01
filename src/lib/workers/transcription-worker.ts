/**
 * Web Worker for audio transcription using Whisper via Transformers.js
 * Runs model inference off the main thread to keep UI responsive
 */

import {
	type AutomaticSpeechRecognitionPipeline,
	pipeline,
	Tensor,
} from '@huggingface/transformers';

// Model configuration
const MODEL_ID = 'Xenova/whisper-small';
// Audio this short stays in one chunk, given chunk_length_s below
const CHUNK_LENGTH_S = 30;
const CHUNK_SAMPLES = CHUNK_LENGTH_S * 16_000;
// whisper-small's text for these is unusable, mostly on mixed Hindi and English
// speech, while its English translation of the same audio reads well
const TRANSLATED_LANGUAGES = new Set(['hi', 'ur']);

let whisperPipeline: AutomaticSpeechRecognitionPipeline | null = null;
let isLoading = false;

interface WhisperConfig {
	decoder_start_token_id: number;
	lang_to_id: Record<string, number>;
}

// Message types
interface LoadModelMessage {
	type: 'load-model';
}

interface TranscribeMessage {
	type: 'transcribe';
	audioData: Float32Array;
	language: string;
	messageId: string;
}

type WorkerMessage = LoadModelMessage | TranscribeMessage;

interface ProgressResponse {
	type: 'progress';
	progress: number;
	status?: string;
}

interface ModelReadyResponse {
	type: 'model-ready';
}

interface ModelErrorResponse {
	type: 'model-error';
	error: string;
}

interface TranscriptionResultResponse {
	type: 'transcription-result';
	messageId: string;
	text: string;
}

interface TranscriptionErrorResponse {
	type: 'transcription-error';
	messageId: string;
	error: string;
}

/**
 * Load the Whisper model
 */
async function loadModel(): Promise<void> {
	if (whisperPipeline || isLoading) return;

	isLoading = true;

	try {
		// @ts-expect-error - pipeline types are complex
		whisperPipeline = await pipeline('automatic-speech-recognition', MODEL_ID, {
			dtype: 'q8',
			device: 'wasm',
			progress_callback: (progress: { progress?: number; status?: string }) => {
				const response: ProgressResponse = {
					type: 'progress',
					progress:
						progress.progress !== undefined ? Math.round(progress.progress) : 0,
					status: progress.status,
				};
				self.postMessage(response);
			},
		});

		// generate() drops inputs missing from this list, which would run the
		// encoder again for audio detectLanguage() already encoded
		const model = whisperPipeline.model as unknown as {
			forward_params: string[];
		};
		model.forward_params = [...model.forward_params, 'encoder_outputs'];

		const response: ModelReadyResponse = { type: 'model-ready' };
		self.postMessage(response);
	} catch (e) {
		const response: ModelErrorResponse = {
			type: 'model-error',
			error: e instanceof Error ? e.message : 'Failed to load model',
		};
		self.postMessage(response);
	} finally {
		isLoading = false;
	}
}

// Note: Audio decoding happens on the main thread since AudioContext
// is not available in Web Workers. We receive pre-decoded Float32Array.

/**
 * Detect the spoken language from the first 30 seconds of audio.
 * Transformers.js treats a missing language as English instead of detecting
 * it, so compare the language tokens the model scores right after
 * <|startoftranscript|>, which is where Whisper predicts the language.
 * Returns the encoder output too: running the encoder is most of the cost.
 */
async function detectLanguage(
	pipe: AutomaticSpeechRecognitionPipeline,
	audioData: Float32Array,
): Promise<{ language: string; encoderOutputs: Tensor }> {
	const { input_features } = await pipe.processor(
		audioData.subarray(0, CHUNK_SAMPLES),
	);
	const { encoder_outputs } =
		await pipe.model._prepare_encoder_decoder_kwargs_for_generation({
			inputs_tensor: input_features,
			model_inputs: { input_features },
			model_input_name: 'input_features',
			generation_config: { guidance_scale: null },
		});
	const { decoder_start_token_id, lang_to_id } = pipe.model
		.generation_config as unknown as WhisperConfig;
	const { logits } = await pipe.model.forward({
		input_features,
		encoder_outputs,
		decoder_input_ids: new Tensor(
			'int64',
			[BigInt(decoder_start_token_id)],
			[1, 1],
		),
	});
	let language = 'en';
	let best = Number.NEGATIVE_INFINITY;
	for (const [token, id] of Object.entries(lang_to_id)) {
		if (logits.data[id] > best) {
			best = logits.data[id];
			language = token.slice(2, -2);
		}
	}
	return { language, encoderOutputs: encoder_outputs };
}

/**
 * Transcribe pre-decoded audio data
 */
async function transcribe(
	audioData: Float32Array,
	language: string,
	messageId: string,
): Promise<void> {
	try {
		// Ensure model is loaded
		if (!whisperPipeline) {
			await loadModel();
		}

		if (!whisperPipeline) {
			throw new Error('Model not available');
		}

		// Build options
		const options: Record<string, unknown> = {
			chunk_length_s: CHUNK_LENGTH_S,
			stride_length_s: 5,
			return_timestamps: false,
			// Stops Whisper looping on one phrase until it hits the length limit
			no_repeat_ngram_size: 3,
			task: 'transcribe',
		};

		if (language === 'auto') {
			const detected = await detectLanguage(whisperPipeline, audioData);
			options.language = detected.language;
			if (TRANSLATED_LANGUAGES.has(detected.language)) {
				options.task = 'translate';
			}
			// The pipeline hands options to every chunk, so only a single chunk
			// can reuse this
			if (audioData.length <= CHUNK_SAMPLES) {
				options.encoder_outputs = detected.encoderOutputs;
			}
		} else {
			options.language = language;
		}

		// Run transcription with the pre-decoded audio
		const result = await whisperPipeline(audioData, options);

		// Extract text
		const text = Array.isArray(result) ? result[0]?.text : result.text;
		const transcription = text?.trim() || '';

		const response: TranscriptionResultResponse = {
			type: 'transcription-result',
			messageId,
			text: transcription,
		};
		self.postMessage(response);
	} catch (e) {
		console.error('Transcription error:', e);
		const response: TranscriptionErrorResponse = {
			type: 'transcription-error',
			messageId,
			error: e instanceof Error ? e.message : 'Transcription failed',
		};
		self.postMessage(response);
	}
}

// Handle messages from main thread
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
	const message = event.data;

	switch (message.type) {
		case 'load-model':
			await loadModel();
			break;
		case 'transcribe':
			await transcribe(message.audioData, message.language, message.messageId);
			break;
	}
};
