import { parseJSONLike, AI_JSON_ESCAPE_HINT } from './answer-json';
import { getWebBridgeState, requestWebAnswer } from './web-ai';
import {
	getVisionCapability,
	rememberVisionCapability,
	rememberVisionCapabilities,
	modelSupportsImages,
	isVisionUnsupportedError,
	type VisionOptions
} from './vision';
import type { QuestionTypes } from '@xuexitong-ai-helper/core/src/core/worker/interface';
import type { SearchInformation } from '@xuexitong-ai-helper/core/src/core/worker/search.interface';
import { request } from '@xuexitong-ai-helper/core/src/core/utils/request';

export interface AIAnswererOptions {
	aiProvider?: 'api' | 'deepseek-web';
	aiApiUrl: string;
	aiApiKey: string;
	aiModel: string;
	webActivityId?: string;
	aiTemperature: number;
	aiUseResponseFormat: boolean;
	aiShowSolution?: boolean;
	aiAnswerTimeout?: number;
	aiVisionMode?: 'auto' | 'support' | 'unsupported';
}

export interface AIQuestionPayload {
	reviewAnswer?: string;
	title: string;
	type?: QuestionTypes | string;
	options?: string[] | string;
	lineOptions?: AILineOptionGroup[];
	hasImage?: boolean;
	unresolvedImageCount?: number;
	imageUrls?: string[];
}

export interface AILineOptionGroup {
	index: number;
	title?: string;
	options: AILineOption[];
}

export interface AILineOption {
	value: string;
	text: string;
}

export interface AIModelInfo {
	id: string;
	supportsVision?: boolean;
}

type AIProvider = 'openai' | 'anthropic';
type AIImageTransport = 'none' | 'base64' | 'base64_failed';
type AIImageInput = {
	url: string;
	dataUrl?: string;
	mediaType?: string;
	base64?: string;
	error?: string;
};

export const DEFAULT_AI_PROMPT = [
	'你是在线课程答题助手。只输出 JSON，不要 Markdown、解释或推理。',
	'固定格式：{"answer":"答案","answers":["答案"]}。',
	'不确定也返回最可能答案。'
].join('\n');

const AI_SOLUTION_PROMPT = [
	'必须只输出 json 对象，不要 Markdown、解释或多余文本。',
	'同时输出规范化解答过程，固定 json 格式：{"answer":"答案","answers":["答案"],"solution":"解答过程"}。',
	'solution 必须简洁、可读，不要泄露思维链；只写关键公式、代入、计算和结论，最多 4 行。',
	'理科公式使用清晰文本格式，例如 x^2、sqrt(x)、a/b、Δ=b^2-4ac、F=ma；多行步骤用换行分隔。',
	'如果题目是选择/判断题，solution 说明关键依据；如果是填空/计算题，solution 给出必要计算步骤。'
].join('\n');

export function isAIAnswererReady(opts: Partial<AIAnswererOptions>) {
	return opts.aiProvider === 'deepseek-web'
		? Boolean(getWebBridgeState())
		: Boolean(opts.aiApiUrl?.trim() && opts.aiApiKey?.trim() && opts.aiModel?.trim());
}

export function hasAnswerProvider(opts: Partial<AIAnswererOptions>) {
	return isAIAnswererReady(opts);
}

export function hasSearchHit(infos: SearchInformation[]) {
	return infos.some((info) => info.results.some((result) => result.answer?.trim()));
}

export async function fetchAIModels(opts: Pick<AIAnswererOptions, 'aiApiUrl' | 'aiApiKey'>): Promise<AIModelInfo[]> {
	if (!opts.aiApiUrl?.trim()) {
		throw new Error('请先填写 AI 接口地址。');
	}
	if (!opts.aiApiKey?.trim()) {
		throw new Error('请先填写 AI API Key。');
	}

	const provider = resolveAIProvider(opts.aiApiUrl);
	const modelRequest = resolveModelsRequest(opts.aiApiUrl, provider);
	const response = await request(modelRequest.url, {
		type: 'GM_xmlhttpRequest',
		method: 'get',
		responseType: 'json',
		headers: createAIHeaders(modelRequest.provider, opts.aiApiKey)
	});

	const models = parseModelInfos(response);
	rememberVisionCapabilities(
		models
			.filter((model) => model.supportsVision !== undefined)
			.map((model) => ({
				opts: { ...opts, aiModel: model.id },
				state: model.supportsVision ? 'supported' : 'unsupported',
				source: 'metadata'
			}))
	);
	return models;
}

export function canSendImageInput(opts: VisionOptions) {
	// Do not use a real question as a capability probe. Unknown models need metadata, a test, or explicit opt-in.
	return getVisionCapability(opts).state === 'supported';
}

