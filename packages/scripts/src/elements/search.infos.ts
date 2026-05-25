import { $ } from '@xuexitong-ai-helper/core/src/utils/common';
import { splitAnswer } from '@xuexitong-ai-helper/core/src/core/worker/utils';
import type { QuestionTypes, SimplifyWorkResult } from '@xuexitong-ai-helper/core/src/core/worker/interface';
import { $modal, $ui, h } from 'easy-us';
import { createQuestionTitleExtra } from '../utils';

/**
 * 判断是否有图片链接，如果有则使用 <img> 标签包裹，但如果已经被 <img> 包裹则不处理
 */
const transformImgLinkOfQuestion = (question: string) => {
	// 防止题目中包含 img 标签元素，所以先统一吧 img 标签替换成链接
	const dom = new DOMParser().parseFromString(question, 'text/html');
	for (const img of Array.from(dom.querySelectorAll('img'))) {
		img.replaceWith(img.src);
	}
	// 最后将所有图片链接替换成 img 标签
	return dom.documentElement.innerHTML.replace(/https?:\/\/.+?\.(png|jpg|jpeg|gif)/g, (img) => {
		return `<img src="${img}" />`;
	});
};

/**
 * 搜索结果元素
 */
export class SearchInfosElement extends HTMLElement {
	private _infos: SimplifyWorkResult['searchInfos'] = [];
	private _question: string = '';
	private _type: QuestionTypes;
	private _hideResultQuestion: boolean = false;

	/** 搜索结果 [题目，答案] */
	get infos() {
		return this._infos;
	}
	set infos(value: SimplifyWorkResult['searchInfos']) {
		this._infos = value || [];
		this.render();
	}

	/** 当前的题目 */
	get question() {
		return this._question;
	}
	set question(value: string) {
		this._question = value || '';
		this.render();
	}

	get type() {
		return this._type;
	}
	set type(value: QuestionTypes) {
		this._type = value;
		this.render();
	}

	get hideResultQuestion() {
		return this._hideResultQuestion;
	}
	set hideResultQuestion(value: boolean) {
		this._hideResultQuestion = Boolean(value);
		this.render();
	}

	connectedCallback() {
		this.render();
	}

	private render() {
		if (!this.isConnected) {
			return;
		}

		this.replaceChildren();
		const question = transformImgLinkOfQuestion(this.question || '无');

		const type_text = {
			single: '单选题',
			multiple: '多选题',
			judgement: '判断题',
			completion: '填空题'
		};
		const type_label = this.type ? Reflect.get(type_text, this.type) : '';

		if (!this.hideResultQuestion) {
			this.append(
				h(
					'div',
					[
						...(type_label ? [h('span', { className: 'search-result-question-type' }, type_label)] : []),
						h('span', { innerHTML: question }),
						createQuestionTitleExtra(this.question)
					],
					(div) => {
						div.className = 'search-info-title';
					}
				)
			);
		}

		this.append(
			...this.infos.map((info) => {
				return h('details', { open: true, className: 'search-info-details' }, [
					h('summary', [h('span', { innerText: info.name })]),

					...(info.error
						? /** 显示错误信息 */
						  [h('span', { className: 'error' }, [info.error || '网络错误或者未知错误'])]
						: /** 显示结果列表 */
						  []
					).concat([
						...info.results.map((ans) => {
							const title = transformImgLinkOfQuestion(ans[0] || this.question || '无');
							const answer = transformImgLinkOfQuestion(ans[1] || '无');
							const extra_data = JSON.parse(JSON.stringify(ans[2] || {}));
							const rawContent = resolveRawContent(extra_data, info);
							const solution = resolveSolution(extra_data, info);
							const parsedAnswer = stringifyForDisplay(extra_data.parsed_answer || ans[1] || '');
							const resultRawButton = rawContent
								? createRawOutputButton('原始输出', () =>
										showRawAIOutput(info, {
											rawContent,
											parsedAnswer,
											answer: ans[1],
											solution,
											extraData: extra_data
										})
								  )
								: '';

							if (extra_data.ai) {
								extra_data.tags = extra_data.tags || [];
								extra_data.tags.push({
									text: 'AI',
									title: '此答案由 AI 生成，仅供参考',
									color: 'blue'
								});
							}

							if (extra_data.token_usage?.total_tokens) {
								extra_data.tags = extra_data.tags || [];
								extra_data.tags.push({
									text: `${extra_data.token_usage.total_tokens} tokens`,
									title: `本题 AI token 消耗：${extra_data.token_usage.total_tokens}\n输入：${
										extra_data.token_usage.prompt_tokens || 0
									}\n输出：${extra_data.token_usage.completion_tokens || 0}`,
									color: 'gray'
								});
							}

							if (extra_data.cache) {
								extra_data.tags = extra_data.tags || [];
								extra_data.tags.push({
									text: '答案缓存',
									title:
										'此答案来自本地缓存，由 AI 搜索后保存在本地。\n- 清空缓存：请前往工具-答案缓存\n- 关闭缓存：请前往AI设置-答案缓存',
									color: 'gray'
								});
							}

							return h('div', { className: 'search-result' }, [
								/** 题目 */
								...(this.hideResultQuestion ? [] : [h('div', { className: 'question' }, [h('span', { innerHTML: title })])]),
								/** 答案 */
								h('div', { className: 'answer' }, [
									h('span', '答案：'),
									...(extra_data.tags
										? extra_data.tags.map((tag: { text: string; title: string; color: string }) =>
												$ui.tooltip(
													h('span', {
														className: 'search-result-answer-tag ' + tag.color,
														innerHTML: tag.text,
														title: tag.title,
														dataset: { title: tag.title }
													})
												)
										  )
										: []),
									...splitAnswer(answer).map((a) => h('code', { innerHTML: a })),
									resultRawButton
								]),
								...(solution
									? [
											h('div', { className: 'ai-solution-output' }, [
												h('div', { className: 'ai-solution-title' }, '解答过程'),
												h('pre', normalizeSolutionForDisplay(solution))
											])
									  ]
									: []),
								...(rawContent
									? [
											h('div', { className: 'ai-raw-output' }, [
												h('span', 'AI输出：'),
												h('code', compactRawOutput(rawContent))
											])
									  ]
									: [])
							]);
						})
					])
				]);
			})
		);

		$.onresize(this, (sr) => {
			sr.style.maxHeight = window.innerHeight / 2 + 'px';
		});
	}
}

