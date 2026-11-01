import md5 from 'md5';

export type VisionState = 'supported' | 'unsupported' | 'unknown';
export type VisionSource = 'metadata' | 'request' | 'probe' | 'manual' | 'unknown';
export interface VisionOptions {
	aiApiUrl: string;
	aiApiKey?: string;
	aiModel: string;
	aiVisionMode?: 'auto' | 'support' | 'unsupported';
}
type RecordValue = {
	state: VisionState;
	source: VisionSource;
	updatedAt: number;
	probedAt?: number;
	probeUntil?: number;
};
const STORE_KEY = 'xth.ai.vision.v1';
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
const UNKNOWN_PROBE_MAX_AGE = 5 * 60 * 1000;
let memory: Record<string, RecordValue> = {};

function identity(opts: VisionOptions) {
	return md5(JSON.stringify([opts.aiApiUrl.trim().replace(/\/+$/, ''), opts.aiModel.trim(), opts.aiApiKey?.trim() || '']));
}
function records(): Record<string, RecordValue> {
	try {
		const value = typeof GM_getValue === 'function' ? GM_getValue(STORE_KEY, {}) : memory;
		return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
	} catch {
		return memory;
	}
}
function saveRecords(values: Map<string, RecordValue>) {
	memory = Object.fromEntries(Array.from(values).slice(-500));
	try {
		if (typeof GM_setValue === 'function') GM_setValue(STORE_KEY, memory);
	} catch {
		/* Storage may be unavailable. */
	}
}
function recentRecords() {
	const now = Date.now();
	return new Map(Object.entries(records()).filter(([, value]) => value && now - value.updatedAt < MAX_AGE));
}
function probeCompletedAt(value?: RecordValue) {
	return value?.probedAt ?? (value?.source === 'probe' ? value.updatedAt : undefined);
}
export function getVisionProbeStatus(opts: VisionOptions): 'idle' | 'pending' | 'complete' {
	const value = records()[identity(opts)];
	const probedAt = probeCompletedAt(value);
	const maxAge = value?.state === 'unknown' ? UNKNOWN_PROBE_MAX_AGE : MAX_AGE;
	if (probedAt !== undefined && Date.now() - probedAt < maxAge) return 'complete';
	return value?.probeUntil && value.probeUntil > Date.now() ? 'pending' : 'idle';
}
/** Reserve one background probe across frames/tabs; an abandoned reservation expires. */
export function claimVisionProbe(opts: VisionOptions, timeout: number) {
	if (getVisionProbeStatus(opts) !== 'idle') return false;
	const values = recentRecords();
	const key = identity(opts);
	const previous = values.get(key);
	values.delete(key);
	values.set(key, {
		state: previous?.state || 'unknown',
		source: previous?.source || 'unknown',
		...previous,
		updatedAt: Date.now(),
		probeUntil: Date.now() + timeout
	});
	saveRecords(values);
	return true;
}
export function rememberVisionCapabilities(items: { opts: VisionOptions; state: VisionState; source: VisionSource }[]) {
	if (!items.length) return;
	const now = Date.now();
	const values = recentRecords();
	for (const item of items) {
		const key = identity(item.opts);
		const previous = values.get(key);
		const probedAt = probeCompletedAt(previous);
		// Model metadata and merely accepting an image must not replace an actual visual test.
		if (
			probedAt !== undefined &&
			now - probedAt < MAX_AGE &&
			(item.source === 'metadata' || (item.source === 'request' && item.state === 'supported'))
		)
			continue;
		values.delete(key);
		values.set(key, {
			...previous,
			state: item.state,
			source: item.source,
			updatedAt: now,
			...(probedAt !== undefined ? { probedAt } : {}),
			...(item.source === 'probe' ? { probedAt: now, probeUntil: undefined } : {})
		});
	}
	saveRecords(values);
}
export function rememberVisionCapability(opts: VisionOptions, state: VisionState, source: VisionSource) {
	rememberVisionCapabilities([{ opts, state, source }]);
}
export function getVisionCapability(opts: VisionOptions): RecordValue {
	if (opts.aiVisionMode === 'support' || opts.aiVisionMode === 'unsupported') {
		return { state: opts.aiVisionMode === 'support' ? 'supported' : 'unsupported', source: 'manual', updatedAt: 0 };
	}
	const value = records()[identity(opts)];
	return value &&
		Date.now() - value.updatedAt < MAX_AGE &&
		['supported', 'unsupported', 'unknown'].includes(value.state)
		? value
		: { state: 'unknown', source: 'unknown', updatedAt: 0 };
}

/** Only explicit input capabilities count. A model's name or output modalities are not evidence. */
export function modelSupportsImages(item: any): boolean | undefined {
	if (!item || typeof item !== 'object') return undefined;
	for (const flag of [
		item.supports_vision,
		item.supportsVision,
		item.vision,
		item.capabilities?.vision,
		item.capabilities?.image_input
	]) {
		if (typeof flag === 'boolean') return flag;
		if (typeof flag?.supported === 'boolean') return flag.supported;
	}
	const input =
		item.input_modalities ||
		item.inputModalities ||
		item.architecture?.input_modalities ||
		item.modalities?.input ||
		(Array.isArray(item.modalities) ? item.modalities : undefined);
	if (Array.isArray(input) && input.length)
		return input.some((value) => /^(image|images|image_url|vision)$/i.test(String(value)));
	if (
		Array.isArray(item.capabilities) &&
		item.capabilities.some((value: any) => /^(vision|image_input)$/i.test(String(value)))
	)
		return true;
	return undefined;
}

export function isVisionUnsupportedError(message: string): boolean {
	return /(?:does not support|doesn't support|not support|unsupported|not capable of)[^\n]{0,90}(?:image|vision|multimodal)|(?:image|vision|multimodal)[^\n]{0,90}(?:not supported|unsupported|text.only)|不支持[^\n]{0,30}(?:图片|图像|视觉)/i.test(
		message
	);
}