export async function queryAIAnswerer(
	opts: AIAnswererOptions,
	question: AIQuestionPayload,
	control: { retryEmptyContent?: boolean } = {}
): Promise<SearchInformation[]> {
	if (opts.aiProvider === 'deepseek-web') return queryWebAnswerer(opts, question);
	opts = { ...opts, aiApiUrl: opts.aiApiUrl.trim(), aiApiKey: opts.aiApiKey.trim(), aiModel: opts.aiModel.trim() };
	const title = question.title.trim();
	try {
		if (!/^https?:$/.test(new URL(opts.aiApiUrl).protocol)) throw new Error();
	} catch {
		return [{ name: 'AI做题', results: [], error: '请输入有效的 http(s) AI 接口地址。' }];
	}

	if (!isAIAnswererReady(opts)) {
		return [
			{
				name: 'AI做题',
				results: [],
				error: 'AI配置不完整，请填写接口地址、API Key 和模型。'
			}
		];
	}

	const imageUrls = Array.from(new Set((question.imageUrls || []).map((url) => String(url).trim()).filter(Boolean)));
	const supportsVision = canSendImageInput(opts);
	const provider = resolveAIProvider(opts.aiApiUrl, opts.aiModel);

	if ((question.hasImage || question.unresolvedImageCount || imageUrls.length > 0) && !supportsVision) {
		return [
			{
				name: `AI做题${opts.aiModel ? `(${opts.aiModel})` : ''}`,
				results: [],
				error:
					getVisionCapability(opts).state === 'unknown'
						? '题干或选项含图片，模型图片能力尚未确认，已跳过。请在设置中检测图片能力或手动指定。'
						: '题干或选项含图片，当前模型不支持图片，已跳过。',
				data: {
					model: opts.aiModel,
					skipped: true,
					reason: getVisionCapability(opts).state === 'unknown' ? 'vision_unknown' : 'model_without_vision',
					imageUrls
				}
			}
		];
	}

	const options = Array.isArray(question.options)
		? question.options.map((item) => replaceImageUrlsWithMarkers(item, imageUrls) || '（空选项）')
		: question.options
		? question.options.split('\n').map((item) => replaceImageUrlsWithMarkers(item, imageUrls) || '（空选项）')
		: [];

	const questionTypeName = getQuestionTypeLabel(question.type);
	const promptTitle = replaceImageUrlsWithMarkers(title, imageUrls) || (imageUrls.length ? '见图片' : title);

	const userPrompt = [
		createReviewHint(question.reviewAnswer),
		`题型：${questionTypeName}`,
		imageUrls.length ? createImageMarkerHint(imageUrls.length) : '',
		createChoiceOutputHint(question.type, options),
		'题目：',
		promptTitle,
		isLineQuestion(question.type) && question.lineOptions?.length
			? formatLineOptions(question.lineOptions)
			: options.length
			? ['选项：', ...options.map((option, index) => `${String.fromCharCode(65 + index)}.${option}`)].join('\n')
			: '选项：无'
	]
		.filter(Boolean)
		.join('\n');

	const requestUrl = resolveAIRequestURL(opts.aiApiUrl, provider);
	let imageTransport: AIImageTransport = 'none';
	let data: Record<string, any> = createAIRequestBody(provider, opts, question.type, userPrompt, []);

	try {
		if (question.unresolvedImageCount || (question.hasImage && imageUrls.length === 0))
			throw new Error('题目包含图片，但未能读取图片地址，请等待图片加载后重试。');
		if (supportsVision && imageUrls.length) {
			imageTransport = 'base64';
			const imageInputs = await resolveAIImageInputs(imageUrls);
			const base64ImageInputs = imageInputs.filter((image) => image.dataUrl);
			if (base64ImageInputs.length !== imageInputs.length) {
				const imageErrors = imageInputs
					.filter((image) => !image.dataUrl)
					.map((image) => `${image.url}: ${image.error || '下载失败'}`)
					.join('\n');
				imageTransport = 'base64_failed';
				return [
					{
						name: `AI做题${opts.aiModel ? `(${opts.aiModel})` : ''}`,
						results: [],
						error: '题目图片下载为 base64 失败，已跳过此题：' + imageErrors,
						data: {
							...summarizeAIRequestData(data),
							image_transport: imageTransport,
							skipped: true,
							reason: 'image_download_failed',
							imageUrls,
							imageErrors: imageInputs,
							raw_content: imageErrors,
							parsed_answer: ''
						}
					}
				];
			}

			data = createAIRequestBody(provider, opts, question.type, userPrompt, base64ImageInputs);
		} else {
			data = createAIRequestBody(provider, opts, question.type, userPrompt, []);
		}

		let response: any = await requestAI(requestUrl, provider, opts.aiApiKey, data, opts);
		if (imageUrls.length) rememberVisionCapability(opts, 'supported', 'request');
		let retryInfo: Record<string, any> | undefined;
		if (control.retryEmptyContent !== false && shouldRetryForEmptyFinalContent(response)) {
			const firstResponse = response;
			const retryData = createFinalJsonRetryData(provider, data, opts);
			try {
				const retryResponse = await requestAI(requestUrl, provider, opts.aiApiKey, retryData, opts);
				response = retryResponse;
				data = retryData;
				retryInfo = {
					reason: 'empty_content_or_length',
					first_finish_reason: getAIFinishReason(firstResponse),
					first_token_usage: resolveTokenUsage(firstResponse),
					retry_token_usage: resolveTokenUsage(retryResponse)
				};
			} catch (retryError) {
				retryInfo = {
					reason: 'empty_content_or_length',
					first_finish_reason: getAIFinishReason(firstResponse),
					first_token_usage: resolveTokenUsage(firstResponse),
					retry_error: normalizeErrorMessage(retryError)
				};
			}
		}

		let rawContent = getAIContent(response);
		let answer = resolveAIAnswer(rawContent);
		let solution = normalizeAISolution(resolveAISolution(rawContent, response));
		let normalizedAnswer = normalizeAnswerByQuestionType(answer, question.type, question.lineOptions, options, {
			solution,
			rawContent,
			response
		});
		let tokenUsage = retryInfo?.retry_token_usage
			? mergeTokenUsage(retryInfo.first_token_usage, retryInfo.retry_token_usage)
			: resolveTokenUsage(response);
		// Retry malformed/out-of-range choice answers once; a multi-select question may legitimately have one answer.
		if (
			!retryInfo &&
			control.retryEmptyContent !== false &&
			!normalizedAnswer &&
			options.length &&
			(isSingleQuestion(question.type) || isMultipleQuestion(question.type) || isJudgementQuestion(question.type))
		) {
			const retryData = JSON.parse(JSON.stringify(data));
			retryData.messages.push(
				{ role: 'assistant', content: createAssistantMessageContent(provider, String(rawContent || '{}')) },
				{
					role: 'user',
					content: createUserMessageContent(
						provider,
						'上次答案不能匹配本题选项。请重新输出最终 JSON。' + createChoiceOutputHint(question.type, options),
						[]
					)
				}
			);
			try {
				const retryResponse = await requestAI(requestUrl, provider, opts.aiApiKey, retryData, opts);
				tokenUsage = mergeTokenUsage(tokenUsage, resolveTokenUsage(retryResponse));
				response = retryResponse;
				data = retryData;
				rawContent = getAIContent(response);
				solution = normalizeAISolution(resolveAISolution(rawContent, response));
				normalizedAnswer = normalizeAnswerByQuestionType(
					resolveAIAnswer(rawContent),
					question.type,
					question.lineOptions,
					options
				);
				retryInfo = { format_retry: true };
			} catch (error) {
				retryInfo = { format_retry_error: normalizeErrorMessage(error) };
			}
		}

		return [
			{
				name: `AI做题${opts.aiModel ? `(${opts.aiModel})` : ''}`,
				homepage: resolveHomepage(requestUrl),
				url: requestUrl,
				results: normalizedAnswer
					? [
							{
								question: title,
								answer: normalizedAnswer,
								extra_data: {
									ai: true,
									token_usage: tokenUsage,
									raw_content: rawContent || getAIReasoningContentForDisplay(response),
									parsed_answer: normalizedAnswer,
									answer_parts: completionAnswerParts(rawContent, question.type),
									solution,
									retry: retryInfo
								}
							}
					  ]
					: [],
				response,
				data: {
					...summarizeAIRequestData(data),
					image_transport: imageTransport,
					raw_content: rawContent || getAIReasoningContentForDisplay(response),
					parsed_answer: normalizedAnswer,
					solution,
					retry: retryInfo
				},
				error: normalizedAnswer ? undefined : 'AI答案格式不正确或超出本题选项范围，未自动填写，请重试或手动核对。'
			}
		];
	} catch (err) {
		const visionUnsupported = imageUrls.length > 0 && isVisionUnsupportedError(normalizeErrorMessage(err));
		if (visionUnsupported) rememberVisionCapability(opts, 'unsupported', 'request');
		return [
			{
				name: `AI做题${opts.aiModel ? `(${opts.aiModel})` : ''}`,
				homepage: resolveHomepage(opts.aiApiUrl),
				url: resolveAIRequestURL(opts.aiApiUrl, provider),
				results: [],
				response: normalizeErrorResponse(err),
				data: {
					...summarizeAIRequestData(data),
					image_transport: imageTransport,
					skipped: visionUnsupported,
					reason: visionUnsupported ? 'model_without_vision' : undefined,
					raw_content: normalizeErrorMessage(err),
					parsed_answer: ''
				},
				error: normalizeErrorMessage(err)
			}
		];
	}
}

