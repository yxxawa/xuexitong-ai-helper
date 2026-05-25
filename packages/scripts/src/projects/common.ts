import debounce from 'lodash/debounce';
import { $ } from '@xuexitong-ai-helper/core/src/utils/common';
import { request } from '@xuexitong-ai-helper/core/src/core/utils/request';
import type { SimplifyWorkResult, WorkUploadType } from '@xuexitong-ai-helper/core/src/core/worker/interface';
import { $message, h, $gm, $store, Project, Script, $modal, StoreListenerType, $ui } from 'easy-us';
import type { AnswerMatchMode } from '@xuexitong-ai-helper/core/src/core/worker/interface';
import type { SearchInformation } from '@xuexitong-ai-helper/core/src/core/worker/search.interface';
import { WorkerConfig } from '@xuexitong-ai-helper/core/src/core/worker/config';
import { CXProject } from '../index';
import { enableCopy } from '../utils';
import { createRawOutputButton, SearchInfosElement, showRawAIOutput } from '../elements/search.infos';
import { RenderScript } from '../render';
import { dropdownStyle } from '../utils/configs';
import {
	AILineOptionGroup,
	DEFAULT_AI_PROMPT,
	fetchAIModels,
	hasAnswerProvider,
	queryAIAnswerer
} from '../utils/ai';

const TAB_WORK_RESULTS_KEY = 'common.work-results.results';

const state = {
	workResult: {
		/**
		 * 题目位置同步处理器
		 */
		questionPositionSyncHandler: {
			cx: (index: number) => {
				const el = document.querySelectorAll<HTMLElement>('[id*="sigleQuestionDiv"], .questionLi')?.item(index);
				if (el) {
					window.scrollTo({
						top: el.getBoundingClientRect().top + window.pageYOffset - 50,
						behavior: 'smooth'
					});
				}
			}
		}
	},
	setting: {
		listenerIds: {
			aw: 0 as StoreListenerType
		}
	}
};

/**
 * 答案缓存类型
 */
type QuestionCache = { title: string; answer: string; from: string; homepage: string; ai?: boolean };

type SearchAnswerOptions = {
	type?: string;
	options?: string[] | string;
	lineOptions?: AILineOptionGroup[];
	hasImage?: boolean;
	imageUrls?: string[];
};

