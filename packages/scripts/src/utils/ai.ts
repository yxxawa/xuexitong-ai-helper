import type { QuestionTypes } from '@xuexitong-ai-helper/core/src/core/worker/interface';
import type { SearchInformation } from '@xuexitong-ai-helper/core/src/core/worker/search.interface';
import { request } from '@xuexitong-ai-helper/core/src/core/utils/request';

export interface AIAnswererOptions {
	aiApiUrl: string;
	aiApiKey: string;
	aiModel: string;
	aiPrompt: string;
	aiTemperature: number;
	aiMaxTokens: number;
	aiUseResponseFormat: boolean;
	aiShowSolution?: boolean;
	aiVisionMode?: 'auto' | 'support' | 'unsupported';
	aiVisionModels?: string;
}

export interface AIQuestionPayload {
	title: string;
	type?: QuestionTypes | string;
	options?: string[] | string;
	lineOptions?: AILineOptionGroup[];
	hasImage?: boolean;
	imageUrls?: string[];
}

export interface AILineOptionGroup {
	index: number;
	options: AILineOption[];
}

export interface AILineOption {
	value: string;
	text: string;
}

export interface AIModelInfo {
	id: string;
	supportsVision: boolean;
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

const LEGACY_DEFAULT_AI_PROMPT = [
	'你是在线课程答题助手。必须只输出 JSON，不要输出 Markdown、解释、推理过程或多余文本。',
	'输出格式固定为：{"answer":"答案","answers":["答案"]}。',
	'单选题、判断题：answer 填一个答案，answers 只放这一个答案。',
	'多选题：必须返回全部正确选项，answers 放多个答案，answer 用 # 连接这些答案，例如 {"answer":"选项一#选项二","answers":["选项一","选项二"]}。',
	'填空题：多个空也放到 answers，并用 # 连接到 answer。',
	'如果题目给了选项，必须优先返回选项原文，不要只返回 A、B、C、D。',
	'只有无法确定或无法复制选项原文时，才允许返回选项字母。',
	'如果不确定，也只返回最可能的答案，不要解释。'
].join('\n');

export function isAIAnswererReady(opts: Partial<AIAnswererOptions>) {
	return Boolean(opts.aiApiUrl?.trim() && opts.aiApiKey?.trim() && opts.aiModel?.trim());
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

	return parseModelInfos(response);
}

export function isVisionModel(opts: Pick<AIAnswererOptions, 'aiModel' | 'aiVisionMode' | 'aiVisionModels'>) {
	const model = String(opts.aiModel || '').trim();
	if (!model) {
		return false;
	}

	if (opts.aiVisionMode === 'support') {
		return true;
	}
	if (opts.aiVisionMode === 'unsupported') {
		return false;
	}

	if (parseVisionModelList(opts.aiVisionModels).includes(model)) {
		return true;
	}

	return modelNameLooksVision(model);
}

export async function queryAIAnswerer(
	opts: AIAnswererOptions,
	question: AIQuestionPayload
): Promise<SearchInformation[]> {
	const title = question.title.trim();

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
	const supportsVision = isVisionModel(opts);
	const provider = resolveAIProvider(opts.aiApiUrl, opts.aiModel);

	if (question.hasImage && !supportsVision) {
		return [
			{
				name: `AI做题${opts.aiModel ? `(${opts.aiModel})` : ''}`,
				results: [],
				error: '题目包含图片，当前 AI 模型未启用视觉能力，已跳过。',
				data: {
					model: opts.aiModel,
					skipped: true,
					reason: 'model_without_vision',
					imageUrls
				}
			}
		];
	}

	const options = Array.isArray(question.options)
		? question.options.map((item) => replaceImageUrlsWithMarkers(item, imageUrls)).filter(Boolean)
		: question.options
		? question.options
				.split('\n')
				.map((item) => replaceImageUrlsWithMarkers(item, imageUrls))
				.filter(Boolean)
		: [];

	const questionTypeName = getQuestionTypeLabel(question.type);
	const promptTitle = replaceImageUrlsWithMarkers(title, imageUrls) || (imageUrls.length ? '见图片' : title);

	const userPrompt = [
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

		let response: any = await requestAI(requestUrl, provider, opts.aiApiKey, data);
		let retryInfo: Record<string, any> | undefined;
		if (shouldRetryForEmptyFinalContent(response)) {
			const firstResponse = response;
			const retryData = createFinalJsonRetryData(provider, data, opts);
			try {
				const retryResponse = await requestAI(requestUrl, provider, opts.aiApiKey, retryData);
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
		let multipleAnswerMayBeIncomplete =
			isMultipleQuestion(question.type) && normalizedAnswer !== '' && normalizedAnswer.split('#').filter(Boolean).length < 2;

		if (multipleAnswerMayBeIncomplete) {
			const retryData = JSON.parse(JSON.stringify(data));
			retryData.messages.push(
				{
					role: 'assistant',
					content: createAssistantMessageContent(
						provider,
						JSON.stringify({ answer: normalizedAnswer, answers: normalizedAnswer.split('#').filter(Boolean) })
					)
				},
				{
					role: 'user',
					content: createUserMessageContent(
						provider,
						'这是多选题。你上次只返回了一个答案，请重新判断并返回所有正确选项。必须只输出 JSON，格式为 {"answer":"选项一#选项二","answers":["选项一","选项二"]}。',
						[]
					)
				}
			);
			const retryResponse = await requestAI(requestUrl, provider, opts.aiApiKey, retryData);
			const retryRawContent = getAIContent(retryResponse);
			const retrySolution = normalizeAISolution(resolveAISolution(retryRawContent, retryResponse));
			const retryAnswer = normalizeAnswerByQuestionType(
				resolveAIAnswer(retryRawContent),
				question.type,
				question.lineOptions,
				options,
				{
					solution: retrySolution,
					rawContent: retryRawContent,
					response: retryResponse
				}
			);
			if (retryAnswer.split('#').filter(Boolean).length > normalizedAnswer.split('#').filter(Boolean).length) {
				response = retryResponse;
				rawContent = retryRawContent;
				tokenUsage = mergeTokenUsage(tokenUsage, resolveTokenUsage(retryResponse));
				normalizedAnswer = retryAnswer;
				solution = retrySolution;
				multipleAnswerMayBeIncomplete = retryAnswer.split('#').filter(Boolean).length < 2;
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
				error: normalizedAnswer
					? multipleAnswerMayBeIncomplete
						? 'AI疑似只返回了一个多选答案，请核对。'
						: undefined
					: 'AI没有返回可解析的 answer 字段。'
			}
		];
	} catch (err) {
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
					raw_content: normalizeErrorMessage(err),
					parsed_answer: ''
				},
				error: normalizeErrorMessage(err)
			}
		];
	}
}

