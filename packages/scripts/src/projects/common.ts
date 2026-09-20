import { requestAnswerReview, getAnswerReviewView } from '../utils/answer-review';
import {
	acquireWebActivity,
	assertWebActivity,
	getWebActivity,
	watchWebActivity,
	webActivityMessage,
	type WebActivityLease
} from '../utils/web-activity';
import { getWebBridgeState, openDeepSeekBridge } from '../utils/web-ai';
import { closeAIConfigEmptyWarning } from '../utils/work';
import { $win } from 'easy-us/lib/utils/start';
import { QuestionAnswerCache, type QuestionCache } from '../utils/answer-cache';
import { getVisionCapability } from '../utils/vision';
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
	type AIAnswererOptions,
	fetchAIModels,
	probeVisionModel,
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
const questionCache: QuestionAnswerCache = new QuestionAnswerCache({
	get: () => CommonProject.scripts.apps.cfg.localQuestionCaches,
	set: (entries) => {
		CommonProject.scripts.apps.cfg.localQuestionCaches = entries;
	},
	enabled: () => CommonProject.scripts.settings.cfg.enableQuestionCaches !== false
});

type SearchAnswerOptions = {
	webActivityId?: string;
	providerConfig?: AIAnswererOptions;
	type?: string;
	options?: string[] | string;
	lineOptions?: AILineOptionGroup[];
	hasImage?: boolean;
	unresolvedImageCount?: number;
	imageUrls?: string[];
};