export const CommonProject = Project.create({
	name: '学习通AI辅助插件',
	domains: [],
	scripts: {
		guide: new Script({
			name: '首页',
			matches: [['所有页面', /.*/]],
			namespace: 'common.guide',
			configs: {
				notes: {
					defaultValue: $ui.notes([
						'支持章节学习、章节测试、作业、考试预览和 AI 答题。',
						'进入课程、作业或考试页面后，脚本会自动显示对应控制面板。',
						'自动答题前请先配置 AI 接口、API Key 和模型。'
					]).outerHTML
				}
			},
			onrender({ panel }) {
				const guide = createGuide();
				guide.style.width = '520px';
				panel.body.replaceChildren(guide);
			}
		}),
		settings: new Script({
			name: 'AI设置',
			matches: [['所有页面', /.*/]],
			namespace: 'common.settings',
			configs: {
				notes: {
					defaultValue: $ui.notes([
						'先填写 AI 接口地址和 API Key，再点击“AI模型”获取模型列表。',
						'选择模型后进入章节测试、作业或考试页面即可自动答题。',
						'鼠标移动到按钮或输入框可以查看说明。'
					]).outerHTML
				},
				upload: {
					label: '答题完成后',
					tag: 'select',
					defaultValue: 80 as WorkUploadType,
					options: [
						['save', '自动保存', '完成后自动保存答案, 注意如果你开启了随机作答, 有可能分辨不出答案是否正确。'],
						['nomove', '不保存也不提交', '等待时间过后将会自动下一节, 适合在测试脚本时使用。'],
						...([10, 20, 30, 40, 50, 60, 70, 80, 90].map((rate) => [
							rate,
							`搜到${rate}%的题目则自动提交`,
							`例如: 100题中查询到 ${rate} 题的答案,（答案不一定正确）, 则会自动提交。`
						]) as [any, string, string][]),
						['100', '每个题目都查到答案才自动提交', '答案不一定正确'],
						['force', '强制自动提交', '不管答案是否正确直接强制自动提交，如需开启，请配合随机作答谨慎使用。']
					],
					attrs: {
						title:
							'自动答题完成后的设置，目前仅在章节测试中生效，鼠标悬浮在选项上可以查看说明。'
					}
				},
				thread: {
					label: 'AI并发线程（个）',
					attrs: {
						type: 'number',
						min: 1,
						step: 1,
						max: 8,
						title:
							'作业/考试/章节测试中同时请求 AI 的题目数量。数值越大越快，也更容易触发接口限速；建议 1-3。'
					},
					defaultValue: 1
				},
				aiApiUrl: {
					separator: 'AI做题',
					label: 'AI接口地址',
					attrs: {
						placeholder: 'https://api.openai.com/v1/chat/completions',
						title: '填写 OpenAI 兼容的 chat/completions 接口地址。'
					},
					defaultValue: ''
				},
				aiApiKey: {
					label: 'AI API Key',
					attrs: {
						type: 'password',
						placeholder: 'sk-...',
						title: '请求时会放入 Authorization: Bearer <key>。'
					},
					defaultValue: ''
				},
				aiModel: {
					attrs: { type: 'hidden' },
					defaultValue: ''
				},
				aiVisionModels: {
					attrs: { type: 'hidden' },
					defaultValue: ''
				},
				aiVisionMode: {
					label: '模型支持图片识别',
					tag: 'select',
					defaultValue: 'auto' as 'auto' | 'support' | 'unsupported',
					options: [
						['auto', '自动判断', '根据 /models 返回信息和模型名自动判断是否支持图片识别。'],
						['support', '支持', '强制认为当前模型支持图片识别，图片题会把图片链接发送给 AI。'],
						['unsupported', '不支持', '强制认为当前模型不支持图片识别，图片题会直接跳过。']
					],
					attrs: {
						title: '默认自动判断；如果接口返回的模型能力不准，可以手动指定支持或不支持。'
					}
				},
				aiModelFetchButton: {
					label: 'AI模型',
					defaultValue: '点击获取模型列表',
					attrs: {
						type: 'button',
						title: '根据 AI 接口地址自动请求 /models，并选择接口支持的模型。当前选择会作为 AI 请求的 model 字段。'
					},
					onload() {
						this.value = CommonProject.scripts.settings.cfg.aiModel
							? '当前模型：' + CommonProject.scripts.settings.cfg.aiModel
							: '点击获取模型列表';
						this.onclick = async () => {
							try {
								this.value = '获取中...';
								this.disabled = true;
								const models = await fetchAIModels(CommonProject.scripts.settings.cfg);

								if (models.length === 0) {
									$modal.alert({
										content: '没有从接口返回中解析到模型列表，请检查接口是否支持 /models。'
									});
									return;
								}

								const select = h(
									'select',
									{
										className: 'base-style-active-form-control',
										style: { width: '100%', marginTop: '8px' }
									},
									models.map((model) =>
										h(
											'option',
											{ value: model.id, selected: model.id === CommonProject.scripts.settings.cfg.aiModel },
											model.supportsVision ? `${model.id} [视觉]` : model.id
										)
									)
								);

								const modal = $modal.confirm({
									width: 520,
									title: '选择AI模型',
									content: h('div', [
										h('div', { className: 'secondary' }, `已获取 ${models.length} 个模型。`),
										h(
											'div',
											{ className: 'secondary', style: { marginTop: '4px' } },
											'带 [视觉] 的模型会在“自动判断”下处理图片题；也可以用“模型支持图片识别”手动覆盖。'
										),
										select
									]),
									confirmButtonText: '使用此模型',
									onConfirm: () => {
										CommonProject.scripts.settings.cfg.aiModel = select.value;
										CommonProject.scripts.settings.cfg.aiVisionModels = models
											.filter((model) => model.supportsVision)
											.map((model) => model.id)
											.join('\n');
										this.value = '当前模型：' + select.value;
										modal?.remove();
									}
								});
							} catch (err) {
								$modal.alert({
									content: h('div', [
										h('div', '获取模型列表失败：'),
										h('pre', { style: { whiteSpace: 'pre-wrap' } }, err instanceof Error ? err.message : String(err))
									])
								});
							} finally {
								this.disabled = false;
								if (this.value === '获取中...') {
									this.value = '点击获取';
								}
							}
						};
					}
				},
				aiPrompt: {
					label: 'AI输出限制',
					tag: 'textarea',
					attrs: {
						title: '限制 AI 只返回可解析答案。请保留 JSON answer 格式要求。',
						style: { minWidth: '260px', minHeight: '150px' }
					},
					defaultValue: DEFAULT_AI_PROMPT,
					onload(el) {
						el.addEventListener('change', () => {
							if (String(el.value).trim() === '') {
								el.value = el.defaultValue;
							}
						});
					}
				},
				aiTemperature: {
					label: 'AI随机度',
					attrs: {
						type: 'number',
						min: 0,
						max: 1,
						step: 0.1,
						title: '建议保持 0，让输出更稳定。'
					},
					defaultValue: 0
				},
				aiMaxTokens: {
					label: 'AI最大输出',
					attrs: {
						type: 'number',
						min: 50,
						max: 2000,
						step: 50,
						title: '限制 AI 输出长度，避免返回过多解释。'
					},
					defaultValue: 700
				},
				aiUseResponseFormat: {
					label: '强制JSON输出',
					attrs: {
						type: 'checkbox',
						title: '对支持 response_format=json_object 的 OpenAI 兼容接口生效；如果接口不支持，请关闭。'
					},
					defaultValue: true
				},
				aiShowSolution: {
					label: '输出解答过程',
					attrs: {
						type: 'checkbox',
						title: '会增加token消耗。开启后要求 AI 额外返回规范化解答过程，理科公式会尽量按清晰文本格式展示。'
					},
					defaultValue: false
				},
				'work-when-no-job': {
					defaultValue: false,
					label: '强制答题',
					attrs: {
						type: 'checkbox',
						title:
							'当章节测试左上角并没有黄色任务点的时候依然进行答题（没有任务点说明此作业可能不计入总成绩，如果老师要求则可以开启）'
					}
				},
				'randomWork-choice': {
					defaultValue: false,
					label: '随机选择',
					attrs: { type: 'checkbox', title: 'AI 没有返回可用答案时，随机选择任意一个选项' }
				},
				'randomWork-complete': {
					defaultValue: false,
					label: '随机填空',
					attrs: { type: 'checkbox', title: 'AI 没有返回可用答案时，随机填写以下任意一个文案' }
				},
				'randomWork-completeTexts-textarea': {
					defaultValue: ['不会', '不知道', '不清楚', '不懂', '不会写'].join('\n'),
					label: '随机填空文案',
					tag: 'textarea',
					showIf: 'common.settings.randomWork-complete',
					attrs: { title: '每行一个，随机填入', style: { minWidth: '200px', minHeight: '50px' } },
					onload(el) {
						el.addEventListener('change', () => {
							if (String(el.value).trim() === '') {
								el.value = el.defaultValue;
							}
						});
					}
				},
				advancedSettings: {
					...dropdownStyle,
					defaultValue: false,
					label: '高级设置',
					attrs: { type: 'checkbox', title: '请谨慎使用高级设置，可能会影响答题效果，小白在未理解的情况下谨慎调整。' }
				},
				aiAnswerTimeout: {
					showIf: 'common.settings.advancedSettings',
					elementClassName: 'config-details',
					label: 'AI最大耗时（秒）',
					attrs: {
						type: 'number',
						min: 10,
						step: 1,
						max: 3 * 60,
						title: 'AI答题超时时间，单位为秒，超过这个时间直接放弃，进行下一题。'
					},
					defaultValue: 120
				},
				stopSecondWhenFinish: {
					showIf: 'common.settings.advancedSettings',
					elementClassName: 'config-details',
					label: '答题结束后暂停（秒）',
					attrs: {
						type: 'number',
						min: 3,
						step: 1,
						max: 9999,
						title: '自动答题脚本结束后暂停的时间（方便查看和检查）。'
					},
					defaultValue: 3
				},
				period: {
					showIf: 'common.settings.advancedSettings',
					elementClassName: 'config-details',
					label: 'AI请求间隔（秒）',
					attrs: {
						type: 'number',
						min: 1,
						step: 1,
						max: 60,
						title: '发起两次 AI 请求之间的最小间隔。开启多线程时也会按这个间隔错开发请求，避免瞬间打满接口。'
					},
					defaultValue: 3
				},
				answerSeparators: {
					showIf: 'common.settings.advancedSettings',
					elementClassName: 'config-details',
					label: '答案分隔符',
					attrs: {
						title: "分隔答案的符号，例如：答案1#答案2#答案3，分隔符为 #， 使用英文逗号进行隔开 : ',' "
					},
					defaultValue: ['===', '#', '---', '###', '|', ';', '；'].join(','),
					onload(el) {
						el.addEventListener('change', () => {
							if (String(el.value).trim() === '') {
								el.value = el.defaultValue;
							}
						});
					}
				},
				answerMatchMode: {
					showIf: 'common.settings.advancedSettings',
					elementClassName: 'config-details',
					label: '答案匹配模式',
					tag: 'select',
					defaultValue: 'similar' as AnswerMatchMode,
					options: [
						['similar', '相似匹配', '答案相似度达到60%以上就匹配'],
						['exact', '精确匹配', '答案必须完全一致才匹配']
					]
				},
				redundanceWordsText: {
					showIf: 'common.settings.advancedSettings',
					elementClassName: 'config-details',
					defaultValue: [
						'单选题(必考)',
						'填空题(必考)',
						'多选题(必考)',
						'(单选题)',
						'(多选题)',
						'(判断题)',
						'(填空题)',
						'【单选题】',
						'【多选题】',
						'【填空题】',
						'【判断题】',
						'【單選题】',
						'【多選题】',
						'【判斷题】',
						'【Single Choice】',
						'【Multiple Choice】',
						'【single choice】',
						'【multiple choice】',
						'【True or False】'
					].join('\n'),
					label: '题目冗余字段自动删除',
					tag: 'textarea',
					attrs: {
						title: '在搜题的时候自动删除多余的文字，以便提高搜题的准确度，每行一个。',
						style: { minWidth: '200px', minHeight: '50px' }
					},
					onload(el) {
						el.addEventListener('change', () => {
							if (String(el.value).trim() === '') {
								el.value = el.defaultValue;
							}
						});
					}
				},
				notification: {
					separator: '其他设置',
					label: '系统通知',
					attrs: {
						title:
							'允许脚本发送系统通知，只有重要事情发生时会发送系统通知，尽量避免用户受到骚扰（在电脑屏幕右侧显示通知弹窗，例如脚本执行完毕，图形验证码，版本更新等通知）。'
					},
					tag: 'select',
					defaultValue: 'only-notify' as 'only-notify' | 'notify-and-voice' | 'all' | 'no-notify',
					options: [
						['only-notify', '只显示右下角通知'],
						['notify-and-voice', '通知以及提示音（叮的一声）'],
						['all', '通知，提示音，以及任务栏闪烁提示'],
						['no-notify', '关闭系统通知']
					]
				},
				notificationWebhooks: {
					label: '通知回调',
					attrs: {
						title:
							// eslint-disable-next-line no-template-curly-in-string
							'发送系统通知时发送回调请求，用于专业开发人员对接其他通知系统。（每行填写一个URL，顺序发送GET请求，${message} 为消息占位符，可用于消息变量替换）'
					},
					tag: 'textarea',
					defaultValue: ''
				},
				enableQuestionCaches: {
					label: '答案缓存',
					defaultValue: true,
					attrs: { type: 'checkbox', title: '缓存 AI 搜索结果，重复题目可直接复用。' }
				}
			},
			methods() {
				return {
					/**
					 * 获取自动答题配置。
					 */
					getWorkOptions: () => {
						// 使用 json 深拷贝，防止修改原始配置
						const cfg = JSON.parse(JSON.stringify(this.cfg)) as typeof this.cfg;
						cfg.thread = Math.max(1, Math.min(8, parseInt(String(cfg.thread || 1), 10) || 1));
						cfg.period = Math.max(1, parseInt(String(cfg.period || 1), 10) || 1);
						cfg.aiTemperature = Number(cfg.aiTemperature ?? 0);
						cfg.aiMaxTokens = Math.max(1, parseInt(String(cfg.aiMaxTokens || 700), 10) || 700);
						cfg.stopSecondWhenFinish = Math.max(
							0,
							parseInt(String(cfg.stopSecondWhenFinish || 0), 10) || 0
						);
						return cfg;
					},
					/**
					 * 根据全局设置的配置，发起通知
					 * @param content
					 * @param opts
					 */
					notificationBySetting: (
						content: string,
						opts?: {
							extraTitle?: string;
							/** 显示时间，单位为秒，默认为 30 秒， 0 则表示一直存在 */
							duration?: number;
							/** 通知点击时 */
							onclick?: () => void;
							/** 通知关闭时 */
							ondone?: () => void;
						}
					) => {
						if (this.cfg.notification !== 'no-notify') {
							$gm.notification(content, {
								extraTitle: opts?.extraTitle,
								duration: opts?.duration ?? 30,
								important: this.cfg.notification === 'all',
								silent: this.cfg.notification === 'only-notify'
							});

							const message = (opts?.extraTitle ? opts?.extraTitle + '：' : '') + content;

							const webhooks = this.cfg.notificationWebhooks
								.split('\n')
								.map((i) => i.trim())
								.filter(Boolean);

							for (const webhook of webhooks) {
								let resolved_webhook = webhook;
								// eslint-disable-next-line no-template-curly-in-string
								resolved_webhook = webhook.replace('${message}', encodeURIComponent(message));
								request(resolved_webhook, {
									method: 'get',
									type: 'GM_xmlhttpRequest'
								})
									.then((result) => {
										console.debug('通知回调成功', { webhook: resolved_webhook, result });
									})
									.catch((err) => {
										console.debug('通知回调失败', { webhook: resolved_webhook, err });
									});
							}
						}
					}
				};
			},
			// 实时更新内部设置
			oncomplete() {
				WorkerConfig.timeout_seconds = this.cfg.aiAnswerTimeout;
				this.onConfigChange('aiAnswerTimeout', (sec) => {
					WorkerConfig.timeout_seconds = sec;
				});
			},
			onrender({ panel }) {
				if ($gm.isInGMContext()) {
					const testNotification = h(
						'button',
						{ className: 'base-style-button' },
						'测试系统通知'
					);
					testNotification.onclick = () => {
						this.methods.notificationBySetting('这是一条测试通知');
					};
					panel.body.replaceChildren(h('hr'), h('div', { style: { display: 'flex' } }, [testNotification]));
				}
			}
		}),
		workResults: new Script({
			name: '答题结果',
			matches: [['所有页面', /.*/]],
			namespace: 'common.work-results',
			configs: {
				notes: {
					defaultValue: $ui.notes([
						'点击题目序号查看 AI 返回的答案。',
						'结果中会显示 AI 标记和 token 消耗；如果未完成，通常是答案没有匹配到页面选项。'
					]).outerHTML
				},
				/**
				 * 显示类型
				 * list: 显示为题目列表
				 * numbers: 显示为序号列表
				 */
				type: {
					label: '显示类型',
					tag: 'select',
					options: [
						['numbers', '序号列表'],
						['questions', '题目列表']
					],
					attrs: {
						title: '使用题目列表可能会造成页面卡顿。'
					},
					defaultValue: 'numbers' as 'questions' | 'numbers'
				},
				totalQuestionCount: {
					defaultValue: 0
				},
				requestedCount: {
					defaultValue: 0
				},
				resolvedCount: {
					defaultValue: 0
				},
				currentResultIndex: {
					defaultValue: 0
				},
				questionPositionSyncHandlerType: {
					defaultValue: undefined as keyof typeof state.workResult.questionPositionSyncHandler | undefined
				}
			},
			methods() {
				return {
					/**
					 * 从搜索结果中计算状态，并更新
					 */
					updateWorkStateByResults: (results: { requested: boolean; resolved: boolean }[]) => {
						this.cfg.totalQuestionCount = results.length;
						this.cfg.requestedCount = results.filter((result) => result.requested).length;
						this.cfg.resolvedCount = results.filter((result) => result.resolved).length;
					},
					/**
					 * 更新状态
					 */
					updateWorkState: (state: { totalQuestionCount: number; requestedCount: number; resolvedCount: number }) => {
						this.cfg.totalQuestionCount = state.totalQuestionCount;
						this.cfg.requestedCount = state.requestedCount;
						this.cfg.resolvedCount = state.resolvedCount;
					},
					/**
					 * 刷新状态
					 */
					refreshState: () => {
						this.cfg.totalQuestionCount = 0;
						this.cfg.requestedCount = 0;
						this.cfg.resolvedCount = 0;
					},
					/**
					 * 清空搜索结果
					 */
					clearResults: () => {
						return $store.setTab(TAB_WORK_RESULTS_KEY, []);
					},
					getResults(): Promise<SimplifyWorkResult[]> | undefined {
						return $store.getTab(TAB_WORK_RESULTS_KEY) || undefined;
					},
					setResults(results: SimplifyWorkResult[]) {
						return $store.setTab(TAB_WORK_RESULTS_KEY, results);
					},
					async appendResults(results: SimplifyWorkResult[]) {
						const data = (await $store.getTab(TAB_WORK_RESULTS_KEY)) || [];
						data.push(...results);
						return $store.setTab(TAB_WORK_RESULTS_KEY, data);
					},
					/**
					 * 刷新搜索结果状态，清空搜索结果，置顶搜索结果面板
					 */
					init(opts?: { questionPositionSyncHandlerType?: keyof typeof state.workResult.questionPositionSyncHandler }) {
						CommonProject.scripts.workResults.cfg.questionPositionSyncHandlerType =
							opts?.questionPositionSyncHandlerType;
						// 刷新搜索结果状态
						CommonProject.scripts.workResults.methods.refreshState();
						// 清空搜索结果
						CommonProject.scripts.workResults.methods.clearResults();
					},
					/**
					 * 创建搜索结果面板
					 * @param mount 挂载点
					 */
					createWorkResultsPanel: (mount?: HTMLElement) => {
						const container = mount || h('div');
						container.style.width = '100%';
						container.style.boxSizing = 'border-box';
						/** 记录滚动高度 */
						let scrollPercent = 0;

						/** 列表 */
						const list = h('div', { className: 'work-result-list' });

						/** 是否悬浮在题目上 */
						let mouseoverIndex = -1;

						list.onscroll = () => {
							scrollPercent = list.scrollTop / list.scrollHeight;
						};

						/** 给序号设置样式 */
						const setNumStyle = (result: SimplifyWorkResult, num: HTMLElement, index: number) => {
							if (result.requested) {
								num.classList.add('requested');
							}

							if (index === this.cfg.currentResultIndex) {
								num.classList.add('active');
							}

							if (result.finish) {
								num.classList.add('finish');
							} else {
								if (
									result.requested &&
									result.resolved &&
									(result.error?.trim().length !== 0 || result.searchInfos.length === 0 || result.finish === false)
								) {
									num.classList.add('error');
								}
							}
						};

						/** 渲染结果面板 */
						const render = debounce(async () => {
							const results: SimplifyWorkResult[] | undefined =
								await CommonProject.scripts.workResults.methods.getResults();
							const tokenStats = getAITokenStats(results || []);

							if (results?.length) {
								// 如果序号指向的结果为空，则代表已经被清空，则重新让index变成0
								if (results[this.cfg.currentResultIndex] === undefined) {
									this.cfg.currentResultIndex = 0;
								}

								// 渲染序号或者题目列表
								if (this.cfg.type === 'numbers') {
									const resultContainer = h('div', { className: 'work-result-container' });

									list.style.marginBottom = '12px';
									list.style.overflow = 'auto';
									list.style.maxHeight = '180px';
									list.style.width = '100%';
									list.style.boxSizing = 'border-box';

									/** 渲染序号 */
									const nums = results.map((result, index) => {
										return h('span', { className: 'search-infos-num', innerText: (index + 1).toString() }, (num) => {
											setNumStyle(result, num, index);

											num.onclick = () => {
												for (const n of nums) {
													n.classList.remove('active');
												}
												num.classList.add('active');
												// 更新显示序号
												this.cfg.currentResultIndex = index;
												// 重新渲染结果列表
												resultContainer.replaceChildren(createResult(result));
												// 触发页面题目元素同步器
												if (this.cfg.questionPositionSyncHandlerType) {
													state.workResult.questionPositionSyncHandler[this.cfg.questionPositionSyncHandlerType]?.(
														index
													);
												}
											};
										});
									});

									list.replaceChildren(...nums);
									// 初始显示指定序号的结果
									resultContainer.replaceChildren(createResult(results[this.cfg.currentResultIndex]));

									container.replaceChildren(list, resultContainer);
								} else {
									/** 左侧题目列表 */

									list.style.overflow = 'auto';
									list.style.maxHeight = window.innerHeight / 2 + 'px';

									/** 右侧结果 */
									const resultContainer = h('div', { className: 'work-result-question-container' });
									const nums: HTMLSpanElement[] = [];
									/** 左侧渲染题目列表 */
									const questions = results.map((result, index) => {
										/** 左侧序号 */
										const num = h(
											'span',
											{
												className: 'search-infos-num',
												innerHTML: (index + 1).toString()
											},
											(num) => {
												num.style.marginRight = '12px';
												num.style.display = 'inline-block';
												setNumStyle(result, num, index);
											}
										);

										nums.push(num);

										return h(
											'div',

											[num, result.question],
											(question) => {
												question.onmouseover = () => {
													mouseoverIndex = index;
													// 重新渲染结果列表
													resultContainer.replaceChildren(createResult(result));
												};

												question.onmouseleave = () => {
													mouseoverIndex = -1;
													// 重新显示指定序号的结果
													resultContainer.replaceChildren(createResult(results[this.cfg.currentResultIndex]));
												};

												question.onclick = () => {
													for (const n of nums) {
														n.classList.remove('active');
													}
													for (const q of questions) {
														q.classList.remove('active');
													}
													nums[index].classList.add('active');
													question.classList.add('active');
													// 更新显示序号
													this.cfg.currentResultIndex = index;
													// 重新渲染结果列表
													resultContainer.replaceChildren(createResult(result));
													// 触发页面题目元素同步器
													if (this.cfg.questionPositionSyncHandlerType) {
														state.workResult.questionPositionSyncHandler[this.cfg.questionPositionSyncHandlerType]?.(
															index
														);
													}
												};
											}
										);
									});

									list.replaceChildren(...questions);
									// 初始显示指定序号的结果
									if (mouseoverIndex === -1) {
										resultContainer.replaceChildren(createResult(results[this.cfg.currentResultIndex]));
									} else {
										resultContainer.replaceChildren(createResult(results[mouseoverIndex]));
									}

									container.replaceChildren(
										h('div', [list, h('div', {}, [resultContainer])], (div) => {
											div.style.display = 'flex';
											div.style.gap = '12px';
											div.style.width = '100%';
											div.style.boxSizing = 'border-box';
										})
									);
								}
							} else {
								container.replaceChildren(
									h('div', { className: 'alert-info-wrapper' }, [
										h('div', '暂无任何搜索结果~', (div) => {
											div.style.marginTop = '12px';
											div.className = 'result-info no-answer';
										})
									])
								);
							}

							/** 恢复高度 */
							list.scrollTo({
								top: scrollPercent * list.scrollHeight,
								behavior: 'auto'
							});

							const tip = h('div', [
								h('div', { className: 'search-infos-num' }, '1'),
								' 表示等待处理中',
								h('br'),
								h('div', { className: 'search-infos-num requested' }, '1'),
								' 表示已完成搜索 ',
								h('br'),
								h('div', { className: 'search-infos-num finish' }, '1'),
								' 表示已搜索已答题 '
							]);

							/** 添加信息 */
							container.prepend(
								h('hr'),
								h(
									'div',
									[
										$ui.space(
											[
												h('span', `已搜题: ${this.cfg.requestedCount}/${this.cfg.totalQuestionCount}`),
												h('span', `已答题: ${this.cfg.resolvedCount}/${this.cfg.totalQuestionCount}`),
												...(tokenStats.count
													? [
															h(
																'span',
																`AI Token: ${tokenStats.total} / 平均 ${tokenStats.average.toFixed(1)}/题`
															)
													  ]
													: []),
												h('a', '提示', (btn) => {
													btn.style.cursor = 'pointer';
													btn.onclick = () => {
														$modal.confirm({ content: tip, footer: undefined });
													};
												}),
												$ui.tooltip(
													h('a', '清空结果', (btn) => {
														btn.title = '用于不会自动清空搜索结果的场景，例如非整卷预览模式';
														btn.style.cursor = 'pointer';
														btn.onclick = () => {
															this.methods.clearResults();
															const { panel, header } = CXProject.scripts.work;
															if (panel && header) {
																CXProject.scripts.work.onrender?.({ panel, header });
																CommonProject.scripts.workResults.onrender?.({ panel, header });
															}
														};
													})
												)
											],
											{ separator: '|' }
										)
									],
									(div) => {
										div.style.textAlign = 'center';
										div.style.fontSize = '12px';
									}
								)
							);
						}, 100);

						/** 渲染结果列表 */
						const createResult = (result: SimplifyWorkResult | undefined) => {
							if (result) {
								let info: HTMLElement | null = null;
								const skippedReason = getSkippedReason(result);

								if (result.requested === false && result.resolved === false) {
									info = h('div', { className: 'result-info unresolved' }, '等待搜索中... 🔍');
								} else if (result.error) {
									info = h('div', { className: 'result-info error' }, '❌ ' + result.error);
								} else if (skippedReason) {
									info = h('div', { className: 'result-info no-answer' }, '已跳过：' + skippedReason);
								} else if (result.searchInfos.length === 0) {
									info = h('div', { className: 'result-info no-answer' }, '❌ 未获取到答案');
								} else {
									info = result.finish
										? null
										: result.resolved === false
										? h('div', { className: 'result-info unresolved' }, '等待顺序答题中... ⏱️')
										: h('div', { className: 'result-info error' }, '❌ 此题未完成, 可能是没有匹配的选项。');
								}

								return h('div', [
									h('div', { className: 'alert-info-wrapper' }, [info ?? h('div')]),
									createSelectedQuestionAIAnswerPanel(result),
									h(SearchInfosElement, {
										infos: result.searchInfos,
										question: result.question,
										type: result.type,
										hideResultQuestion: true
									})
								]);
							} else {
								return h('div', 'undefined');
							}
						};

						render();
						this.onConfigChange('type', render);
						this.onConfigChange('requestedCount', render);
						this.onConfigChange('resolvedCount', render);
						$store.addChangeListener(TAB_WORK_RESULTS_KEY, render);

						return container;
					}
				};
			},
			onrender({ panel }) {
				panel.body.replaceChildren(this.methods.createWorkResultsPanel());
			}
		}),
		onlineSearch: new Script({
			name: '手动搜题',
			matches: [['所有页面', /.*/]],
			namespace: 'common.online-search',
			configs: {
				notes: {
					defaultValue: '手动搜题只使用 AI。可输入题目，也可以划词后点击搜索。'
				},

				selectSearch: {
					label: '划词搜索',
					defaultValue: true,
					attrs: { type: 'checkbox', title: '使用鼠标滑动选择页面中的题目进行搜索。' }
				},
				searchValue: {
					sync: true,
					label: '搜索题目',
					tag: 'textarea',
					attrs: {
						placeholder: '输入题目，请尽量保证题目完整，不要漏字',
						style: {
							minWidth: '300px',
							minHeight: '64px'
						}
					},
					defaultValue: ''
				}
			},
			oncomplete() {
				document.addEventListener(
					'selectionchange',
					debounce(() => {
						if (this.cfg.selectSearch) {
							const val = document.getSelection()?.toString() || '';
							if (val) {
								this.cfg.searchValue = val;
							}
						}
					}, 500)
				);
			},
			onrender({ panel }) {
				const content = h('div', '', (content) => {
					content.style.marginBottom = '12px';
				});

				const search = async (value: string) => {
					if (hasAnswerProvider(CommonProject.scripts.settings.cfg) === false) {
						$modal.alert({ content: '请先在 AI设置 中配置 AI，才能进行手动搜题。' });
						return;
					}

					content.replaceChildren(h('span', '搜索中...'));

					if (value) {
						const t = Date.now();
						const infos = await CommonProject.scripts.apps.methods.searchAnswerInCaches(
							value,
							{
								type: 'unknown',
								options: ''
							}
						);
						// 耗时计算
						const resume = ((Date.now() - t) / 1000).toFixed(2);

						content.replaceChildren(
							h(
								'div',
								[
									h('hr'),
									h(
										'div',
										{ style: { color: '#a1a1a1' } },
										`搜索到 ${infos.map((i) => i.results).flat().length} 个结果，共耗时 ${resume} 秒`
									),
									h(SearchInfosElement, {
										infos: infos.map((info) => ({
											results: info.results.map(
												(res) => [res.question, res.answer, res.extra_data || {}] as [string, string, object]
											),
											homepage: info.homepage,
											name: info.name,
											response: info.response,
											data: info.data,
											error: info.error
										})),
										question: value,
										hideResultQuestion: true
									})
								],
								(div) => {
									div.classList.add('card');
									div.style.boxSizing = 'border-box';
									div.style.width = '100%';
									div.style.maxWidth = '100%';
								}
							)
						);
					} else {
						content.replaceChildren(h('span', '题目不能为空！'));
					}
				};

				const button = h('button', '搜索', (button) => {
					button.className = 'base-style-button';
					button.style.width = '120px';
					button.onclick = () => {
						search(this.cfg.searchValue);
					};
				});
				const searchContainer = h('div', { style: { textAlign: 'end' } }, [button]);

				panel.body.append(h('div', [content, searchContainer]));
			}
		}),
		/** 渲染脚本，窗口渲染主要脚本 */
		render: RenderScript,
		hack: new Script({
			name: '页面复制粘贴限制解除',
			matches: [['所有页面', /.*/]],
			hideInPanel: true,
			onactive() {
				enableCopy([document, document.body]);
			},
			oncomplete() {
				enableCopy([document, document.body]);
				insertCopyableStyle();
				setTimeout(() => {
					enableCopy([document, document.body]);
					insertCopyableStyle();
				}, 3000);
			}
		}),
		disableDialog: new Script({
			name: '禁止弹窗',
			matches: [['所有页面', /.*/]],
			hideInPanel: true,
			priority: 1,
			onstart() {
				function disableDialog(msg: string) {
					$modal.alert({
						profile: '弹窗来自：' + location.origin,
						content: msg
					});
				}

				try {
					$gm.unsafeWindow.alert = disableDialog;
					window.alert = disableDialog;
				} catch (e) {
					console.error(e);
				}
			}
		}),
		apps: new Script({
			name: '工具',
			matches: [['', /.*/]],
			namespace: 'common.apps',
			configs: {
				notes: {
					defaultValue: '这里是一些其他的应用或者拓展功能。'
				},
					/**
					 * 答案缓存
					 */
				localQuestionCaches: {
					defaultValue: [] as QuestionCache[],
					extra: {
						appConfigSync: false
					}
				}
			},
			methods() {
				return {
					/**
					 * 添加答案缓存
					 */
					addQuestionCache: async (...questionCacheItems: QuestionCache[]) => {
						const questionCaches: QuestionCache[] = this.cfg.localQuestionCaches;
						for (const item of questionCacheItems) {
							// 去重
							if (questionCaches.find((c) => c.title === item.title && c.answer === item.answer) === undefined) {
								questionCaches.unshift(item);
							}
						}

						// 限制数量
						questionCaches.splice(200);
						this.cfg.localQuestionCaches = questionCaches;
					},
					addQuestionCacheFromWorkResult(swr: SimplifyWorkResult[]) {
						CommonProject.scripts.apps.methods.addQuestionCache(
							...swr
								.map((r) =>
									r.searchInfos
										.map((i) =>
											i.results
												.filter((res) => res[1])
												.map((res) => ({
													title: r.question,
													answer: res[1],
													from: i.name.replace(/【答案缓存】/g, ''),
													homepage: i.homepage || '',
													ai: Boolean((res[2] as any)?.ai)
												}))
												.flat()
										)
										.flat()
								)
								.flat()
						);
					},
					/**
					 * 使用答案缓存进行题目搜索
					 * @param title 题目
					 * @param whenSearchEmpty 当搜索结果为空，或者答案缓存功能被关闭时执行的函数
					 */
					searchAnswerInCaches: async (
						title: string,
						optionsOrWhenSearchEmpty:
							| SearchAnswerOptions
							| { (): SearchInformation[] | Promise<SearchInformation[]> },
						whenSearchEmpty?: () => SearchInformation[] | Promise<SearchInformation[]>
					): Promise<SearchInformation[]> => {
						const searchOptions =
							typeof optionsOrWhenSearchEmpty === 'function' ? ({} as SearchAnswerOptions) : optionsOrWhenSearchEmpty;

						if (CommonProject.scripts.settings.cfg.enableQuestionCaches === false) {
							return await searchAnswer(title, searchOptions);
						}

						return await searchAnswer(title, searchOptions);
					},
				};
			},
			onrender({ panel }) {
				const btnStyle: Partial<CSSStyleDeclaration> = {
					padding: '6px 12px',
					margin: '4px',
					marginBottom: '8px',
					boxShadow: '0px 0px 4px #bebebe',
					borderRadius: '8px',
					cursor: 'pointer'
				};

				const cachesBtn = h('div', { innerText: '答案缓存', style: btnStyle }, (btn) => {
					btn.onclick = () => {
						const questionCaches = this.cfg.localQuestionCaches;

						const list = questionCaches.map((c) =>
							h(
								'div',
								{
									className: 'question-cache',
									style: {
										margin: '8px',
										border: '1px solid lightgray',
										borderRadius: '4px',
										padding: '8px'
									}
								},
								[
									h('div', { className: 'title' }, [
										$ui.tooltip(
											h(
												'span',
												{
													title: `来自：${c.from || '未知来源'}\n主页：${c.homepage || '未知主页'}`,
													style: { fontWeight: 'bold' }
												},
												c.title
											)
										)
									]),
									h('div', { className: 'answer', style: { marginTop: '6px' } }, c.answer)
								]
							)
						);

						const countEl = h('span', ['当前缓存数量：' + questionCaches.length]);

						$modal.simple({
							width: 800,
							content: h('div', [
								h('div', { className: 'notes card' }, [
									$ui.notes([
										'答案缓存会保存 AI 返回的题目和答案。重复题目可直接复用，减少接口请求。',
										'默认最多缓存 200 题，当前页面关闭后会自动清除。'
									])
								]),
								h('div', { className: 'card' }, [
									$ui.space(
										[
											countEl,
											$ui.button('清空答案缓存', {}, (btn) => {
												btn.onclick = () => {
													this.cfg.localQuestionCaches = [];
													countEl.innerText = '当前缓存数量：0';
													list.forEach((el) => el.remove());
												};
											})
										],
										{ separator: '|' }
									)
								]),

								h(
									'div',
									questionCaches.length === 0 ? [h('div', { style: { textAlign: 'center' } }, '暂无答案缓存')] : list
								)
							])
						});
					};
				});

				const exportSetting = $ui.tooltip(
					h(
						'div',
						{
							innerText: '📤 导出全部设置',
							style: btnStyle,
							title: '导出全部页面的设置，包括 AI 参数、章节学习参数等等。（文件后缀名为：.xthsetting）'
						},
						(btn) => {
							btn.onclick = () => {
								const setting = Object.create({});
								for (const key of $store.list()) {
									const val = $store.get(key);
									if (val) {
										Reflect.set(setting, key, val);
									}
								}
								const blob = new Blob([JSON.stringify(setting, null, 2)], { type: 'text/plain' });
								const url = URL.createObjectURL(blob);
								const a = h('a', { href: url, download: 'xuexitong-ai-helper-setting.xthsetting' });
								a.click();
								URL.revokeObjectURL(url);
							};
						}
					)
				);

				const importSetting = $ui.tooltip(
					h(
						'div',
						{
							innerText: '📥 导入全部设置',
							style: btnStyle,
							title: '导入并且覆盖当前的全部设置。（文件后缀名为：.xthsetting）'
						},
						(btn) => {
							btn.onclick = () => {
								const input = h('input', { type: 'file', accept: '.xthsetting' });
								input.onchange = async () => {
									const file = input.files?.[0];
									if (file) {
										const setting = await file.text();
										const obj = JSON.parse(setting);
										for (const key of Object.keys(obj)) {
											$store.set(key, obj[key]);
										}
										$message.success({ content: '设置导入成功，页面即将刷新。', duration: 3 });
										setTimeout(() => {
											location.reload();
										}, 3000);
									}
								};
								input.click();
							};
						}
					)
				);

				[cachesBtn, exportSetting, importSetting].forEach((btn) => {
					btn.onmouseover = () => {
						btn.style.boxShadow = '0px 0px 4px #0099ff9c';
					};
					btn.onmouseout = () => {
						btn.style.boxShadow = '0px 0px 4px #bebebe';
					};
				});

				const sep = (text: string) => h('div', { className: 'separator', style: { padding: '4px 0px' } }, text);

				panel.body.replaceChildren(h('div', [sep('答案数据'), cachesBtn, sep('其他功能'), exportSetting, importSetting]));
			}
		})
	}
});