/** Native Anthropic requires max_tokens. Use provider-reported model capacity, never a plugin/user cap. */
const anthropicModelLimits = new Map<string, { expiresAt: number; value: Promise<number | undefined> }>();
async function getAnthropicModelLimit(requestUrl: string, model: string, apiKey: string) {
	const url = new URL(requestUrl);
	url.pathname = url.pathname.replace(/\/messages\/?$/, '/models/') + encodeURIComponent(model);
	const key = JSON.stringify([url.toString(), apiKey]); // In-memory only; never logged or persisted.
	const cached = anthropicModelLimits.get(key);
	if (cached && cached.expiresAt > Date.now()) return cached.value;
	const entry = { expiresAt: Date.now() + 60 * 60 * 1000, value: Promise.resolve<number | undefined>(undefined) };
	entry.value = request(url.toString(), {
		type: 'GM_xmlhttpRequest',
		method: 'get',
		responseType: 'json',
		headers: createAIHeaders('anthropic', apiKey),
		timeout: 10000
	})
		.then((response) => {
			const limit = response?.max_output_tokens ?? response?.data?.max_output_tokens;
			if (Number.isSafeInteger(limit) && limit > 0) return limit as number;
		})
		.catch(() => undefined)
		.then((limit) => {
			if (limit === undefined) entry.expiresAt = Date.now() + 5 * 60 * 1000;
			return limit;
		});
	if (anthropicModelLimits.size >= 32) anthropicModelLimits.delete(anthropicModelLimits.keys().next().value!);
	anthropicModelLimits.set(key, entry);
	return entry.value;
}
async function requestAI(
	requestUrl: string,
	provider: AIProvider,
	apiKey: string,
	data: Record<string, any>,
	opts?: AIAnswererOptions
) {
	if (provider === 'anthropic') {
		const modelLimit = await getAnthropicModelLimit(requestUrl, data.model, apiKey);
		if (modelLimit !== undefined) data.max_tokens = modelLimit;
	}
	try {
		const response = await request(requestUrl, {
			type: 'GM_xmlhttpRequest',
			method: 'post',
			responseType: 'json',
			headers: createAIHeaders(provider, apiKey),
			timeout: Math.max(5000, Number(opts?.aiAnswerTimeout || 60) * 1000),
			data
		});
		if (response?.error) throw Object.assign(new Error(normalizeErrorMessage(response)), { response });
		return response;
	} catch (error) {
		if (
			provider === 'anthropic' &&
			data.max_tokens === undefined &&
			/max_tokens/i.test(normalizeErrorMessage(error)) &&
			/required|missing|必填|缺少/i.test(normalizeErrorMessage(error))
		)
			throw new Error(
				'此接口强制要求 max_tokens，但未提供模型最大输出信息；无法自动使用模型上限。请更换支持省略上限参数的兼容接口，或使用提供 max_output_tokens 的模型接口。'
			);
		throw error;
	}
}

function createAIRequestBody(
	provider: AIProvider,
	opts: AIAnswererOptions,
	type: AIQuestionPayload['type'],
	userPrompt: string,
	images: AIImageInput[]
) {
	const userMessageContent = createUserMessageContent(provider, userPrompt, images);
	const data: Record<string, any> = createAIRequestData(provider, opts, type, userMessageContent);
	if (provider === 'openai' && opts.aiUseResponseFormat) {
		ensurePromptContainsJsonKeyword(data);
		data.response_format = { type: 'json_object' };
	}
	return data;
}

function ensurePromptContainsJsonKeyword(data: Record<string, any>) {
	const messages = Array.isArray(data.messages) ? data.messages : [];
	const promptText = [data.system, ...messages.map((message: any) => stringifyCompact(message?.content))]
		.filter(Boolean)
		.join('\n')
		.toLowerCase();
	if (promptText.includes('json')) {
		return;
	}

	const jsonHint = '必须输出 json 对象，格式为 {"answer":"答案","answers":["答案"]}。';
	const systemMessage = messages.find((message: any) => message?.role === 'system');
	if (systemMessage) {
		systemMessage.content = `${jsonHint}\n${String(systemMessage.content || '')}`;
		return;
	}

	messages.unshift({
		role: 'system',
		content: jsonHint
	});
	data.messages = messages;
}

function summarizeAIRequestData(data: Record<string, any>) {
	return {
		model: data.model,
		system: data.system,
		messages: sanitizeAIRequestData(data.messages),
		temperature: data.temperature,
		...(data.max_tokens === undefined ? {} : { max_tokens: data.max_tokens }),
		response_format: data.response_format
	};
}

async function resolveAIImageInputs(imageUrls: string[]): Promise<AIImageInput[]> {
	const uniqueUrls = Array.from(new Set(imageUrls.map((url) => url.trim()).filter(Boolean)));
	const results = await Promise.all(
		uniqueUrls.map(async (url) => {
			try {
				const dataUrl = await downloadImageAsDataURL(url);
				const mediaType = inferImageMediaType(url, dataUrl);
				const base64 = extractBase64FromDataURL(dataUrl);
				return {
					url,
					dataUrl: createImageDataURL(mediaType, base64),
					mediaType,
					base64
				};
			} catch (error) {
				const errorMessage = normalizeErrorMessage(error);
				return {
					url,
					error: errorMessage
				};
			}
		})
	);

	return results;
}

async function downloadImageAsDataURL(url: string): Promise<string> {
	if (/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(url)) return url;
	const blob = await downloadImageAsBlob(url);
	if (!blob || blob.size === 0) throw new Error('图片内容为空');
	if (blob.type && !blob.type.startsWith('image/') && blob.type !== 'application/octet-stream')
		throw new Error('图片地址返回的不是图片，可能需要重新登录。');
	const dataUrl = await new Promise<string>((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result || ''));
		reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
		reader.readAsDataURL(blob);
	});
	if (/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(dataUrl)) return dataUrl;
	// Convert SVG/AVIF and other browser-readable formats instead of mislabelling their bytes as PNG.
	return new Promise<string>((resolve, reject) => {
		const image = new Image();
		const timer = setTimeout(() => reject(new Error('图片格式转换超时')), 15000);
		image.onload = () => {
			clearTimeout(timer);
			try {
				if (!image.naturalWidth || !image.naturalHeight) throw new Error('无法读取图片尺寸');
				const scale = Math.min(1, 4096 / Math.max(image.naturalWidth, image.naturalHeight));
				const canvas = document.createElement('canvas');
				canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
				canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
				const context = canvas.getContext('2d');
				if (!context) throw new Error('无法转换图片格式');
				context.drawImage(image, 0, 0, canvas.width, canvas.height);
				resolve(canvas.toDataURL('image/png'));
			} catch (error) {
				reject(error);
			}
		};
		image.onerror = () => {
			clearTimeout(timer);
			reject(new Error('无法解析图片，请检查图片是否已加载'));
		};
		image.src = dataUrl;
	});
}