export const CommonProject = Project.create({
	name: '学习通AI辅助插件',
	domains: ['chaoxing.com'],
	scripts: {
		guide: new Script({
			name: '首页',
			matches: [['所有页面', /.*/]],
			namespace: 'common.guide',
			configs: {
				notes: {
					defaultValue: ''
				}
			},
			onrender({ panel }) {
				const guide = createGuide();
				guide.style.width = '100%';
				panel.body.replaceChildren(guide);
			}
		}),
		settings: new Script({
			name: 'AI设置',
			matches: [['所有页面', /.*/]],
			namespace: 'common.settings',
			configs: {
				notes: {
					defaultValue: '设置自动保存。模型可直接输入，也可获取列表后筛选。'
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
						title: '自动答题完成后的设置，目前仅在章节测试中生效，鼠标悬浮在选项上可以查看说明。'
					}
				},
				thread: {
					label: 'AI并发线程（个）',
					attrs: {
						type: 'number',
						min: 1,
						step: 1,
						max: 8,
						title: '作业/考试/章节测试中同时请求 AI 的题目数量。数值越大越快，也更容易触发接口限速；建议 1-3。'
					},
					defaultValue: 1
				},
				aiProvider: {
					label: 'AI 来源',
					tag: 'select',
					defaultValue: 'api' as 'api' | 'deepseek-web',
					options: [
						['api', 'API 接口', '稳定方式，支持自定义模型与图片'],
						[
							'deepseek-web',
							'DeepSeek 网页（实验）',
							'需手动启用专用已登录标签页；支持图片；题目与附件会保存在网页账号历史中'
						]
					],
					onload() {
						this.addEventListener('change', () => setTimeout(updateVisionStatus));
					}
				},
				aiWebConnectButton: {
					label: '网页连接',
					defaultValue: '打开 DeepSeek 专用标签页',
					attrs: { type: 'button', title: '请在打开的空白页登录并手动启用。不会读取或导出登录凭据，不处理验证码。' },
					onload() {
						this.value = '打开 DeepSeek 专用标签页';
						this.onclick = openDeepSeekBridge;
					}
				},
				aiApiUrl: {
					onload() {
						this.addEventListener('change', updateVisionStatus);
					},
					separator: 'AI做题',
					label: 'AI接口地址',
					attrs: {
						placeholder: 'https://api.openai.com/v1/chat/completions',
						title:
							'OpenAI 兼容接口填写 /v1 或 /chat/completions；Anthropic 兼容接口填写 /v1/messages。协议由接口地址决定。'
					},
					defaultValue: ''
				},
				aiApiKey: {
					onload() {
						this.addEventListener('change', updateVisionStatus);
					},
					label: 'AI API Key',
					attrs: {
						type: 'password',
						placeholder: 'sk-...',
						title: 'OpenAI 兼容接口使用 Bearer；Anthropic 兼容接口使用 x-api-key。'
					},
					defaultValue: ''
				},
				aiModel: {
					label: '模型',
					attrs: { placeholder: '输入模型 ID，或获取列表后筛选', type: 'text', autocomplete: 'off' },
					defaultValue: '',
					onload() {
						this.setAttribute('list', 'xth-ai-models');
						this.oninput = () => {
							CommonProject.scripts.settings.cfg.aiModel = this.value.trim();
							updateVisionStatus();
						};
					}
				},
				aiModelSuggestions: { attrs: { type: 'hidden' }, defaultValue: [] as string[] },
				aiModelSuggestionSource: { attrs: { type: 'hidden' }, defaultValue: '' },
				aiModelFetchButton: {
					label: '模型列表',
					defaultValue: '获取模型列表',
					attrs: { type: 'button', title: '可选操作。即使接口不提供模型列表，也可以直接输入模型 ID。' },
					onload() {
						this.value = '获取模型列表';
						this.onclick = async () => {
							const cfg = CommonProject.scripts.settings.cfg;
							const snapshot = { ...cfg };
							this.value = '获取中…';
							this.disabled = true;
							try {
								const models = await fetchAIModels(snapshot);
								if (snapshot.aiApiUrl !== cfg.aiApiUrl || snapshot.aiApiKey !== cfg.aiApiKey) return;
								cfg.aiModelSuggestions = models.map((model) => model.id);
								cfg.aiModelSuggestionSource = cfg.aiApiUrl.trim();
								updateVisionStatus();
								const list = CommonProject.scripts.settings.panel?.body.querySelector('datalist');
								list?.replaceChildren(
									...models.map((model) =>
										h('option', {
											value: model.id,
											label:
												model.supportsVision === true
													? '支持图片'
													: model.supportsVision === false
													? '仅文本'
													: '图片能力未知'
										})
									)
								);
								$message.info(
									models.length
										? '已获取 ' + models.length + ' 个模型，输入名称即可筛选。'
										: '接口未返回模型列表，请直接输入模型 ID。'
								);
							} catch (error) {
								$message.error(
									'模型列表获取失败，仍可手动输入：' + (error instanceof Error ? error.message : String(error))
								);
							} finally {
								this.disabled = false;
								this.value = '获取模型列表';
							}
						};
					}
				},
				aiVisionMode: {
					label: '图片能力',
					tag: 'select',
					onload() {
						this.addEventListener('change', updateVisionStatus);
					},
					defaultValue: 'auto' as 'auto' | 'support' | 'unsupported',
					options: [
						['auto', '自动检测', '仅向已确认支持图片的模型发送图片题；能力未知时先跳过，可使用随机测试图检测。'],
						['support', '强制启用', '将题干和选项图片以 base64 发送给模型。'],
						['unsupported', '仅文本', '跳过图片题，不发送缺少图片的题目。']
					]
				},
				aiVisionTestButton: {
					label: '视觉检测',
					defaultValue: '检测图片（少量计费）',
					attrs: { type: 'button', title: '发送一张随机数字测试图，会产生少量 API 费用；不会发送课程或题目内容。' },
					onload() {
						this.value = '检测图片（少量计费）';
						this.onclick = async () => {
							this.disabled = true;
							this.value = '检测中…';
							try {
								$modal.alert({
									title: '视觉检测结果',
									content: await probeVisionModel({ ...CommonProject.scripts.settings.cfg })
								});
							} catch (error) {
								$message.error(error instanceof Error ? error.message : String(error));
							} finally {
								this.disabled = false;
								this.value = '检测图片（少量计费）';
								updateVisionStatus();
							}
						};
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
						cfg.thread =
							cfg.aiProvider === 'deepseek-web'
								? 1
								: Math.max(1, Math.min(8, parseInt(String(cfg.thread || 1), 10) || 1));
						cfg.period = Math.max(1, parseInt(String(cfg.period || 1), 10) || 1);
						cfg.aiTemperature = Number(cfg.aiTemperature ?? 0);
						cfg.stopSecondWhenFinish = Math.max(0, parseInt(String(cfg.stopSecondWhenFinish || 0), 10) || 0);
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
				const list = h(
					'datalist',
					{ id: 'xth-ai-models' },
					(this.cfg.aiModelSuggestionSource === this.cfg.aiApiUrl.trim() ? this.cfg.aiModelSuggestions : []).map((id) =>
						h('option', { value: id })
					)
				);
				const cache = h(
					'button',
					{ type: 'button', className: 'base-style-button', onclick: showQuestionCacheDialog },
					'答案缓存（' + questionCache.list().length + '）'
				);
				const status = h('div', { id: 'xth-vision-status', className: 'secondary' }, visionStatusText());
				const actions = h('div', { className: 'settings-actions' }, [cache]);
				if ($gm.isInGMContext())
					actions.append(
						h(
							'button',
							{
								type: 'button',
								className: 'base-style-button',
								onclick: () => this.methods.notificationBySetting('这是一条测试通知')
							},
							'测试通知'
						)
					);
				panel.body.replaceChildren(list, status, actions);
				queueMicrotask(updateVisionStatus);
				const poll = setInterval(() => {
					if (!panel.isConnected) {
						clearInterval(poll);
						return;
					}
					updateVisionStatus();
				}, 1500);
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
													? [h('span', `AI Token: ${tokenStats.total} / 平均 ${tokenStats.average.toFixed(1)}/题`)]
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

				let searching = false;
				let activity: WebActivityLease | undefined;
				const search = async (value: string) => {
					value = value.trim();
					if (searching) return;
					if (!value) {
						content.textContent = '请输入题目后再搜索。';
						return;
					}
					if (hasAnswerProvider(CommonProject.scripts.settings.cfg) === false) {
						$modal.alert({ content: '请先在 AI设置 中配置 AI，才能进行手动搜题。' });
						return;
					}

					searching = true;
					button.disabled = true;
					button.textContent = '搜索中…';
					try {
						const config = { ...CommonProject.scripts.settings.cfg };
						if (config.aiProvider === 'deepseek-web') activity = await acquireWebActivity('search');
						content.replaceChildren(h('span', '搜索中…'));

						if (value) {
							const t = Date.now();
							const infos = await CommonProject.scripts.apps.methods.searchAnswerInCaches(value, {
								type: 'unknown',
								webActivityId: activity?.id,
								providerConfig: config,
								options: ''
							});
							// 耗时计算
							const resume = ((Date.now() - t) / 1000).toFixed(2);

							content.replaceChildren(
								h(
									'div',
									[
										h('hr'),
										h(
											'div',
											{ style: { color: 'var(--xth-muted)' } },
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
					} catch (error) {
						content.textContent = error instanceof Error ? error.message : String(error);
					} finally {
						activity?.release();
						activity = undefined;
						searching = false;
						refreshButton();
					}
				};

				const button = h('button', '搜索', (button) => {
					button.className = 'base-style-button';
					button.style.width = '120px';
					button.onclick = () => {
						search(this.cfg.searchValue);
					};
				});
				const refreshButton = () => {
					const active =
						this === CommonProject.scripts.onlineSearch &&
						CommonProject.scripts.settings.cfg.aiProvider === 'deepseek-web'
							? getWebActivity()
							: undefined;
					button.disabled = searching || Boolean(active);
					button.textContent = searching
						? '搜索中…'
						: active?.kind === 'work'
						? '自动答题中，暂不可搜索'
						: active
						? '网页搜索中…'
						: '搜索';
					button.title = active ? webActivityMessage(active) : '';
				};
				watchWebActivity(button, refreshButton);
				panel.configsContainer.querySelector('textarea')?.addEventListener('keydown', (event) => {
					if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
						event.preventDefault();
						search((event.target as HTMLTextAreaElement).value);
					}
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
					updateReviewedCache: (
						opts: AIAnswererOptions,
						question: import('../utils/ai').AIQuestionPayload,
						infos: SearchInformation[],
						previousKeys: string[]
					): void => questionCache.replaceAnswer(opts, question, infos, previousKeys),
					searchAnswerInCaches: async (
						title: string,
						optionsOrWhenSearchEmpty: SearchAnswerOptions | (() => SearchInformation[] | Promise<SearchInformation[]>),
						whenSearchEmpty?: () => SearchInformation[] | Promise<SearchInformation[]>
					): Promise<SearchInformation[]> => {
						const options = typeof optionsOrWhenSearchEmpty === 'function' ? {} : optionsOrWhenSearchEmpty;
						const fallback =
							typeof optionsOrWhenSearchEmpty === 'function' ? optionsOrWhenSearchEmpty : whenSearchEmpty;
						const { webActivityId, providerConfig, ...question } = options;
						const config = { ...(providerConfig || CommonProject.scripts.settings.cfg), webActivityId };
						if (config.aiProvider === 'deepseek-web') assertWebActivity(webActivityId);
						return questionCache.search(config, { title, ...question }, async () =>
							fallback ? await fallback() : searchAnswer(title, question, config)
						);
					}
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

				const cachesBtn = h('button', { type: 'button', onclick: showQuestionCacheDialog }, '答案缓存');

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

				panel.body.replaceChildren(
					h('div', [sep('答案数据'), cachesBtn, sep('其他功能'), exportSetting, importSetting])
				);
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

function visionStatusText() {
	if (CommonProject.scripts.settings.cfg.aiProvider === 'deepseek-web') {
		const bridge = getWebBridgeState();
		return bridge
			? bridge.supportsImages
				? '网页已连接 · 支持图片 · 串行答题 · 模型请在专用网页启用前选择 · 不提供 token 用量'
				: '专用标签页仍为旧版纯文本桥接，请刷新并重新启用后再发送图片题。'
			: '网页未连接：打开专用标签页，登录后点击“启用此标签页”。支持图片，题目与附件会进入账号历史。';
	}
	const capability = getVisionCapability(CommonProject.scripts.settings.cfg);
	if (capability.source === 'manual')
		return capability.state === 'supported' ? '图片能力：已手动启用' : '图片能力：已设置仅文本';
	if (capability.state === 'unsupported') return '图片能力：接口不支持，可更换模型或手动覆盖';
	if (capability.state === 'unknown') return '图片能力：尚未确认，含图题先跳过；请检测或手动指定';
	return (
		'图片能力：' +
		(capability.source === 'probe'
			? '图片检测通过'
			: capability.source === 'metadata'
			? '接口声明支持图片'
			: '接口已接受图片，识别能力尚未核验')
	);
}
function updateVisionStatus() {
	const settings = CommonProject.scripts.settings;
	if (hasAnswerProvider(settings.cfg)) closeAIConfigEmptyWarning();
	if (settings.cfg.aiModelSuggestionSource !== settings.cfg.aiApiUrl.trim())
		settings.panel?.body.querySelector('datalist')?.replaceChildren();
	const status = CommonProject.scripts.settings.panel?.body.querySelector('#xth-vision-status');
	if (status) status.textContent = visionStatusText();
	const web = settings.cfg.aiProvider === 'deepseek-web';
	for (const key of [
		'aiApiUrl',
		'aiApiKey',
		'aiModel',
		'aiModelFetchButton',
		'aiVisionMode',
		'aiVisionTestButton',
		'aiTemperature',
		'thread',
		'aiUseResponseFormat'
	]) {
		const input = settings.panel?.querySelector<HTMLInputElement | HTMLSelectElement>(
			'[id="common.settings.' + key + '"]'
		);
		if (input) {
			input.disabled = web;
			input.closest('config-element')?.toggleAttribute('data-web-disabled', web);
		}
	}
	const connect = settings.panel?.querySelector('[id="common.settings.aiWebConnectButton"]');
	connect?.closest('config-element')?.toggleAttribute('hidden', !web);
}

function showQuestionCacheDialog() {
	const entries = questionCache.list();
	const count = h('span', entries.length + ' / 200 题');
	const list = h(
		'div',
		{ className: 'cache-list' },
		entries.length
			? entries.map((entry) =>
					h('div', { className: 'question-cache' }, [h('div', entry.title), h('code', entry.answer)])
			  )
			: [h('div', { className: 'secondary' }, '暂无缓存')]
	);
	const clear = h('button', { type: 'button', disabled: entries.length === 0 }, '清空缓存');
	clear.onclick = () => {
		$modal.confirm({
			title: '清空答案缓存',
			content: '删除本地保存的答案？此操作不会删除 AI 设置。',
			onConfirm: () => {
				questionCache.clear();
				count.textContent = '0 / 200 题';
				clear.disabled = true;
				list.replaceChildren(h('div', { className: 'secondary' }, '暂无缓存'));
			}
		});
	};
	$modal.simple({
		title: '答案缓存',
		width: 560,
		content: h('div', [
			h('div', { className: 'settings-actions' }, [count, clear]),
			h('p', { className: 'secondary' }, '保存在本机，7 天有效；题型、选项顺序、图片或 AI 设置变化时不会复用旧答案。'),
			list
		])
	});
}

const createGuide = () => {
	const settings = CommonProject.scripts.settings;
	const ready = hasAnswerProvider(settings.cfg);
	const go = (script: Script) => {
		$win?.pin(script).catch((error) => $message.error(String(error)));
	};
	const action = (title: string, subtitle: string, script: Script) =>
		h('button', { type: 'button', className: 'home-action', onclick: () => go(script) }, [
			h('b', title),
			h('span', subtitle)
		]);
	return h('div', { className: 'user-guide cx-ai-home' }, [
		h('div', { className: 'home-hero' }, [
			h('h2', { className: 'home-title' }, ready ? '准备就绪' : '连接你的 AI'),
			h(
				'div',
				{ className: 'home-status' + (ready ? ' ready' : '') },
				ready
					? settings.cfg.aiProvider === 'deepseek-web'
						? 'DeepSeek 网页（实验）'
						: settings.cfg.aiModel
					: settings.cfg.aiProvider === 'deepseek-web'
					? '请连接 DeepSeek 专用标签页'
					: '填写接口、API Key 和模型即可开始'
			),
			h(
				'button',
				{ type: 'button', className: 'base-style-button', onclick: () => go(settings) },
				ready ? '调整 AI 设置' : '配置 AI'
			)
		]),
		h('div', { className: 'home-actions' }, [
			action('课程学习', '查看学习设置', CXProject.scripts.study),
			action('作业 / 考试', '查看答题结果', CommonProject.scripts.workResults),
			action('手动搜题', '输入或划选题目', CommonProject.scripts.onlineSearch)
		]),
		h('div', { className: 'home-footer secondary' }, [
			h('span', '外观跟随系统 · 缓存 ' + questionCache.list().length + ' 题'),
			h(
				'a',
				{ href: 'https://github.com/yxxawa/xuexitong-ai-helper', target: '_blank', rel: 'noopener noreferrer' },
				'项目主页'
			)
		]),
		h('p', { className: 'secondary' }, 'AI 答案仅供参考，请核对后提交。')
	]);
};

async function searchAnswer(
	title: string,
	searchOptions: SearchAnswerOptions,
	config: AIAnswererOptions = { ...CommonProject.scripts.settings.cfg }
): Promise<SearchInformation[]> {
	const infos = await queryAIAnswerer(config, {
		title,
		type: searchOptions.type,
		options: searchOptions.options,
		lineOptions: searchOptions.lineOptions,
		hasImage: searchOptions.hasImage,
		unresolvedImageCount: searchOptions.unresolvedImageCount,
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

function createAnswerReviewControls(id: string) {
	const button = h(
		'button',
		{
			type: 'button',
			className: 'base-style-button review-check',
			title: '重新请求 AI 检查页面上的当前答案；不会自动替换。'
		},
		'检验'
	);
	const feedback = h('div', { className: 'review-feedback', role: 'status' });
	const box = h('div', { className: 'question-review' }, [button, feedback]);
	const run = async (action: 'check' | 'accept' | 'reject', proposalId?: string) => {
		const task = requestAnswerReview(id, action, proposalId);
		render();
		await task;
		render();
	};
	button.onclick = () => {
		void run('check');
	};
	let lastView = '';
	const render = () => {
		const view = getAnswerReviewView(id),
			active = CommonProject.scripts.settings.cfg.aiProvider === 'deepseek-web' ? getWebActivity() : undefined;
		button.disabled = Boolean(view?.busy || active);
		button.textContent = view?.busy ? '处理中…' : '检验';
		const state = JSON.stringify([view, Boolean(active)]);
		if (state === lastView) return;
		lastView = state;
		feedback.replaceChildren();
		if (view?.busy) {
			feedback.textContent = '正在处理，请勿重复操作…';
			return;
		}
		if (view?.error) {
			feedback.textContent = view.error;
			return;
		}
		if (!view?.feedback) return;
		const value = view.feedback;
		feedback.append(h('span', value.message));
		if (value.status === 'different') {
			feedback.append(h('pre', { className: 'review-new-answer' }, '新答案：' + value.answer));
			const accept = h(
				'button',
				{
					type: 'button',
					className: 'base-style-button review-accept',
					title: '采用新答案，并同步网页和缓存',
					disabled: Boolean(active)
				},
				'√'
			);
			const reject = h(
				'button',
				{
					type: 'button',
					className: 'base-style-button-secondary review-reject',
					title: '放弃新答案，保持原答案'
				},
				'×'
			);
			accept.setAttribute('aria-label', '采用新答案');
			reject.setAttribute('aria-label', '保持原答案');
			accept.onclick = () => {
				void run('accept', value.proposalId);
			};
			reject.onclick = () => {
				void run('reject', value.proposalId);
			};
			feedback.append(accept, reject);
		}
	};
	watchWebActivity(box, render);
	return box;
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
		...(result.finish && result.reviewId ? [createAnswerReviewControls(result.reviewId)] : []),
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
				: h(
						'span',
						{ className: 'selected-ai-answer-empty' },
						aiInfo?.error || (result.requested ? '无可解析答案' : '等待 AI 回答…')
				  ),
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
	return (
		response?.choices?.[0]?.message?.content ||
		response?.choices?.[0]?.text ||
		response?.answer ||
		response?.data?.answer ||
		''
	);
}