function requestAI(requestUrl: string, provider: AIProvider, apiKey: string, data: Record<string, any>) {
	return request(requestUrl, {
			type: 'GM_xmlhttpRequest',
			method: 'post',
			responseType: 'json',
			headers: createAIHeaders(provider, apiKey),
			data
		});
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
		max_tokens: data.max_tokens,
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

function downloadImageAsDataURL(url: string): Promise<string> {
	return new Promise((resolve, reject) => {
		downloadImageAsBlob(url)
			.then((blob) => {
			if (!blob || blob.size === 0) {
				reject(new Error('图片内容为空'));
				return;
			}
			const reader = new FileReader();
			reader.onload = () => resolve(String(reader.result || ''));
			reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
			reader.readAsDataURL(blob);
			})
			.catch(reject);
	});
}

function downloadImageAsBlob(url: string): Promise<Blob> {
	return new Promise((resolve, reject) => {
		if (typeof GM_xmlhttpRequest !== 'undefined') {
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

		fetch(url, { credentials: 'include' })
			.then((response) => {
			if (!response.ok) {
				throw new Error(`图片下载失败，HTTP ${response.status}`);
			}
			return response.blob();
		})
			.then(resolve)
			.catch(reject);
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
	retryData.max_tokens = Math.max(Number(opts.aiMaxTokens || 700), opts.aiShowSolution ? 900 : 700);
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
	return String(response?.choices?.[0]?.finish_reason || response?.finish_reason || response?.data?.finish_reason || '').trim();
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
		return rawContent.map(String).join('#').trim();
	}

	if (rawContent && typeof rawContent === 'object') {
		return pickAnswerFromObject(rawContent);
	}

	const content = String(rawContent || '').trim();
	if (!content) {
		return '';
	}

	const parsed = parseJSONLike(content);
	if (parsed) {
		return pickAnswerFromObject(parsed);
	}

	return content
		.replace(/^```(?:json)?/i, '')
		.replace(/```$/i, '')
		.trim();
}

function pickAnswerFromObject(obj: any): string {
	const answer =
		obj?.answer ??
		obj?.answers ??
		obj?.result ??
		obj?.data?.answer ??
		obj?.data?.answers ??
		obj?.data?.result ??
		obj?.choices?.[0]?.message?.answer ??
		obj?.choices?.[0]?.message?.answers;
	if (Array.isArray(answer)) {
		return answer.map((item) => pickAnswerFromObject(item) || String(item)).join('#').trim();
	}
	if (answer && typeof answer === 'object') {
		return pickAnswerFromObject(answer);
	}
	return String(answer || '').trim();
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

function createSystemPrompt(prompt: string, type: AIQuestionPayload['type'], showSolution?: boolean) {
	const customPrompt = normalizeCustomPrompt(prompt);
	const basePrompt = [
		showSolution ? AI_SOLUTION_PROMPT : DEFAULT_AI_PROMPT,
		customPrompt && customPrompt !== DEFAULT_AI_PROMPT ? `额外约束：${customPrompt}` : ''
	].filter(Boolean);

	if (isSingleQuestion(type)) {
		return [
			...basePrompt,
			'当前题型：单选题。answer 优先返回选项字母 A/B/C/D；如果题目不是按字母标注且选项原文明确，才返回选项原文。answers 只放这一个最终答案；不要把计算结果当作单选答案，计算结果只写在 solution。'
		].join('\n');
	}
	if (isMultipleQuestion(type)) {
		return [
			...basePrompt,
			'当前题型：多选题。必须返回所有正确选项；answer 用 # 连接，answers 放多个元素；优先选项原文，无法确定原文时才用字母。'
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
	return [
		...basePrompt,
		'当前题型未知。优先返回可直接填写或选择的最终答案；多答案用 # 连接。'
	].join('\n');
}

function normalizeAnswerByQuestionType(
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
		return answer
			.replace(/[，、,；;|]+/g, '#')
			.replace(/\s+#\s+/g, '#')
			.replace(/#+/g, '#')
			.replace(/^#|#$/g, '')
			.trim();
	}
	if (isCompletionQuestion(type)) {
		return answer
			.replace(/^答案[:：]\s*/g, '')
			.replace(/\n+/g, '#')
			.replace(/[；;|]+/g, '#')
			.replace(/#+/g, '#')
			.replace(/^#|#$/g, '')
			.trim();
	}
	if (isJudgementQuestion(type)) {
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
	return text === 'line' || text.includes('连线') || text.includes('匹配') || text.includes('match');
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

function normalizeSingleAnswer(answer: string, options: string[] = [], context: AIAnswerContext = {}) {
	const clean = answer
		.replace(/^答案[:：]\s*/g, '')
		.replace(/[。.!！\s]+$/g, '')
		.trim();
	const optionCount = options.length || 26;

	if (/^\d+$/.test(clean)) {
		const index = Number(clean) - 1;
		if (index >= 0 && index < optionCount) {
			return String.fromCharCode(65 + index);
		}
	}

	const letter = clean.match(/^(?:选项)?([A-Z])(?:[.．、,，:：\s]|$)/i)?.[1]?.toUpperCase();
	if (letter) {
		const index = letter.charCodeAt(0) - 65;
		if (index >= 0 && index < optionCount) {
			return letter;
		}
	}

	const contextLetter = extractChoiceLetterFromAIContext(context, optionCount);
	if (contextLetter) {
		return contextLetter;
	}

	const normalizedClean = compactPromptText(clean).toLowerCase();
	const optionIndex = options.findIndex((option) => {
		const normalizedOption = compactPromptText(option).toLowerCase();
		return normalizedOption === normalizedClean || normalizedOption.replace(/^[A-Z][.．、,，:：\s]*/i, '') === normalizedClean;
	});
	if (optionIndex >= 0) {
		return options[optionIndex];
	}

	return clean;
}

function createChoiceOutputHint(type: AIQuestionPayload['type'], options: string[]) {
	if (!(isSingleQuestion(type) || isJudgementQuestion(type)) || options.length === 0) {
		return '';
	}
	return '选择题输出要求：如果能判断正确选项位置，answer 优先返回选项字母 A/B/C/D；当选项内容只是 A/B/C/D、图片选项或答案来自图片时，必须返回选项字母，不要返回图片中的选项内容、计算值或 1/2/3/4。';
}

function extractChoiceLetterFromAIContext(context: AIAnswerContext, optionCount: number) {
	const texts = [
		context.solution,
		typeof context.rawContent === 'string' ? context.rawContent : stringifyCompact(context.rawContent),
		typeof context.response === 'string' ? context.response : stringifyCompact(context.response)
	]
		.map((item) => normalizeChoiceText(item))
		.filter(Boolean);

	for (const text of texts) {
		const letter = extractChoiceLetterFromText(text, optionCount);
		if (letter) {
			return letter;
		}
	}

	return '';
}

function normalizeChoiceText(value: any) {
	return String(value || '')
		.replace(/\\n/g, '\n')
		.replace(/\\"/g, '"')
		.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
		.trim();
}

function extractChoiceLetterFromText(text: string, optionCount: number) {
	const patterns = [
		/(?:正确答案|最终答案|答案|正确选项|应选|应该选|故选|所以选|选择)\s*(?:为|是|[:：])?\s*([A-Z])/gi,
		/(?:选|选项)\s*([A-Z])(?:\s*[项。.!！,，、;；:]|$)/gi,
		/([A-Z])\s*(?:项|选项)?\s*(?:正确|为正确答案|是正确答案|符合题意)/gi
	];

	for (const pattern of patterns) {
		for (const match of text.matchAll(pattern)) {
			const letter = String(match[1] || '').toUpperCase();
			if (isChoiceLetterInRange(letter, optionCount)) {
				return letter;
			}
		}
	}

	return '';
}

function isChoiceLetterInRange(letter: string, optionCount: number) {
	if (!/^[A-Z]$/.test(letter)) {
		return false;
	}
	const index = letter.charCodeAt(0) - 65;
	return index >= 0 && index < optionCount;
}

function normalizeCustomPrompt(prompt: string) {
	const customPrompt = String(prompt || '').trim();
	if (!customPrompt || customPrompt === DEFAULT_AI_PROMPT || customPrompt === LEGACY_DEFAULT_AI_PROMPT) {
		return '';
	}
	return customPrompt;
}

function formatLineOptions(groups: AILineOptionGroup[]) {
	const lines = ['下拉框可选项：'];
	for (const group of groups) {
		lines.push(
			`${group.index + 1}:` +
				group.options.map((option) => `${compactPromptText(option.value)}=${compactPromptText(option.text)}`).join(';')
		);
	}
	return lines.join('\n');
}

function compactPromptText(text: string) {
	return String(text || '').replace(/\s+/g, ' ').trim();
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
	return count === 1 ? '图片：[图片1] 已随消息附上。' : `图片：${Array.from({ length: count }, (_, i) => `[图片${i + 1}]`).join('、')} 已随消息附上。`;
}

function normalizeLineAnswer(answer: string, lineOptions?: AILineOptionGroup[]): string {
	const values = lineOptions?.map((group) => group.options.map((option) => option.value).filter(Boolean)) || [];
	const allowedValues = new Set(values.flat());
	const answerText = answer
		.replace(/^答案[:：]\s*/g, '')
		.replace(/^连线[:：]\s*/g, '')
		.trim();

	const splitAnswers = answerText
		.replace(/[，、,；;|]+/g, '#')
		.replace(/\s+#\s+/g, '#')
		.replace(/#+/g, '#')
		.replace(/^#|#$/g, '')
		.split('#')
		.map((item) => normalizeLineAnswerToken(item, allowedValues))
		.filter(Boolean);
	if (splitAnswers.length >= values.length && values.length > 0) {
		return splitAnswers.slice(0, values.length).join('#');
	}

	const pairTokens = Array.from(answerText.matchAll(/\(([A-Za-z0-9_-]+)\s*[-—–~:：>]\s*([A-Za-z0-9_-]+)\)/g))
		.map((match) => normalizeLineAnswerToken(match[1], allowedValues) || normalizeLineAnswerToken(match[2], allowedValues))
		.filter(Boolean);
	if (pairTokens.length) {
		return pairTokens.join('#');
	}

	const json = parseJSONLike(answerText);
	if (json) {
		const picked = pickAnswerFromObject(json);
		if (picked && picked !== answerText) {
			return normalizeLineAnswer(picked, lineOptions);
		}
	}

	if (allowedValues.size) {
		const tokens = answerText.match(/[A-Za-z0-9_-]+/g) || [];
		const matchedValues = tokens.map((token) => normalizeLineAnswerToken(token, allowedValues)).filter(Boolean);
		if (matchedValues.length) {
			return matchedValues.slice(0, values.length || matchedValues.length).join('#');
		}
	}

	return answerText;
}

function normalizeLineAnswerToken(token: string, allowedValues: Set<string>) {
	const clean = token.trim().replace(/^[({[<]+|[)}\]>]+$/g, '');
	if (!allowedValues.size || allowedValues.has(clean)) {
		return clean;
	}

	const lower = clean.toLowerCase();
	return Array.from(allowedValues).find((value) => value.toLowerCase() === lower) || '';
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

function parseJSONLike(content: string) {
	const candidates = [
		content,
		content.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim(),
		content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1)
	].filter(Boolean);

	for (const candidate of candidates) {
		try {
			return JSON.parse(candidate);
		} catch {}
	}
}

function resolveHomepage(url: string) {
	try {
		return new URL(url).origin;
	} catch {
		return undefined;
	}
}

function resolveAIProvider(apiUrl: string, model = ''): AIProvider {
	const text = `${apiUrl} ${model}`.toLowerCase();
	return text.includes('anthropic') || text.includes('claude') ? 'anthropic' : 'openai';
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
	const system = createSystemPrompt(opts.aiPrompt, type, opts.aiShowSolution);
	if (provider === 'anthropic') {
		return {
			model: opts.aiModel,
			system,
			temperature: Number(opts.aiTemperature ?? 0),
			max_tokens: Number(opts.aiMaxTokens ?? 700),
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
		max_tokens: Number(opts.aiMaxTokens ?? 700),
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
			image_url: { url: image.dataUrl || createImageDataURL(image.mediaType || inferImageMediaType(image.url), image.base64 || '') }
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

function parseModelInfos(response: any): AIModelInfo[] {
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
				supportsVision: modelInfoSupportsVision(item, id)
			};
		})
		.filter(Boolean);

	return Array.from(new Map(models.map((model) => [model!.id, model!])).values()).sort((a, b) =>
		a.id.localeCompare(b.id)
	);
}

function modelInfoSupportsVision(item: any, modelName: string) {
	if (typeof item === 'string') {
		return modelNameLooksVision(modelName);
	}

	const fields = [
		item?.capabilities,
		item?.capability,
		item?.modalities,
		item?.input_modalities,
		item?.inputModalities,
		item?.features,
		item?.supported_features,
		item?.supportedFeatures,
		item?.tags,
		item?.metadata,
		item?.permission,
		item?.permissions
	];
	const text = fields.map(stringifyCompact).join(' ').toLowerCase();

	if (/(vision|visual|image|images|image_url|multimodal|multi-modal|vl|mm|ocr)/i.test(text)) {
		return true;
	}

	if (/(text-only|text_only|text only|no vision|without vision)/i.test(text)) {
		return false;
	}

	return modelNameLooksVision(modelName);
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

function parseVisionModelList(value: string | undefined) {
	return String(value || '')
		.split('\n')
		.map((item) => item.trim())
		.filter(Boolean);
}

function modelNameLooksVision(modelName: string) {
	const name = modelName.toLowerCase();
	if (/(vision|visual|(^|[-_./])vl($|[-_./\d])|glm-4v|qwen[-_.]?vl|qvq|llava|minicpm[-_.]?v|gemini|gpt[-_.]?4o|gpt[-_.]?4\.?1|gpt[-_.]?5|gpt5|(^|[-_./])o3($|[-_./])|(^|[-_./])o4($|[-_./])|claude[-_.]?3\.?5|claude[-_.]?3\.?7|claude[-_.]?4)/i.test(name)) {
		return true;
	}

	const textOnlyHints = [
		'deepseek',
		'claude-3-haiku',
		'claude-3-sonnet',
		'claude-3-opus',
		'embedding',
		'embed',
		'rerank',
		'whisper',
		'tts'
	];
	if (textOnlyHints.some((hint) => name.includes(hint))) {
		return false;
	}
	return false;
}