if (typeof customElements !== 'undefined' && customElements.get('search-infos-element') === undefined) {
	customElements.define('search-infos-element', SearchInfosElement);
}

type RawResultContext = {
	rawContent?: any;
	parsedAnswer?: any;
	answer?: any;
	solution?: any;
	extraData?: any;
};

export function createRawOutputButton(text: string, onclick: (event: MouseEvent) => void) {
	return h(
		'a',
		{
			className: 'raw-output-link',
			innerText: text
		},
		(btn: HTMLAnchorElement) => {
			btn.onclick = (event: MouseEvent) => {
				event.preventDefault();
				event.stopPropagation();
				onclick(event);
			};
		}
	);
}

export function showRawAIOutput(info: SimplifyWorkResult['searchInfos'][number], result?: RawResultContext) {
	const response = stringifyForDisplay(info.response ?? '无响应内容');
	const request = stringifyForDisplay(info.data ?? '无请求内容');
	const rawContent = stringifyForDisplay(result?.rawContent ?? info.data?.raw_content ?? '无原始文本');
	const parsedAnswer = stringifyForDisplay(result?.parsedAnswer ?? info.data?.parsed_answer ?? '无解析答案');
	const finalAnswer = stringifyForDisplay(result?.answer ?? '无最终答案');
	const solution = stringifyForDisplay(result?.solution ?? info.data?.solution ?? '无解答过程');
	const extraData = stringifyForDisplay(result?.extraData ?? '无附加数据');

	$modal.alert({
		width: 720,
		title: 'AI 原始输出',
		confirmButtonText: '关闭',
		content: h('div', [
			h('div', { style: { marginBottom: '8px', fontWeight: 'bold' } }, 'AI输出 raw_content'),
			h('pre', { style: rawBlockStyle }, rawContent),
			h('div', { style: { margin: '12px 0 8px', fontWeight: 'bold' } }, '解析结果'),
			h('pre', { style: rawBlockStyle }, `parsed_answer: ${parsedAnswer}\nfinal_answer: ${finalAnswer}`),
			h('div', { style: { margin: '12px 0 8px', fontWeight: 'bold' } }, '规范化解答过程 solution'),
			h('pre', { style: rawBlockStyle }, solution),
			h('div', { style: { margin: '12px 0 8px', fontWeight: 'bold' } }, '答案附加数据 extra_data'),
			h('pre', { style: rawBlockStyle }, extraData),
			h('div', { style: { marginBottom: '8px', fontWeight: 'bold' } }, '响应 response'),
			h('pre', { style: rawBlockStyle }, response),
			h('div', { style: { margin: '12px 0 8px', fontWeight: 'bold' } }, '请求 data'),
			h('pre', { style: rawBlockStyle }, request)
		])
	});
}

const rawBlockStyle = {
	whiteSpace: 'pre-wrap',
	wordBreak: 'break-word',
	maxHeight: '260px',
	overflow: 'auto',
	padding: '8px',
	background: '#f7f7f7',
	border: '1px solid #ddd',
	borderRadius: '4px'
};

function stringifyForDisplay(value: any) {
	if (typeof value === 'string') {
		try {
			return JSON.stringify(JSON.parse(value), null, 2);
		} catch {
			return value;
		}
	}
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function resolveRawContent(extraData: any, info: SimplifyWorkResult['searchInfos'][number]) {
	return extraData?.raw_content ?? info.data?.raw_content ?? extractAITextFromResponse(info.response);
}

function resolveSolution(extraData: any, info: SimplifyWorkResult['searchInfos'][number]) {
	return normalizeSolutionForDisplay(extraData?.solution ?? info.data?.solution ?? '');
}

function extractAITextFromResponse(response: any) {
	if (!response) {
		return '';
	}
	if (typeof response === 'string') {
		return response;
	}
	if (typeof response?.content === 'string') {
		return response.content;
	}
	if (Array.isArray(response?.content)) {
		return response.content
			.map((item: any) => (typeof item === 'string' ? item : item?.text || ''))
			.filter(Boolean)
			.join('\n');
	}
	return response?.choices?.[0]?.message?.content || response?.choices?.[0]?.text || response?.answer || response?.data?.answer || '';
}

function compactRawOutput(value: any) {
	const text = stringifyForDisplay(value).replace(/\s+/g, ' ').trim();
	if (text.length <= 220) {
		return text;
	}
	return text.slice(0, 220) + '...';
}

function normalizeSolutionForDisplay(value: any) {
	const text = stringifyForDisplay(value)
		.replace(/^"|"$/g, '')
		.replace(/\\n/g, '\n')
		.replace(/\r\n/g, '\n')
		.replace(/[ \t]+\n/g, '\n')
		.replace(/\n{3,}/g, '\n\n')
		.trim();
	return text === '""' ? '' : text;
}