function downloadImageAsBlob(url: string): Promise<Blob> {
	return new Promise((resolve, reject) => {
		if (typeof GM_xmlhttpRequest !== 'undefined' && /^https?:/i.test(url)) {
			GM_xmlhttpRequest({
				url,
				method: 'GET',
				responseType: 'blob',
				headers: {
					Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
					Referer: location.origin + '/'
				},
				onload: (response) => {
					if (response.status >= 200 && response.status < 300) {
						resolve(response.response as Blob);
					} else {
						reject(new Error(`图片下载失败，HTTP ${response.status}`));
					}
				},
				onerror: (error) => reject(error),
				ontimeout: () => reject(new Error('图片下载超时')),
				timeout: 15000
			});
			return;
		}

		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), 15000);
		fetch(url, { credentials: 'include', signal: controller.signal })
			.then((response) => {
				if (!response.ok) {
					throw new Error(`图片下载失败，HTTP ${response.status}`);
				}
				return response.blob();
			})
			.then(resolve)
			.catch(reject)
			.finally(() => clearTimeout(timeout));
	});
}

function getAIContent(response: any) {
	const directAnswer = pickAnswerFromObject(response);
	if (directAnswer) {
		return directAnswer;
	}

	return (
		readTextContent(response?.content) ||
		(response?.choices?.[0]?.message?.content ??
			response?.choices?.[0]?.text ??
			response?.answer ??
			response?.data?.answer ??
			'')
	);
}

function shouldRetryForEmptyFinalContent(response: any) {
	const content = String(getAIContent(response) || '').trim();
	if (content) {
		return false;
	}
	const reasoningContent = getAIReasoningContent(response);
	const finishReason = getAIFinishReason(response);
	return Boolean(reasoningContent && (!finishReason || finishReason === 'length' || finishReason === 'max_tokens'));
}

function createFinalJsonRetryData(provider: AIProvider, data: Record<string, any>, opts: AIAnswererOptions) {
	const retryData = JSON.parse(JSON.stringify(data));
	const retryPrompt = opts.aiShowSolution
		? '上次没有输出最终内容。不要继续推理，直接输出最终 json 对象，格式为 {"answer":"答案","answers":["答案"],"solution":"最多4行关键步骤"}。'
		: '上次没有输出最终内容。不要继续推理，直接输出最终 json 对象，格式为 {"answer":"答案","answers":["答案"]}。';
	retryData.messages.push({
		role: 'user',
		content: createUserMessageContent(provider, retryPrompt, [])
	});
	return retryData;
}

function getAIReasoningContent(response: any) {
	return (
		readTextContent(response?.reasoning_content) ||
		readTextContent(response?.choices?.[0]?.message?.reasoning_content) ||
		readTextContent(response?.choices?.[0]?.reasoning_content) ||
		readTextContent(response?.data?.reasoning_content) ||
		''
	);
}

function getAIReasoningContentForDisplay(response: any) {
	const reasoningContent = getAIReasoningContent(response);
	return reasoningContent ? `[reasoning_content]\n${reasoningContent}` : '';
}

function getAIFinishReason(response: any) {
	return String(
		response?.choices?.[0]?.finish_reason || response?.finish_reason || response?.data?.finish_reason || ''
	).trim();
}

function readTextContent(content: any) {
	if (typeof content === 'string') {
		return content;
	}
	if (!Array.isArray(content)) {
		return '';
	}
	return content
		.map((item) => (typeof item === 'string' ? item : item?.text || ''))
		.filter(Boolean)
		.join('\n')
		.trim();
}