function insertCopyableStyle() {
	const style = document.createElement('style');
	style.innerHTML = `
		html * {
		  -webkit-user-select: text !important;
		  -khtml-user-select: text !important;
		  -moz-user-select: text !important;
		  -ms-user-select: text !important;
		  user-select: text !important;
		}`;

	document.head.append(style);
}

const createGuide = () => {
	const aiReady = hasAnswerProvider(CommonProject.scripts.settings.cfg);
	const currentModel = CommonProject.scripts.settings.cfg.aiModel || '未选择';

	const statusText = aiReady
		? `AI 已配置，当前模型：${currentModel}`
		: '还没有配置 AI。请先填写接口地址、API Key，并获取模型。';

	const step = (title: string, desc: string) =>
		h('div', { className: 'home-step' }, [
			h('div', { className: 'home-step-title' }, title),
			h('div', { className: 'secondary' }, desc)
		]);

	const feature = (title: string, desc: string) =>
		h('div', { className: 'home-feature' }, [h('b', title), h('div', { className: 'secondary' }, desc)]);

	return h('div', { className: 'user-guide cx-ai-home' }, [
		h('div', { className: 'home-hero' }, [
			h('div', { className: 'home-title' }, '学习通AI辅助插件'),
			h('div', { className: 'home-subtitle' }, '支持章节学习、作业考试自动答题、AI答案获取和 token 统计。'),
			h('div', { className: aiReady ? 'home-status ready' : 'home-status' }, statusText)
		]),
		h('div', { className: 'home-grid' }, [
			h('div', { className: 'home-panel' }, [
				h('div', { className: 'home-panel-title' }, '使用流程'),
				step('1. 配置 AI', '填写接口地址和 API Key，点击 AI模型 获取并选择模型。'),
				step('2. 进入答题页面', '打开课程任务点、章节测试、作业或考试预览页面。'),
				step('3. 检查答题状态', '答案、AI标记、单题 token 和平均 token 会显示在答题结果中。')
			]),
			h('div', { className: 'home-panel' }, [
				h('div', { className: 'home-panel-title' }, '当前能力'),
				feature('答案来源', '仅使用 AI'),
				feature('支持题型', '单选、多选、判断、填空。多选和判断已做 AI 输出兼容。')
			])
		])
	]);
};