function resolveAIAnswer(rawContent: any) {
	if (Array.isArray(rawContent)) {
		return pickAnswerFromObject(rawContent);
	}

	if (rawContent && typeof rawContent === 'object') {
		return pickAnswerFromObject(rawContent);
	}

	const content = String(rawContent ?? '').trim();
	if (!content) {
		return '';
	}

	const parsed = parseJSONLike(content);
	if (parsed !== undefined) {
		return pickAnswerFromObject(parsed);
	}
	// Never paste a malformed JSON packet into a completion input as if it were an answer.
	if (/^(?:```(?:json)?\s*)?[{\[]/.test(content)) return '';

	return content
		.replace(/^```(?:json)?/i, '')
		.replace(/```$/i, '')
		.trim();
}

function pickAnswerFromObject(obj: any): string {
	if (obj == null) return '';
	if (typeof obj !== 'object') return String(obj).trim();
	if (Array.isArray(obj)) {
		const parts = obj.map(pickAnswerFromObject);
		return parts.length && parts.every(Boolean) ? parts.join('#') : '';
	}
	for (const candidate of [obj.answers, obj.answer, obj.result, obj.data, obj.choices?.[0]?.message]) {
		const answer = pickAnswerFromObject(candidate);
		if (answer) return answer;
	}
	return '';
}
function completionAnswerParts(rawContent: any, type: AIQuestionPayload['type']): string[] | undefined {
	if (!isCompletionQuestion(type)) return;
	const parsed = typeof rawContent === 'object' ? rawContent : parseJSONLike(String(rawContent ?? ''));
	const values = Array.isArray(parsed) ? parsed : parsed?.answers ?? parsed?.data?.answers;
	if (!Array.isArray(values) || !values.length) return;
	const parts = values.map((value) => normalizeAnswerByQuestionType(pickAnswerFromObject(value), type));
	return parts.every(Boolean) ? parts : undefined;
}

function resolveAISolution(rawContent: any, response?: any): string {
	const parsed = parseAIObject(rawContent) || parseAIObject(response);
	const solution =
		parsed?.solution ??
		parsed?.process ??
		parsed?.explanation ??
		parsed?.reason ??
		parsed?.analysis ??
		parsed?.data?.solution ??
		parsed?.data?.process ??
		parsed?.data?.explanation;
	if (Array.isArray(solution)) {
		return solution.map((item) => (typeof item === 'string' ? item : stringifyCompact(item))).join('\n');
	}
	if (solution && typeof solution === 'object') {
		return stringifyCompact(solution);
	}
	return String(solution || '').trim();
}

function parseAIObject(value: any): any {
	if (!value) {
		return undefined;
	}
	if (typeof value === 'object') {
		return value;
	}
	return parseJSONLike(String(value || '').trim());
}

function normalizeAISolution(solution: string) {
	return String(solution || '')
		.replace(/^```(?:markdown|md|text)?/i, '')
		.replace(/```$/i, '')
		.replace(/\r\n/g, '\n')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
}

function createReviewHint(answer?: string) {
	return answer === undefined
		? ''
		: [
				'本次任务是检验已作答题目。请独立核对题干、全部选项及图片，不要仅附和当前答案，也不要引用此前题目的答案。',
				'当前答案：' + answer,
				'若当前答案正确，返回相同答案；否则返回你认为正确的新答案。仍严格使用本题要求的 JSON 格式，不要只回答“正确/错误”。'
		  ].join('\n');
}

function createSystemPrompt(type: AIQuestionPayload['type'], showSolution?: boolean) {
	const basePrompt = [showSolution ? AI_SOLUTION_PROMPT : DEFAULT_AI_PROMPT, AI_JSON_ESCAPE_HINT];

	if (isSingleQuestion(type)) {
		return [
			...basePrompt,
			'当前题型：单选题。answer 必须返回本题选项列表中的一个字母（不限于 A/B/C/D），不能超出实际选项范围。answers 只放这一个最终答案；不要把计算结果当作单选答案，计算结果只写在 solution。'
		].join('\n');
	}
	if (isMultipleQuestion(type)) {
		return [
			...basePrompt,
			'当前题型：多选题。返回所有正确选项的字母（不限于 A/B/C/D）；answer 用 # 连接，answers 按选项顺序列出字母。可以只有一个正确选项，不得为了凑数多选。'
		].join('\n');
	}
	if (isJudgementQuestion(type)) {
		return [
			...basePrompt,
			'当前题型：判断题。answer 填一个答案；优先返回页面选项原文，如“正确/错误/对/错/True/False”；只能用字母时只返回 A 或 B。'
		].join('\n');
	}
	if (isCompletionQuestion(type)) {
		return [
			...basePrompt,
			'当前题型：填空题。只返回要填入空格的内容；多个空按顺序用 # 连接，answers 按顺序放每个空。'
		].join('\n');
	}
	if (isLineQuestion(type)) {
		return [
			...basePrompt,
			'当前题型：连线题/匹配题。只返回每个下拉框要选择的 value/data 值；按页面顺序用 # 连接，如 {"answer":"b#d","answers":["b","d"]}。'
		].join('\n');
	}
	return [...basePrompt, '当前题型未知。优先返回可直接填写或选择的最终答案；多答案用 # 连接。'].join('\n');
}

export function normalizeAnswerByQuestionType(
	answer: string,
	type: AIQuestionPayload['type'],
	lineOptions?: AILineOptionGroup[],
	options: string[] = [],
	context: AIAnswerContext = {}
) {
	answer = answer.trim();
	if (isSingleQuestion(type)) {
		return normalizeSingleAnswer(answer, options, context);
	}
	if (isMultipleQuestion(type)) {
		const clean = answer.replace(/^(?:正确)?答案\s*[:：]?\s*/, '').trim();
		const exactOption = options.some(
			(option) => compactPromptText(option).toLowerCase() === compactPromptText(clean).toLowerCase()
		);
		const tokens =
			!exactOption && /^[A-Z](?:[\s,#，、;；|/]*[A-Z])*$/i.test(clean)
				? clean.replace(/[^a-z]/gi, '').split('')
				: clean
						.split(/[#，、,；;|/\n]+/)
						.map((item) => item.trim())
						.filter(Boolean);
		const letters = tokens.map((token) => normalizeSingleAnswer(token, options));
		if (!letters.length || letters.some((letter) => !isChoiceLetterInRange(letter, options.length || 26))) return '';
		return Array.from(new Set(letters)).sort().join('#');
	}

	if (isCompletionQuestion(type)) {
		// A formula may contain |x|, \\;, newlines or literal #. Only the answer array defines blanks.
		return answer.replace(/^答案[:：]\s*/g, '').trim();
	}
	if (isJudgementQuestion(type)) {
		const truth = (text: string) =>
			/^(正确|对|是|√|true|yes)$/i.test(text.trim())
				? true
				: /^(错误|错|否|×|false|no)$/i.test(text.trim())
				? false
				: undefined;
		const value = truth(answer);
		if (value !== undefined) {
			const index = options.findIndex((option) => truth(option.replace(/^[A-Z][.．、]\s*/i, '')) === value);
			if (index >= 0) return String.fromCharCode(65 + index);
		}
		return normalizeSingleAnswer(
			answer
				.replace(/^答案[:：]\s*/g, '')
				.replace(/^判断[:：]\s*/g, '')
				.replace(/[。.!！\s]+$/g, '')
				.trim(),
			options,
			context
		);
	}
	if (isLineQuestion(type)) {
		return normalizeLineAnswer(answer, lineOptions);
	}
	return answer;
}

function isMultipleQuestion(type: AIQuestionPayload['type']) {
	const text = String(type || '').toLowerCase();
	return text === 'multiple' || text.includes('多选') || text.includes('multiple');
}

function isCompletionQuestion(type: AIQuestionPayload['type']) {
	const text = String(type || '').toLowerCase();
	return text === 'completion' || text.includes('填空') || text.includes('completion');
}

function isJudgementQuestion(type: AIQuestionPayload['type']) {
	const text = String(type || '').toLowerCase();
	return text === 'judgement' || text.includes('判断') || text.includes('judgement') || text.includes('judge');
}

function isLineQuestion(type: AIQuestionPayload['type']) {
	const text = String(type || '').toLowerCase();
	return (
		text === 'line' ||
		text === 'reader' ||
		text === 'fill' ||
		text.includes('连线') ||
		text.includes('匹配') ||
		text.includes('match')
	);
}

function getQuestionTypeLabel(type: AIQuestionPayload['type']) {
	if (isSingleQuestion(type)) {
		return '单选题(single)';
	}
	if (isMultipleQuestion(type)) {
		return '多选题(multiple)';
	}
	if (isJudgementQuestion(type)) {
		return '判断题(judgement)';
	}
	if (isCompletionQuestion(type)) {
		return '填空题(completion)';
	}
	if (isLineQuestion(type)) {
		return '连线题(line)';
	}
	return String(type || 'unknown');
}

function isSingleQuestion(type: AIQuestionPayload['type']) {
	const text = String(type || '').toLowerCase();
	return text === 'single' || text.includes('单选') || text.includes('single');
}

type AIAnswerContext = {
	solution?: string;
	rawContent?: any;
	response?: any;
};

function normalizeSingleAnswer(answer: string, options: string[] = [], _context: AIAnswerContext = {}) {
	const literal = answer.replace(/^(?:(?:正确|最终)?答案|选项)\s*(?:是|为|[:：])?\s*/, '').trim();
	const clean = literal.replace(/[。.\s]+$/g, '').trim();
	const optionCount = options.length || 26;
	if (/^[A-Z]$/i.test(literal))
		return isChoiceLetterInRange(literal.toUpperCase(), optionCount) ? literal.toUpperCase() : '';
	// Match literal text before removing punctuation: n! must not accidentally match n.
	const optionTexts = options.map((option) => compactPromptText(option).replace(/^[A-Z][.．、]\s*/i, ''));
	for (const value of [literal, clean]) {
		const exact = optionTexts.indexOf(compactPromptText(value));
		if (exact >= 0) return String.fromCharCode(65 + exact);
	}
	const folded = optionTexts.flatMap((text, index) =>
		text.toLowerCase() === compactPromptText(clean).toLowerCase() ? [index] : []
	);
	if (folded.length === 1) return String.fromCharCode(65 + folded[0]);
	const letter = clean.match(/^(?:选择?|选项)?\s*([A-Z])(?:[.．、:：]\s*.*)?$/i)?.[1]?.toUpperCase();
	if (letter && isChoiceLetterInRange(letter, optionCount)) return letter;
	if (/^\d+$/.test(clean) && Number(clean) >= 1 && Number(clean) <= optionCount)
		return String.fromCharCode(64 + Number(clean));
	return options.length ? '' : clean;
}

function createChoiceOutputHint(type: AIQuestionPayload['type'], options: string[]) {
	if (!(isSingleQuestion(type) || isMultipleQuestion(type) || isJudgementQuestion(type)) || options.length === 0)
		return '';
	const letters = options.map((_, index) => String.fromCharCode(65 + index));
	const example =
		isMultipleQuestion(type) && letters.length > 1
			? [letters[0], letters[letters.length - 1]]
			: [letters[letters.length - 1]];
	return (
		'本题共有 ' +
		options.length +
		' 个选项，合法字母仅为 ' +
		letters.join('/') +
		'。' +
		(isMultipleQuestion(type) ? '按顺序返回全部正确字母；多选题也允许只有一个答案。' : '只能返回一个合法字母。') +
		'格式示例（不代表正确答案）：' +
		JSON.stringify({ answer: example.join('#'), answers: example }) +
		'。图片选项同样返回对应字母，不要返回图片编号、解释或计算值。'
	);
}

function isChoiceLetterInRange(letter: string, optionCount: number) {
	if (!/^[A-Z]$/.test(letter)) {
		return false;
	}
	const index = letter.charCodeAt(0) - 65;
	return index >= 0 && index < optionCount;
}

function formatLineOptions(groups: AILineOptionGroup[]) {
	const lines = ['分组可选项（按组顺序返回每组的 value/data 值，以 # 分隔）：'];
	for (const group of groups) {
		lines.push(
			`${group.index + 1}: ${group.title || ''}\n` +
				group.options.map((option) => `${compactPromptText(option.value)}=${compactPromptText(option.text)}`).join(';')
		);
	}
	return lines.join('\n');
}

function compactPromptText(text: string) {
	return String(text || '')
		.replace(/\s+/g, ' ')
		.trim();
}

function replaceImageUrlsWithMarkers(text: string, imageUrls: string[]) {
	let next = compactPromptText(text);
	imageUrls.forEach((url, index) => {
		next = next.split(url).join(`[图片${index + 1}]`);
	});
	return next.replace(/https?:\/\/\S+\.(?:png|jpe?g|gif|webp)(?:\?\S*)?/gi, (url) => {
		const index = imageUrls.findIndex((imageUrl) => imageUrl === url);
		return `[图片${index >= 0 ? index + 1 : ''}]`;
	});
}

function createImageMarkerHint(count: number) {
	return count === 1
		? '图片：[图片1] 已随消息附上。'
		: `图片：${Array.from({ length: count }, (_, i) => `[图片${i + 1}]`).join('、')} 已随消息附上。`;
}

function normalizeLineAnswer(answer: string, groups?: AILineOptionGroup[]): string {
	const text = answer.replace(/^(?:答案|连线)[:：]\s*/, '').trim();
	if (!groups?.length) return text;
	const valid = (tokens: string[]) =>
		tokens.length === groups.length &&
		tokens.every((token, index) => groups[index].options.some((option) => option.value === token));
	const tokens = text.split(/[#，、,；;|\n]+/).map((value) => value.trim());
	if (valid(tokens)) return tokens.join('#');
	const json = parseJSONLike(text);
	if (json) {
		const picked = pickAnswerFromObject(json);
		if (picked && picked !== text) return normalizeLineAnswer(picked, groups);
	}
	const pairs = Array.from(text.matchAll(/\(?[A-Za-z0-9_-]+\s*[-—–~:：>]\s*([A-Za-z0-9_-]+)\)?/g)).map(
		(match) => match[1]
	);
	return valid(pairs) ? pairs.join('#') : '';
}

function resolveTokenUsage(response: any) {
	const usage = response?.usage || response?.data?.usage || {};
	const prompt_tokens = Number(usage.prompt_tokens ?? usage.input_tokens ?? 0) || 0;
	const completion_tokens = Number(usage.completion_tokens ?? usage.output_tokens ?? 0) || 0;
	const total_tokens = Number(usage.total_tokens ?? prompt_tokens + completion_tokens) || 0;
	return { prompt_tokens, completion_tokens, total_tokens };
}

function mergeTokenUsage(a: ReturnType<typeof resolveTokenUsage>, b: ReturnType<typeof resolveTokenUsage>) {
	return {
		prompt_tokens: a.prompt_tokens + b.prompt_tokens,
		completion_tokens: a.completion_tokens + b.completion_tokens,
		total_tokens: a.total_tokens + b.total_tokens
	};
}

function resolveHomepage(url: string) {
	try {
		return new URL(url).origin;
	} catch {
		return undefined;
	}
}

function resolveAIProvider(apiUrl: string, _model = ''): AIProvider {
	const url = new URL(apiUrl);
	const path = url.pathname.replace(/\/+$/, '').toLowerCase();
	if (path.endsWith('/chat/completions')) return 'openai';
	if (path.endsWith('/messages') || /(^|\/)anthropic(\/|$)/.test(path) || /(^|\.)anthropic\.com$/i.test(url.hostname))
		return 'anthropic';
	return 'openai';
}

function createAIHeaders(provider: AIProvider, apiKey: string) {
	const headers: Record<string, string> = {
		'Content-Type': 'application/json'
	};
	if (provider === 'anthropic') {
		headers['x-api-key'] = apiKey;
		headers['anthropic-version'] = '2023-06-01';
	} else {
		headers.Authorization = `Bearer ${apiKey}`;
	}
	return headers;
}

function createAIRequestData(
	provider: AIProvider,
	opts: AIAnswererOptions,
	type: AIQuestionPayload['type'],
	userMessageContent: any
) {
	const system = createSystemPrompt(type, opts.aiShowSolution);
	if (provider === 'anthropic') {
		return {
			model: opts.aiModel,
			system,
			temperature: Number(opts.aiTemperature ?? 0),
			messages: [
				{
					role: 'user',
					content: userMessageContent
				}
			]
		};
	}

	return {
		model: opts.aiModel,
		temperature: Number(opts.aiTemperature ?? 0),
		messages: [
			{
				role: 'system',
				content: system
			},
			{
				role: 'user',
				content: userMessageContent
			}
		]
	};
}

function createUserMessageContent(provider: AIProvider, userPrompt: string, images: AIImageInput[]) {
	if (images.length === 0) {
		return provider === 'anthropic' ? [{ type: 'text', text: userPrompt }] : userPrompt;
	}

	if (provider === 'anthropic') {
		return [
			{ type: 'text', text: userPrompt },
			...images.map((image) => ({
				type: 'image',
				source: {
					type: 'base64',
					media_type: image.mediaType || inferImageMediaType(image.url),
					data: image.base64 || extractBase64FromDataURL(image.dataUrl || '')
				}
			}))
		];
	}

	return [
		{ type: 'text', text: userPrompt },
		...images.map((image) => ({
			type: 'image_url',
			image_url: {
				url: image.dataUrl || createImageDataURL(image.mediaType || inferImageMediaType(image.url), image.base64 || '')
			}
		}))
	];
}

function createAssistantMessageContent(provider: AIProvider, text: string) {
	return provider === 'anthropic' ? [{ type: 'text', text }] : text;
}

function inferImageMediaType(url: string, dataUrl = '') {
	const dataUrlMatch = dataUrl.match(/^data:([^;,]+)[;,]/);
	if (dataUrlMatch?.[1] && dataUrlMatch[1].startsWith('image/') && dataUrlMatch[1] !== 'image/svg+xml') {
		return normalizeImageMediaType(dataUrlMatch[1]);
	}

	const cleanUrl = url.split('?')[0].split('#')[0].toLowerCase();
	if (cleanUrl.endsWith('.png')) {
		return 'image/png';
	}
	if (cleanUrl.endsWith('.gif')) {
		return 'image/gif';
	}
	if (cleanUrl.endsWith('.webp')) {
		return 'image/webp';
	}
	if (cleanUrl.endsWith('.svg')) {
		return 'image/svg+xml';
	}
	return 'image/jpeg';
}

function normalizeImageMediaType(mediaType: string) {
	const normalized = mediaType.toLowerCase();
	return normalized === 'image/jpg' ? 'image/jpeg' : normalized;
}

function extractBase64FromDataURL(dataUrl: string) {
	return dataUrl.includes(',') ? dataUrl.slice(dataUrl.indexOf(',') + 1) : dataUrl;
}

function createImageDataURL(mediaType: string, base64: string) {
	return `data:${mediaType};base64,${base64}`;
}

function sanitizeAIRequestData(value: any) {
	return sanitizeForDisplay(value);
}

function sanitizeForDisplay(value: any): any {
	if (typeof value === 'string') {
		if (value.startsWith('data:image/')) {
			const header = value.slice(0, Math.min(value.indexOf(',') + 1 || 40, 80));
			return `${header}[image base64 omitted, length=${value.length}]`;
		}
		if (isLongBase64Like(value)) {
			return `[base64 omitted, length=${value.length}]`;
		}
		return value;
	}

	if (Array.isArray(value)) {
		return value.map((item) => sanitizeForDisplay(item));
	}

	if (value && typeof value === 'object') {
		const out: Record<string, any> = {};
		for (const [key, val] of Object.entries(value)) {
			if (
				(key === 'data' || key === 'url') &&
				typeof val === 'string' &&
				(val.startsWith('data:image/') || isLongBase64Like(val))
			) {
				out[key] = sanitizeForDisplay(val);
			} else {
				out[key] = sanitizeForDisplay(val);
			}
		}
		return out;
	}

	return value;
}

function isLongBase64Like(value: string) {
	return value.length > 800 && /^[A-Za-z0-9+/=\r\n]+$/.test(value);
}

function normalizeErrorMessage(error: any): string {
	if (typeof error === 'string') {
		const parsed = parseJSONLike(error);
		return parsed ? JSON.stringify(parsed) : error;
	}
	if (error instanceof Error) {
		return error.message;
	}
	if (error?.responseText) {
		return normalizeErrorMessage(error.responseText);
	}
	try {
		return JSON.stringify(error);
	} catch {
		return String(error);
	}
}

function normalizeErrorResponse(error: any): any {
	if (typeof error === 'string') {
		return parseJSONLike(error) || error;
	}
	if (error?.responseText) {
		return normalizeErrorResponse(error.responseText);
	}
	return sanitizeForDisplay(error);
}

function resolveModelsRequest(apiUrl: string, provider: AIProvider) {
	const deepseekModelsURL = resolveDeepSeekModelsURL(apiUrl, provider);
	if (deepseekModelsURL) {
		return {
			url: deepseekModelsURL,
			provider: 'openai' as AIProvider
		};
	}

	return {
		url: resolveModelsURL(apiUrl, provider),
		provider
	};
}

function resolveModelsURL(apiUrl: string, provider: AIProvider) {
	const url = new URL(apiUrl);
	const pathname = url.pathname.replace(/\/+$/, '');
	const replacements =
		provider === 'anthropic'
			? ['/messages', '/chat/completions', '/completions', '/responses']
			: ['/chat/completions', '/completions', '/responses'];
	const replacement = replacements.find((item) => pathname.endsWith(item));

	if (pathname.endsWith('/models')) {
		url.pathname = pathname;
	} else if (replacement) {
		url.pathname = pathname.slice(0, -replacement.length) + '/models';
	} else {
		url.pathname = pathname + '/models';
	}

	url.search = '';
	return url.toString();
}

function resolveDeepSeekModelsURL(apiUrl: string, provider: AIProvider) {
	const url = new URL(apiUrl);
	if (provider !== 'anthropic' || !/(^|\.)deepseek\.com$/i.test(url.hostname)) {
		return '';
	}

	let pathname = url.pathname.replace(/\/+$/, '');
	for (const ending of ['/messages', '/models', '/chat/completions', '/completions', '/responses']) {
		if (pathname.endsWith(ending)) {
			pathname = pathname.slice(0, -ending.length);
			break;
		}
	}

	if (pathname.endsWith('/anthropic')) {
		pathname = pathname.slice(0, -'/anthropic'.length);
	}

	url.pathname = (pathname || '') + '/models';
	url.search = '';
	return url.toString();
}

function resolveAIRequestURL(apiUrl: string, provider: AIProvider) {
	return provider === 'anthropic' ? resolveAnthropicMessagesURL(apiUrl) : resolveChatCompletionsURL(apiUrl);
}

function resolveAnthropicMessagesURL(apiUrl: string) {
	const url = new URL(apiUrl);
	const pathname = url.pathname.replace(/\/+$/, '');

	if (pathname.endsWith('/messages')) {
		url.pathname = pathname;
		return url.toString();
	}

	if (pathname.endsWith('/models')) {
		url.pathname = pathname.slice(0, -'/models'.length) + '/messages';
		return url.toString();
	}

	if (pathname.endsWith('/chat/completions')) {
		url.pathname = pathname.slice(0, -'/chat/completions'.length) + '/messages';
		return url.toString();
	}

	if (pathname.endsWith('/completions')) {
		url.pathname = pathname.slice(0, -'/completions'.length) + '/messages';
		return url.toString();
	}

	url.pathname = (pathname || '') + '/messages';
	return url.toString();
}

function resolveChatCompletionsURL(apiUrl: string) {
	const url = new URL(apiUrl);
	const pathname = url.pathname.replace(/\/+$/, '');

	if (pathname.endsWith('/chat/completions')) {
		url.pathname = pathname;
		return url.toString();
	}

	if (pathname.endsWith('/models')) {
		url.pathname = pathname.slice(0, -'/models'.length) + '/chat/completions';
		return url.toString();
	}

	if (pathname.endsWith('/completions')) {
		url.pathname = pathname.slice(0, -'/completions'.length) + '/chat/completions';
		return url.toString();
	}

	url.pathname = (pathname || '') + '/chat/completions';
	return url.toString();
}

export function parseModelInfos(response: any): AIModelInfo[] {
	const rawModels = Array.isArray(response)
		? response
		: Array.isArray(response?.data)
		? response.data
		: Array.isArray(response?.models)
		? response.models
		: Array.isArray(response?.data?.models)
		? response.data.models
		: [];

	const models: AIModelInfo[] = rawModels
		.map((item: any) => {
			const id = String(typeof item === 'string' ? item : item?.id || item?.name || item?.model || '').trim();
			if (!id) {
				return undefined;
			}
			return {
				id,
				supportsVision: modelSupportsImages(item)
			};
		})
		.filter(Boolean);

	return Array.from(new Map(models.map((model) => [model!.id, model!])).values()).sort((a, b) =>
		a.id.localeCompare(b.id)
	);
}

function stringifyCompact(value: any): string {
	if (!value) {
		return '';
	}
	if (typeof value === 'string') {
		return value;
	}
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

/** Explicit, tiny visual probe. No question, account or course data is sent. */
export async function probeVisionModel(opts: AIAnswererOptions): Promise<string> {
	if (!isAIAnswererReady(opts)) throw new Error('请先填写接口地址、API Key 和模型。');
	const bytes = new Uint32Array(1);
	crypto.getRandomValues(bytes);
	const code = String(1000 + (bytes[0] % 9000));
	const canvas = document.createElement('canvas');
	canvas.width = 240;
	canvas.height = 100;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('浏览器不支持生成检测图片。');
	context.fillStyle = '#ffffff';
	context.fillRect(0, 0, 240, 100);
	context.fillStyle = '#111111';
	context.font = 'bold 56px sans-serif';
	context.fillText(code, 30, 72);
	const infos = await queryAIAnswerer(
		{ ...opts, aiVisionMode: 'support', aiShowSolution: false, aiTemperature: 0 },
		{
			title: '请读出图片中的四位数字。只输出 JSON，例如 {"answer":"数字","answers":["数字"]}。',
			type: 'unknown',
			hasImage: true,
			imageUrls: [canvas.toDataURL('image/png')]
		},
		{ retryEmptyContent: false }
	);
	const info = infos[0];
	if (info?.results[0]?.answer.trim() === code) {
		rememberVisionCapability(opts, 'supported', 'probe');
		return '检测通过：模型正确读出了测试图片。';
	}
	if (isVisionUnsupportedError(info?.error || '')) {
		rememberVisionCapability(opts, 'unsupported', 'probe');
		return '接口明确不支持图片输入，请更换模型。';
	}
	rememberVisionCapability(opts, 'unknown', 'probe');
	return info?.error ? '检测未完成：' + info.error : '未能正确识别测试图片，能力仍为未知；请检查接口或手动设置。';
}

/** Web mode intentionally has no automatic retry or API credential access. */
async function queryWebAnswerer(opts: AIAnswererOptions, question: AIQuestionPayload): Promise<SearchInformation[]> {
	const name = 'DeepSeek 网页（实验）',
		homepage = 'https://chat.deepseek.com/';

	try {
		const imageUrls = Array.from(new Set((question.imageUrls || []).map((url) => url.trim()).filter(Boolean)));
		if (question.unresolvedImageCount || (question.hasImage && !imageUrls.length))
			return [
				{
					name,
					homepage,
					results: [],
					error: '题干或选项中有图片未能读取地址，已跳过，未发送到网页。',
					data: { provider: 'deepseek-web', skipped: true, reason: 'image_download_failed' }
				}
			];
		if (!question.title.trim() && !imageUrls.length) throw new Error('题目为空。');
		const inputs = await resolveAIImageInputs(imageUrls);
		if (inputs.some((image) => !image.dataUrl))
			return [
				{
					name,
					homepage,
					results: [],
					error: '题干或选项图片下载失败，已跳过，未发送残缺题目。',
					data: { provider: 'deepseek-web', skipped: true, reason: 'image_download_failed' }
				}
			];
		const images = inputs.map((image, index) => ({
			name: 'xth-image-' + (index + 1) + '.' + image.mediaType!.split('/')[1],
			dataUrl: image.dataUrl!
		}));
		const options = (Array.isArray(question.options) ? question.options : question.options?.split('\n') || []).map(
			(option) => replaceImageUrlsWithMarkers(option, imageUrls) || '（空选项）'
		);
		const prompt = [
			createSystemPrompt(question.type, opts.aiShowSolution),
			createReviewHint(question.reviewAnswer),
			'这是独立题目，请勿引用此前题目。',
			'题型：' + getQuestionTypeLabel(question.type),
			createChoiceOutputHint(question.type, options),
			'题目：',
			replaceImageUrlsWithMarkers(question.title, imageUrls) || '见图片',
			imageUrls.length
				? createImageMarkerHint(imageUrls.length) +
				  '\n附件文件名 xth-image-N 对应图片 N，请同时查看题干和所有选项图片。'
				: '',
			isLineQuestion(question.type) && question.lineOptions?.length
				? replaceImageUrlsWithMarkers(formatLineOptions(question.lineOptions), imageUrls)
				: options.map((option, index) => String.fromCharCode(65 + index) + '. ' + option).join('\n'),
			opts.aiShowSolution ? '可在 solution 字段简要说明。' : 'solution 字段请保持空字符串。'
		]
			.filter(Boolean)
			.join('\n');
		const rawContent = await requestWebAnswer(prompt, opts.aiAnswerTimeout, images, opts.webActivityId);
		const answer = normalizeAnswerByQuestionType(
			resolveAIAnswer(rawContent),
			question.type,
			question.lineOptions,
			options
		);
		const solution = normalizeAISolution(resolveAISolution(rawContent, {}));
		return [
			{
				name,
				homepage,
				results: answer
					? [
							{
								question: question.title,
								answer,
								extra_data: {
									ai: true,
									raw_content: rawContent,
									parsed_answer: answer,
									answer_parts: completionAnswerParts(rawContent, question.type),
									solution,
									usage_unavailable: true
								}
							}
					  ]
					: [],
				data: {
					provider: 'deepseek-web',
					raw_content: rawContent,
					parsed_answer: answer,
					solution,
					usage_unavailable: true
				},
				error: answer ? undefined : '网页答案不能匹配本题格式，未填写且不会自动重复请求。'
			}
		];
	} catch (error) {
		return [{ name, homepage, results: [], error: normalizeErrorMessage(error), data: { provider: 'deepseek-web' } }];
	}
}