async function searchAnswer(
	title: string,
	searchOptions: SearchAnswerOptions
): Promise<SearchInformation[]> {
	const infos = await queryAIAnswerer(CommonProject.scripts.settings.cfg, {
		title,
		type: searchOptions.type,
		options: searchOptions.options,
		lineOptions: searchOptions.lineOptions,
		hasImage: searchOptions.hasImage,
		imageUrls: searchOptions.imageUrls
	});
	const error = infos.find((info) => info.error && isSkippedByAIConfig(info) === false)?.error;
	if (error) {
		$message.error({ content: 'AI做题请求失败：' + error, duration: 10 });
	}
	return infos;
}

function isSkippedByAIConfig(info: SearchInformation) {
	return Boolean((info.data as any)?.skipped);
}

function getSkippedReason(result: SimplifyWorkResult) {
	const skipped = result.searchInfos.find((info) => (info.data as any)?.skipped);
	return skipped?.error || '';
}

function getAITokenStats(results: SimplifyWorkResult[]) {
	let total = 0;
	let count = 0;

	for (const result of results) {
		let questionTokens = 0;
		for (const info of result.searchInfos) {
			for (const [, , extraData] of info.results) {
				const usage = (extraData as any)?.token_usage;
				const tokens = Number(usage?.total_tokens || 0);
				if (tokens > 0) {
					questionTokens += tokens;
				}
			}
		}
		if (questionTokens > 0) {
			total += questionTokens;
			count++;
		}
	}

	return {
		total,
		count,
		average: count === 0 ? 0 : total / count
	};
}

function createSelectedQuestionAIAnswerPanel(result: SimplifyWorkResult) {
	const aiInfo = result.searchInfos.find((info) => info.name.includes('AI')) || result.searchInfos[0];
	const firstResult = aiInfo?.results?.[0];
	const extra = (firstResult?.[2] || {}) as any;
	const answer = String(extra.parsed_answer || firstResult?.[1] || '');
	const rawContent = extra.raw_content ?? (aiInfo?.data as any)?.raw_content ?? extractAIContent(aiInfo?.response);
	const solution = String(extra.solution ?? (aiInfo?.data as any)?.solution ?? '').trim();
	const rawButton = aiInfo
		? createRawOutputButton('查看原始输出', () =>
				showRawAIOutput(aiInfo, {
					rawContent,
					parsedAnswer: answer || (aiInfo.data as any)?.parsed_answer || '',
					answer,
					solution,
					extraData: extra
				})
		  )
		: '';

	return h('div', { className: 'selected-ai-answer-panel' }, [
		h('div', { className: 'selected-ai-answer-row question' }, [
			h('span', { className: 'selected-ai-answer-label' }, '题目'),
			h('span', { className: 'selected-ai-answer-text' }, result.question || '无题目')
		]),
		h('div', { className: 'selected-ai-answer-row answer' }, [
			h('span', { className: 'selected-ai-answer-label' }, 'AI答案'),
			answer
				? h(
						'span',
						{ className: 'selected-ai-answer-codes' },
						answer
							.split('#')
							.filter(Boolean)
							.map((item) => h('code', item))
				  )
				: h('span', { className: 'selected-ai-answer-empty' }, aiInfo?.error || '无可解析答案'),
			rawButton
		]),
		...(solution
			? [
					h('div', { className: 'selected-ai-answer-row solution' }, [
						h('span', { className: 'selected-ai-answer-label' }, '解答过程'),
						h('pre', { className: 'selected-ai-answer-solution' }, solution)
					])
			  ]
			: [])
	]);
}

function extractAIContent(response: any) {
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
