import { fillStandardAnswer, fillProgrammingAnswer } from '../utils/answer-writer';
import { programLanguage, watchProgrammingPaste, readProgrammingAnswer } from '../utils/programming';
import { answerProgrammingQuestion, runProgrammingAnswer, programmingRunWasPassed } from '../utils/programming-runner';
import { registerAnswerReview } from '../utils/answer-review';
import { questionCacheKey } from '../utils/answer-cache';
import { readPageAnswer } from '../utils/answer-input';
import { queryAIAnswerer, type AIAnswererOptions, type AIQuestionPayload } from '../utils/ai';
import type { WorkContext, CustomWork } from '@xuexitong-ai-helper/core/src/core/worker/interface';
import { acquireWebActivity, assertWebActivity } from '../utils/web-activity';
import { createWebTaskStatus, reportWebTaskStatus, watchWebTaskStatus } from '../utils/web-task';
import { fillTextAnswer, fillGroupedChoices } from '../utils/answer-input';
import { runQuestionPages } from '../utils/pagination';
import {
	inspectQuestionImages,
	questionElementText,
	questionOptionText,
	collectGroupedOptions
} from '../utils/question';
/** global Ext videojs getTeacherAjax jobs */

import { CourseWorker } from '@xuexitong-ai-helper/core/src/core/worker';
import { $ } from '@xuexitong-ai-helper/core/src/utils/common';
import { StringUtils } from '@xuexitong-ai-helper/core/src/utils/string';
import { request } from '@xuexitong-ai-helper/core/src/core/utils/request';
import { splitAnswer } from '@xuexitong-ai-helper/core/src/core/worker/utils';
import { domSearch, domSearchAll } from '@xuexitong-ai-helper/core/src/core/utils/dom';
import type { SearchInformation } from '@xuexitong-ai-helper/core/src/core/worker/search.interface';
import { $modal, h, $store, MessageElement, Project, Script, $el, $gm, $$el, $ui, cors, $message } from 'easy-us';

import { CommonProject } from './common';
import { workNotes, volume, playbackRate, dropdownStyle } from '../utils/configs';
import { aiConfigEmptyWarning, commonWork, removeRedundantWords, simplifyWorkResult } from '../utils/work';
import md5 from 'md5';
// @ts-ignore
import Typr from 'typr.js';
import { CommonWorkOptions, playMedia } from '../utils';
import {
	waitForElement, waitForMedia, assertStudyActive, studySleep, studyJobId, findStudyAttachment,
	searchStudyFrames, runStudyJobs, isStudyElementVisible, studyReaderTiming
} from '../utils/study';
import { runStudyMedia } from '../utils/study-media';
import { hasAnswerProvider } from '../utils/ai';
import {
	getQuestionType,
	resolveQuestionType,
	collectLineOptionGroups,
	lineSelectBoxes,
	cxQuestionTitles,
	fillLineAnswer
} from '../utils/cx-question';

// @ts-ignore
let top: Window = globalThis.top;

try {
	/**
	 *
	 *  将繁体字映射载入内存。
	 *  为什么不存 localStorage 和 GM_setValue
	 *  localStorage: 存在被检测风险，谁都能访问
	 *  GM_setValue: 文件太大影响I/O速度
	 */
	// @ts-ignore
	top.typrMapping = top.typrMapping || undefined;

	// @ts-ignore 任务点
	top.jobs = top.jobs || [];

	// @ts-ignore 当前视频
	top.currentMedia = top.currentMedia || undefined;

	// 加 try 是因为跨域面板无法操作
} catch {}

const state = {
	study: {
		videojs: Object.create({}),
		hacked: false,
		playbackRateWarningListenerId: 0
	},
	secretFontRecognizeTasks: new WeakMap<Document, Promise<boolean>>()
};

type VideoQuizStrategy = 'random' | 'ignore';

type Attachment = {
	/** 只有当 module 为 音视频（并且已经播放完成）时才会有这个属性 */
	isPassed: boolean | undefined;
	/** 是否为任务点（音视频播放完成后此属性不存在） */
	job: boolean | undefined;
	/** 这里注意，如果当前章节测试不是任务点，则没有 jobid 或者未空字符串 */
	jobid?: string;
	property: {
		mid: string;
		/** 任务点id，固定存在 */
		_jobid: string;
		module: 'insertbook' | 'insertdoc' | 'insertflash' | 'work' | 'insertaudio' | 'insertvideo';
		name?: string;
		author?: string;
		bookname?: string;
		publisher?: string;
		title?: string;
	};
};

type Job = {
	id: string;
	attachment: Attachment;
	func: { (): Promise<void> } | undefined;
};
export const CXProject = Project.create({
	name: '学习通',
	domains: ['chaoxing.com'],
	scripts: {
		/**
		 * 创建超星独立脚本防止污染其他脚本环境
		 */
		env: new Script({
			name: '环境准备脚本',
			matches: [['所有页面', /.*/]],
			hideInPanel: true,
			onstart() {
				/**
				 * 于 4.9.20 后更新，出现顶层套壳页面跨域 :
				 * top : zjelib.cn <body>
				 * iframe : mooc1.xxx.zjelib.cn/.../mycourse/studentstudy/...  <iframe src=....>
				 * 导致top指向zjelib跨域无法访问，所以这里尝试寻找真正的top窗口对象，只有域名中包含 /mycourse/studentstudy 才是可操作的 top
				 */
				try {
					let _self = self;
					let _try_count = 10;
					while (_self.parent !== undefined && _try_count > 0) {
						if (_self.location.href.includes('/mycourse/studentstudy')) {
							top = _self;
							console.log('[学习通AI辅助插件] top change to ' + top.location.href);
							break;
						} else {
							_try_count--;
							// @ts-ignore
							_self = _self.parent;
						}
					}
				} catch (e) {
					console.warn('[学习通AI辅助插件] fail of find top');
					console.warn(e);
					// @ts-ignore
					top = globalThis.top;
				}
			}
		}),
		guide: new Script({
			name: '使用提示',
			matches: [
				['首页', 'https://www.chaoxing.com'],
				['旧版个人首页', 'chaoxing.com/space/index'],
				['新版个人首页', 'chaoxing.com/base'],
				['学习页面', 'chaoxing.com/mycourse'],
				['新版学习页面', 'chaoxing.com/mooc2-ans/mycourse']
			],
			namespace: 'cx.guide',
			configs: {
				notes: {
					defaultValue: `请进入课程、作业或考试页面，脚本会自动运行。`
				}
			},
			oncomplete() {
				if (['mycourse/studentstudy'].some((path) => location.href.includes(path))) {
					$message.success('已进入学习页面，请等待自动运行...');
					return;
				}
			}
		}),
		study: new Script({
			name: '课程学习',
			namespace: 'cx.new.study',
			matches: [
				['任务点页面', '/knowledge/cards'],
				['阅读任务点', '/readsvr/book/mooc']
				// 旧版浏览器好像不能识别二级 iframe ， 所以不能使用 'work/doHomeWorkNew' 以及其他二级 iframe 来触发路由
			],
			configs: {
				notes: {
					defaultValue: $ui.notes([
						['任务点可能不会按页面顺序执行', '如果某个任务暂时没有动作，通常是其他任务正在处理中，请耐心等待。'],
						'闯关模式下，未完成的任务点可能会阻止章节解锁，需要先完成对应任务。',
						'不建议在凌晨时段刷课，部分学校可能会在该时段清空或回退学习进度。',
						['⚠️ 当前倍速风控较严格', '如果使用高倍速后进度被清空或回退，请改为 1-2 倍速学习。']
					]).outerHTML
				},
				playbackRate: playbackRate,
				volume: volume,
				videoQuizStrategy: {
					label: '视频内题目',
					tag: 'select',
					options: [
						['random', '尝试随机作答一次'],
						['ignore', '等待手动处理']
					],
					attrs: {
						title:
							'保留原生题目弹窗。随机策略对同一弹窗仅尝试一次；未通过或选择手动处理时，请自行作答。不会隐藏验证提示。'
					},
					defaultValue: 'random' as VideoQuizStrategy
				},
				mode: {
					label: '跳转模式',
					tag: 'select',
					options: [
						['next', '完成后跳转下一节', '完成小节后，自动点击下一节按钮'],
						['job', '完成后跳转未完成任务点', '如果未找到任务点，则会直接结束脚本运行，目前处于试验阶段。'],
						['manually', '完成后暂停，等待手动跳转', '适用于自己手动运行']
					],
					defaultValue: 'next' as 'next' | 'job' | 'manually'
				},
				restudy: {
					label: '复习模式',
					attrs: { title: '已经完成的视频继续学习，并从当前的章节往下开始学习', type: 'checkbox' },
					defaultValue: false
				},
				forceLearn: {
					label: '强制学习',
					attrs: {
						title: '视频一般分为：非任务点、任务点、和已完成任务点，当遇到“非任务点”时需要开启此选项才会进行学习',
						type: 'checkbox'
					},
					defaultValue: false
				},
				backToFirstWhenFinish: {
					label: '完成全部后重新学习',
					attrs: {
						type: 'checkbox',
						title: '当章节已经学习完成至最后一章时，跳转到第一个章节重新开始学习。'
					},
					defaultValue: false
				},
				showTextareaWhenEdit: {
					label: '编辑时显示自定义编辑框',
					attrs: {
						type: 'checkbox',
						title:
							'超星默认禁止在编辑框中复制粘贴，开启此选项可以在文本框编辑时生成一个自定义编辑框进行编辑，脚本会将内容同步到编辑框中。'
					},
					defaultValue: true
				},
				notifyWhenHasFaceRecognition: {
					label: '出现人脸识别时通知我',
					attrs: {
						type: 'checkbox'
					},
					defaultValue: true
				},
				enables: {
					...dropdownStyle,
					label: '高级设置',
					attrs: { type: 'checkbox' },
					defaultValue: false
				},
				/**
				 *
				 * 开启的任务点
				 *
				 * media : 音视频
				 * ppt : 文档和书籍翻阅
				 * test : 章节测试
				 * read : 阅读
				 * live : 直播课
				 *
				 */
				enableMedia: {
					elementClassName: 'config-details',
					showIf: 'cx.new.study.enables',
					label: '视频/音频自动播放',
					attrs: { type: 'checkbox', title: '开启：音频和视频的自动播放' },
					defaultValue: true
				},
				enablePPT: {
					elementClassName: 'config-details',
					showIf: 'cx.new.study.enables',
					label: 'PPT/书籍自动完成',
					attrs: { type: 'checkbox', title: '开启：PPT/书籍自动翻阅' },
					defaultValue: true
				},
				enableChapterTest: {
					elementClassName: 'config-details',
					showIf: 'cx.new.study.enables',
					label: '章节测试自动答题',
					attrs: { type: 'checkbox', title: '开启：章节测试自动答题' },
					defaultValue: true
				},
				enableHyperlink: {
					elementClassName: 'config-details',
					showIf: 'cx.new.study.enables',
					label: '链接任务自动完成',
					attrs: { type: 'checkbox', title: '开启：链接任务自动完成' },
					defaultValue: true
				}
			},
			onrender({ panel }) {
				if (hasAnswerProvider(CommonProject.scripts.settings.cfg) === false) {
					aiConfigEmptyWarning(10);
				}

				// 高倍速警告
				this.offConfigChange(state.study.playbackRateWarningListenerId);
				state.study.playbackRateWarningListenerId =
					this.onConfigChange('playbackRate', (playbackRate) => {
						if (playbackRate > 2) {
							$modal.alert({
								title: '⚠️高倍速警告',
								content: $ui.notes([
									'⚠️高倍速可能导致学习记录清空/回退',
									'⚠️超星后台可以看到学习时长，请谨慎设置',
									'⚠️如已清空/回退，请降低倍速至1-2倍'
								]),
								maskCloseable: false,
								confirmButtonText: '我已知晓风险'
							});
						}
					}) || 0;
			},
			// 这里不使用 oncompelete ，如果某个资源一直在加载中，就会导致 oncomplete 一直无法触发，导致脚本无法运行，所以改为 onactive 只要匹配上就会触发
			async onactive() {
				/** iframe 跨域问题， 必须在 iframe 中执行 ， 所以脱离学习脚本运行。 */
				if (/\/readsvr\/book\/mooc/.test(location.href)) {
					// 26年上半学期新阅读任务点，计时翻页，达到一定时间才能翻下一页，这里等待时间然后执行翻页完成任务。
					if (document.querySelector('#reader')) {
						// @ts-ignore
						require(['reader'], (_reader) => {
							waitForElement('.readerPager').then(() => {
								setTimeout(async () => {
									const jumper = document.querySelector<HTMLSelectElement>('#pagejump');
									if (_reader?.goPage && jumper) {
										// 等待时间
										const timing = studyReaderTiming(location.href, document.baseURI) + 3;
										console.log(timing);
										await $.sleep(timing * 1000);
										/**
											 *  1:书名页
												2:版权页
												3:前言页
												4:目录页
												5:正文275页
												7:封底页
											*/
										jumper.value = '5';
										jumper.dispatchEvent(new Event('change'));
										console.log('已跳转正文页');
										await $.sleep(timing * 1000);
										jumper.value = '7';
										jumper.dispatchEvent(new Event('change'));
										console.log('已跳转封底页');
										await $.sleep(timing * 1000);
										Array.from(document.querySelectorAll<HTMLElement>('.readerPager'))
											.filter((el) => el.style.zIndex === '101')[0]
											.click();
										console.log('阅读完成');
									}
								}, 3000);
							});
						});
					}
					// 普通阅读任务点，id 是 #ReadWeb
					else {
						console.log('正在完成书籍/PPT...');
						setTimeout(() => {
							// @ts-ignore
							// eslint-disable-next-line no-undef
							readweb.goto(epage);
						}, 5000);
					}
					return;
				}

				// 主要处理
				if (/\/knowledge\/cards/.test(location.href)) {
					const updateMediaState = () => {
						// @ts-ignore
						if (top.currentMedia) {
							// @ts-ignore 倍速设置
							top.currentMedia.playbackRate = parseFloat(this.cfg.playbackRate.toString());
							// @ts-ignore 音量设置
							top.currentMedia.volume = this.cfg.volume;
						}
					};

					this.onConfigChange('playbackRate', updateMediaState);
					this.onConfigChange('volume', updateMediaState);

					await study({
						...this.cfg,
						playbackRate: parseFloat(this.cfg.playbackRate.toString()),
						workOptions: CommonProject.scripts.settings.methods.getWorkOptions()
					});
				}
			}
		}),
		work: new Script({
			name: '作业考试',
			matches: [
				['作业页面', '/mooc2/work/dowork'],
				['考试整卷预览页面', '/mooc2/exam/preview']
			],
			namespace: 'cx.new.work',
			configs: { notes: workNotes },
			async oncomplete() {
				const isExam = /\/exam\/preview/.test(location.href);
				commonWork(this, {
					workerProvider: (opts) => workOrExam(isExam ? 'exam' : 'work', { ...opts, preview_mode: true }),
					enable_control_panel: true
				});
			}
		}),
		autoRead: new Script({
			name: '自动阅读',
			matches: [
				['阅读页面', '/ztnodedetailcontroller/visitnodedetail'],
				['课程目录', /chaoxing.com\/course\/\d+\.html/],
				['课程目录', /chaoxing.com\/mooc-ans\/course\/\d+\.html/],
				['积分课阅读课程目录', '/mooc-ans/zt/portal']
			],
			namespace: 'cx.new.auto-read',
			configs: {
				notes: {
					defaultValue: $ui.notes(['点击任意章节开始自动阅读', '阅读任务次日才会统计阅读时长']).outerHTML
				},
				restartAfterFinish: {
					label: '无限阅读',
					attrs: { type: 'checkbox', title: '阅读完成最后一章后从头第一章继续阅读' },
					defaultValue: false
				}
			},
			oncomplete() {
				// 置顶
				CommonProject.scripts.render.methods.pin(this);
				$message.info('请手动点击任意章节开始自动阅读');

				// 自动进入章节功能，如果不是阅读页面则自动进入
				if (location.href.includes('/ztnodedetailcontroller/visitnodedetail') === false) {
					startAtFirst();
					return;
				}

				let top = 0;
				const interval = setInterval(() => {
					top += (document.documentElement.scrollHeight - window.innerHeight) / 60;
					window.scrollTo({
						behavior: 'smooth',
						top: top
					});
				}, 1000);

				setTimeout(() => {
					clearInterval(interval);
					// 下一页
					const next = $el('.nodeItem.r i');
					if (next) {
						next.click();
					} else {
						if (this.cfg.restartAfterFinish) {
							setTimeout(() => startAtFirst(), 3000);
							$message.info({ content: '即将重新从头开始阅读', duration: 10 });
							console.log('即将重新从头开始阅读');
						} else {
							$message.success({ content: '阅读任务已完成', duration: 0 });
							console.log('未检测到下一页');
						}
					}
				}, (60 + 3) * 1000);

				// 点击第一个章节
				function startAtFirst() {
					const texts = $$el('.course_section .chapterText');
					if (texts.length) {
						texts[0].click();
					}
				}
			}
		}),
		/**
		 * 有时候进入课程会默认在，任务页面，会出现任务为空，部分用户会以为没有章节任务，所以添加此脚本
		 */
		pageRedirect: new Script({
			name: '章节切换',
			matches: [['课程任务页面', 'pageHeader=0']],
			hideInPanel: true,
			async oncomplete() {
				if (top === window) {
					const a = document.querySelector<HTMLElement>('a[title="章节"]');
					if (a) {
						await $.sleep(1000);
						// 跳转到最新版本的超星
						a.click();
						$message.info({
							content: '已经为您自动切换到章节列表页面，手动进入任意章节即可开始自动学习！'
						});
					}
				}
			}
		}),
		versionRedirect: new Script({
			name: '版本切换',
			matches: [
				['', 'mooc2=0'],
				['', 'mycourse/studentcourse'],
				['', 'work/getAllWork'],
				['', 'work/doHomeWorkNew'],
				['', 'exam/test\\?'],
				['', 'mooc-ans/mycourse/studentstudy']
			],
			hideInPanel: true,
			async oncomplete() {
				if (top === window) {
					$message.warn({
						content: '当前页面版本不支持，即将切换到新版页面。如有其他第三方插件，请关闭后再使用。',
						duration: 0
					});
					// 跳转到最新版本的超星
					await $.sleep(2000);

					// 检测是否有人脸识别
					await waitForFaceRecognition();

					const experience = document.querySelector('.experience') as HTMLElement;
					if (experience) {
						experience.click();
					} else {
						const newUrl = new URL(window.location.href);
						if (window.location.href.includes('mooc-ans/mycourse/studentstudy')) {
							newUrl.pathname = '/mycourse/studentstudy';
						}
						const params = newUrl.searchParams;
						let changed = false;
						if (params.get('mooc2') !== '1') {
							params.set('mooc2', '1');
							changed = true;
						}

						// 兼容考试切换
						if (params.get('newMooc') !== 'true') {
							params.set('newMooc', 'true');
							changed = true;
						}
						if (changed) window.location.replace(newUrl);
					}
				}
			}
		}),
		examRedirect: new Script({
			name: '考试预览',
			matches: [
				['新版考试页面', 'exam-ans/exam/test/reVersionTestStartNew'],
				// 2023/9月 新增
				['新版考试页面2', 'mooc-ans/exam/test/reVersionTestStartNew']
			],
			hideInPanel: true,
			oncomplete() {
				if ($gm.unsafeWindow.document.querySelector('.mark_info')?.textContent?.includes('不允许整卷预览')) {
					$message.warn({
						content: $ui.notes([
							'由于当前考试禁止整卷预览，各题为独立新页面，只能一个个答题',
							'在考完前禁止手动切换题目，否则会导致重复答题！',
							'完成后或者开考前请手动删除搜索结果！',
							'想加快速度请更改 AI设置-高级设置-搜题间隔，设置为 1-3 秒即可。'
						]),
						duration: 0
					});
					const isExam = /\/exam\/test/.test(location.href);
					const workOptions = CommonProject.scripts.settings.methods.getWorkOptions();
					commonWork(CXProject.scripts.work, {
						// 因为超星是每个题目一个页面，这里加快开始速度，避免等待，默认5秒，这里加快为默认3秒间隔
						start_delay_seconds: workOptions.period,
						enable_control_panel: true,
						workerProvider: (opts) => workOrExam(isExam ? 'exam' : 'work', { ...opts, preview_mode: false })
					});
					return;
				}
				$message.info({ content: '即将跳转到整卷预览页面进行考试。' });
				setTimeout(() => $gm.unsafeWindow.topreview(), 3000);
			}
		}),
		rateHack: new Script({
			name: '倍速限制处理',
			hideInPanel: true,
			matches: [['', '/ananas/modules/video/']],
			onstart() {
				rateHack();
			}
		}),
		copyHack: new Script({
			name: '复制粘贴限制处理',
			hideInPanel: true,
			matches: [['所有页面', /.*/]],
			methods() {
				return {
					/** 解除输入框无法复制粘贴 */
					hackEditorPaste() {
						try {
							const instants = $gm.unsafeWindow?.UE?.instants || [];
							for (const key in instants) {
								const ue = instants[key];

								/**
								 * 新建一个文本框给用户编辑，然后同步到超星编辑器，防止http下浏览器无法读取剪贴板
								 */

								// eslint-disable-next-line no-proto
								if (ue?.textarea) {
									ue.body.addEventListener('click', async () => {
										// http 下无法读取剪贴板，通过弹窗让用户输入然后同步到编辑器
										if (CXProject.scripts.study.cfg.showTextareaWhenEdit) {
											const defaultText = h('span', { innerHTML: ue.textarea.value }).textContent;
											$modal.prompt({
												content:
													'请在此文本框进行编辑，防止超星无法复制粘贴。(如需关闭请前往设置: 课程学习-编辑时显示自定义编辑框)',
												width: 800,
												inputDefaultValue: defaultText || '',
												modalInputType: 'textarea',
												onConfirm: (val = '') => {
													ue.setContent(
														val
															.split('\n')
															.map((line) => `<p>${line}</p>`)
															.join('')
													);
												}
											});
										}
									});

									if ($gm.unsafeWindow.editorPaste) {
										ue.removeListener('beforepaste', $gm.unsafeWindow.editorPaste);
									}
									if ($gm.unsafeWindow.myEditor_paste) {
										ue.removeListener('beforepaste', $gm.unsafeWindow.myEditor_paste);
									}
								}
							}
						} catch {}
					}
				};
			},
			oncomplete() {
				watchProgrammingPaste(document, $gm.unsafeWindow);
				const hackInterval = setInterval(() => {
					if (typeof $gm.unsafeWindow.UE !== 'undefined') {
						clearInterval(hackInterval);
						this.methods.hackEditorPaste();
						console.log('已解除输入框无法复制粘贴限制');
					}
				}, 500);
			}
		}),
		studyDispatcher: new Script({
			name: '学习调度',
			matches: [['课程学习页面', '/mycourse/studentstudy']],
			namespace: 'cx.new.study-dispatcher',
			hideInPanel: true,
			async oncomplete() {
				// 开始任务切换
				const restudy = CXProject.scripts.study.cfg.restudy;

				CommonProject.scripts.render.methods.pin(CXProject.scripts.study);

				let chapters = await CXAnalyses.waitForChapterInfos();

				if (!restudy) {
					// 如果不是复习模式，则寻找需要运行的任务
					const params = new URLSearchParams(window.location.href);
					const mooc = params.get('mooc2');
					/** 切换新版 */
					if (mooc === null) {
						params.set('mooc2', '1');
						window.location.replace(decodeURIComponent(params.toString()));
						return;
					}

					// 过滤掉已完成的章节
					chapters = chapters.filter((chapter) => chapter.unFinishCount !== 0);

					if (chapters.length === 0) {
						$message.warn({ content: '页面任务点数量为空! 请刷新重试!' });
					} else {
						const params = new URLSearchParams(window.location.href);
						const courseId = params.get('courseId');
						const classId = params.get('clazzid');
						setTimeout(() => {
							//  进入需要进行的章节，并且当前章节未被选中
							if ($$el(`.posCatalog_active[id="cur${chapters[0].chapterId}"]`).length === 0) {
								$gm.unsafeWindow.getTeacherAjax(courseId, classId, chapters[0].chapterId);
								// 自动滚动
								setTimeout(() => {
									CXAnalyses.scrollToActiveChapter();
								}, 1000);
							}
						}, 1000);
					}
				} else {
					// 自动滚动
					setTimeout(() => {
						CXAnalyses.scrollToActiveChapter();
					}, 1000);
				}
			}
		}),
		cxSecretFontRecognize: new Script({
			name: '繁体字识别',
			hideInPanel: true,
			matches: [
				['题目页面', 'work/doHomeWorkNew'],
				['考试整卷预览', '/mooc2/exam/preview'],
				['作业', '/mooc2/work/dowork']
			],
			async oncomplete() {
				await mappingRecognize();
			}
		}),
		// 积分课提示
		jfkGuide: new Script({
			name: '积分课提示',
			matches: [['积分课页面', '/plaza']],
			namespace: 'cx.jfk.guide',
			configs: {
				notes: {
					defaultValue: $ui.notes([
						'积分课请进入课程后，开启复习模式，并且关闭自动下一章',
						'课程完成后请手动切换，如果由脚本进行自动跳转会出现乱跳转的可能。'
					]).outerHTML
				}
			},
			oncomplete(...args) {
				CommonProject.scripts.render.methods.pin(this);
			}
		})
	}
});

type CXTitleTransform = (titles: (HTMLElement | undefined)[], imageUrls?: string[]) => string;
function describeCXQuestion(ctx: WorkContext<any>, titleTransform: CXTitleTransform): AIQuestionPayload {
	const images = inspectQuestionImages([ctx.root]),
		elements = ctx.elements as Record<string, HTMLElement[]>;
	const title = titleTransform(elements.title || [], images.imageUrls);
	const type =
		resolveQuestionType(
			elements,
			ctx,
			(elements.title || []).map((el: HTMLElement) => el?.textContent || '').join(' ')
		) || 'unknown';
	if (['single', 'multiple', 'judgement', 'completion', 'programming'].includes(type)) ctx.type = type as typeof ctx.type;
	const options =
		type === 'completion' || type === 'programming'
			? []
			: (elements.options || []).map((option: HTMLElement) =>
					questionOptionText(option, elements.options, images.imageUrls)
			  );
	const lineOptions =
		type === 'line'
			? collectLineOptionGroups(ctx.root, images.imageUrls)
			: type === 'reader' || type === 'fill'
			? collectGroupedOptions(
					type === 'reader' ? elements.reading || [] : elements.filling || [],
					'span.saveSingleSelect[data]',
					images.imageUrls
			  )
			: undefined;
	const language = type === 'programming' ? programLanguage(ctx.root) : '';
	return { title: language ? title + '\n编程语言：' + language : title, type, options, lineOptions, ...images };
}
function searchCXQuestion(
	ctx: WorkContext<any>,
	transform: CXTitleTransform,
	providerConfig: AIAnswererOptions,
	webActivityId?: string,
	forceProgrammingAnswer = false
) {
	const question = describeCXQuestion(ctx, transform);
	if (!question.title) throw new Error('题目为空，请等待页面加载后重试。');
	if (question.type === 'unknown')
		return [
			{
				name: 'AI做题',
				results: [],
				error: '无法识别本题题型，未发送请求；请手动核对。',
				data: { skipped: true, reason: 'unknown_question_type' }
			}
		];
	if (
		question.type === 'line' &&
		(!question.lineOptions?.length || question.lineOptions.some((group) => !group.options.length))
	)
		return [
			{
				name: 'AI做题',
				results: [],
				error: '已识别连线题，但未能完整读取匹配选项；未发送残缺题目，请等待页面加载后重试。',
				data: { skipped: true, reason: 'incomplete_line_options' }
			}
		];
	if (question.type === 'programming' && !forceProgrammingAnswer) {
		const answer = readProgrammingAnswer(ctx.root, $gm.unsafeWindow);
		if (answer) return [{ name: '页面已有代码（待运行验证）', data: { existing_program: true }, results: [{ question: question.title, answer }] }];
	}
	const { title, ...details } = question;
	return CommonProject.scripts.apps.methods.searchAnswerInCaches(title, {
		...details,
		providerConfig,
		webActivityId,
		control: { isCancelled: ctx.isCancelled, isPaused: ctx.isPaused, waitUntilReady: ctx.waitUntilReady }
	});
}
/** Run/correct against the original question; correction requests never pass through the answer cache. */
async function answerCXProgrammingQuestion(
	ctx: WorkContext<any>,
	transform: CXTitleTransform,
	providerConfig: AIAnswererOptions,
	webActivityId?: string
) {
	const question = describeCXQuestion(ctx, transform);
	const config = { ...providerConfig, webActivityId };
	const assertCurrent = () => {
		if (!ctx.root.isConnected || JSON.stringify(describeCXQuestion(ctx, transform)) !== JSON.stringify(question))
			throw new Error('程序题题目或编程语言已变化，已停止自动纠错。');
	};
	return answerProgrammingQuestion(ctx, {
		question,
		pageWindow: $gm.unsafeWindow,
		correct(payload) {
			assertCurrent();
			if (config.aiProvider === 'deepseek-web') assertWebActivity(webActivityId);
			return queryAIAnswerer(config, payload, ctx);
		},
		onPassed(infos) {
			assertCurrent();
			CommonProject.scripts.apps.methods.updateReviewedCache(config, question, infos, []);
		},
		onFailed() { CommonProject.scripts.apps.methods.removeFailedProgramCache(config, question); },
		onProgress(message, state) {
			let note = ctx.root.querySelector<HTMLElement>('.xth-programming-run-note');
			if (!note) {
				note = ctx.root.ownerDocument.createElement('p');
				note.className = 'xth-programming-run-note';
				(ctx.root.querySelector('.proceduralQue') || ctx.root).append(note);
			}
			note.textContent = message;
			note.dataset.state = state;
		}
	});
}
/** Register against the actual live root, including chapter roots owned by a nested frame. */
function prepareCXQuestion(
	ctx: WorkContext<any>,
	worker: CourseWorker<any>,
	transform: CXTitleTransform,
	config: AIAnswererOptions
) {
	const initial = describeCXQuestion(ctx, transform);
	const initialKey = questionCacheKey(config, initial);
	const snapshot = () => {
		const question = describeCXQuestion(ctx, transform);
		return {
			question,
			answer:
				readPageAnswer(question.type, (ctx.elements.options || []).filter(Boolean) as HTMLElement[], ctx.root, $gm.unsafeWindow) || ''
		};
	};
	ctx.reviewId = registerAnswerReview(ctx.root, {
		available() {
			if (
				!ctx.root.isConnected ||
				(ctx.elements.title || []).some((el) => el && !ctx.root.contains(el)) ||
				JSON.stringify(describeCXQuestion(ctx, transform)) !== JSON.stringify(initial)
			)
				throw new Error('原题页面已切换或题目发生变化，请重新读取后检验。');
			if (worker.isRunning) throw new Error('请等待自动答题结束后再检验，暂停中的任务也需要先结束。');
		},
		snapshot,
		options: () => ({ ...CommonProject.scripts.settings.cfg }),
		async apply(infos, control) {
			if (typeof worker.opts.work !== 'function') throw new Error('此题暂不支持自动替换答案。');
			const applyCtx: WorkContext<any> = {
				...ctx,
				searchInfos: infos,
				isCancelled: () => !ctx.root.isConnected || Boolean(control?.isCancelled?.()),
				waitUntilReady: undefined,
				isPaused: undefined
			};
			// A review accepts the proposed answer; validate that exact proposal before committing it.
			if (initial.type === 'programming') {
				const filled = await fillProgrammingAnswer(applyCtx, $gm.unsafeWindow);
				if (!filled.finish) return false;
				return (await runProgrammingAnswer(ctx.root, readProgrammingAnswer(ctx.root, $gm.unsafeWindow)!, applyCtx, $gm.unsafeWindow)).passed;
			}
			const result = await (worker.opts.work as CustomWork<any>)(applyCtx);
			return result.finish;
		},
		async commit(opts, question, infos) {
			const rows = (await CommonProject.scripts.workResults.methods.getResults()) || [];
			const index = rows.findIndex((row) => row.reviewId === ctx.reviewId);
			if (index < 0) throw new Error('原答题结果已被清空，请重新读取题目。');
			ctx.searchInfos = infos;
			rows[index] = simplifyWorkResult(
				[{ requested: true, resolved: true, result: { finish: true }, ctx }],
				() => question.title
			)[0];
			CommonProject.scripts.apps.methods.updateReviewedCache(opts, question, infos, [initialKey]);
			await CommonProject.scripts.workResults.methods.setResults(rows);
			CommonProject.scripts.workResults.methods.updateWorkStateByResults(rows);
		}
	});
	const existing = snapshot();
	return existing.answer && (initial.type !== 'programming' || programmingRunWasPassed(ctx.root, existing.answer))
		? { title: existing.question.title, answer: existing.answer } : undefined;
}

function workOrExam(
	type: 'work' | 'exam' = 'work',
	{
		thread,
		period,
		redundanceWordsText,
		answerSeparators,
		answerMatchMode,
		preview_mode,
		questionIndexes,
		appendOnly,
		forceAnswer,
		webActivityId,
		...providerConfig
	}: CommonWorkOptions & {
		// 整卷预览模式
		preview_mode: boolean;
	}
) {
	$message.info(`开始${type === 'work' ? '作业' : '考试'}`);

	if (preview_mode && appendOnly !== true) {
		CommonProject.scripts.workResults.methods.init({
			questionPositionSyncHandlerType: 'cx'
		});
	}

	// 处理作业和考试题目的方法
	const workOrExamQuestionTitleTransform = (
		titles: (HTMLElement | undefined)[],
		imageUrls = inspectQuestionImages(titles).imageUrls
	) => {
		const title = titles
			.map((element) => (element ? questionElementText(element, imageUrls) : ''))
			.join(' ')
			.replace(/^\s*\d+[.、．]\s*/, '')
			.replace(
				/^[（(【](?:单选题|多选题|判断题|填空题|连线题|匹配题|简答题|名词解释|阅读理解|完形填空)[^）)】]*[）)】]\s*/,
				''
			);
		return removeRedundantWords(title, redundanceWordsText.split('\n')).trim();
	};

	let pageResultsBefore: import('@xuexitong-ai-helper/core/src/core/worker/interface').SimplifyWorkResult[] = [];
	/** 新建答题器 */
	const worker = new CourseWorker({
		forceAnswer,
		root: '.questionLi',
		elements: {
			title: (root) => cxQuestionTitles(root, 'h3'),
			options: '.answerBg .answer_p, .textDIV, .eidtDiv',
			type: type === 'exam' ? 'input[name^="type"]' : 'input[id^="answertype"]',
			lineSelectBox: (root) => lineSelectBoxes(root),
			/** 阅读理解 */
			reading: '.reading_answer',
			/** 完形填空 */
			filling: '.filling_answer'
		},
		thread: thread ?? 1,
		requestPeriod: Math.max(0, Number(period || 0) * 1000),
		answerSeparators: answerSeparators.split(',').map((s) => s.trim()),
		answerMatchMode: answerMatchMode,
		async onElementSearched(elements, root) {
			await recognizeSecretFontForQuestion(root);
		},
		/** 默认搜题方法构造器 */
		answerer: (_elements, ctx) =>
			searchCXQuestion(ctx, workOrExamQuestionTitleTransform, providerConfig, webActivityId, Boolean(forceAnswer)),

		work: async (ctx) => {
			const { elements, searchInfos } = ctx;
			const type = resolveQuestionType(elements, ctx, elements.title.map((el) => el?.textContent || '').join(' '));

			if (type === 'programming') return answerCXProgrammingQuestion(ctx, workOrExamQuestionTitleTransform, providerConfig, webActivityId);
			if (type && (type === 'completion' || type === 'multiple' || type === 'judgement' || type === 'single')) {
				return fillStandardAnswer(ctx, type, () => $.sleep(500));
			}
			// 连线题自定义处理
			else if (type && type === 'line') {
				for (const info of searchInfos) {
					for (const result of info.results) {
						const filled = await fillLineAnswer(
							result.answer,
							ctx.root,
							() => $.sleep(200),
							ctx.isCancelled,
							ctx.waitUntilReady
						);
						if (filled.finish) return filled;
					}
				}
				return { finish: false };
			}
			// 完形填空
			else if (type && type === 'fill') {
				return readerAndFillHandle(searchInfos, elements.filling, ctx.isCancelled, ctx.waitUntilReady);
			}
			// 阅读理解
			else if (type && type === 'reader') {
				return readerAndFillHandle(searchInfos, elements.reading, ctx.isCancelled, ctx.waitUntilReady);
			}

			return { finish: false };
		},

		/** 完成答题后 */
		async onResultsUpdate(current, currentIndex, res) {
			const simplified = simplifyWorkResult(res, (titles) => workOrExamQuestionTitleTransform(titles));
			if (!preview_mode) {
				const combined = [...pageResultsBefore, ...simplified];
				await CommonProject.scripts.workResults.methods.setResults(combined);
				CommonProject.scripts.workResults.methods.updateWorkStateByResults(combined);
			} else if (appendOnly && questionIndexes?.length) {
				const existed = (await CommonProject.scripts.workResults.methods.getResults()) || [];
				simplified.forEach((result, index) => {
					existed[questionIndexes[index] ?? index] = result;
				});
				CommonProject.scripts.workResults.methods.setResults(existed);
				CommonProject.scripts.workResults.methods.updateWorkStateByResults(existed);
			} else {
				CommonProject.scripts.workResults.methods.setResults(simplified);
				CommonProject.scripts.workResults.methods.updateWorkStateByResults(res);
			}
		}
	});

	worker.opts.readAnswer = (ctx) => prepareCXQuestion(ctx, worker, workOrExamQuestionTitleTransform, providerConfig);

	const run = async () => {
		try {
			if (preview_mode) {
				const results = await worker.doWork({ questionIndexes });
				if (results.length && results.every((result) => result.result?.preAnswered))
					$message.success('全部题目已答完，已跳过，无需重复请求 AI。');
			} else {
				await runQuestionPages({
					closed: () => worker.isClose,
					beforeNavigate: () => worker.waitUntilReady(),
					identity: () =>
						Array.from(document.querySelectorAll<HTMLElement>('.questionLi'))
							.map((root) =>
								JSON.stringify([
									root.id,
									root.querySelector('h3')?.textContent,
									Array.from(root.querySelectorAll<HTMLInputElement>('input[type="hidden"]'))
										.filter((input) => /questionid|answertype|^type/i.test(input.name || input.id))
										.map((input) => [input.name, input.id, input.value]),
									Array.from(root.querySelectorAll('img')).map((img) => img.getAttribute('src'))
								])
							)
							.join('|'),
					answer: async () => {
						pageResultsBefore = (await CommonProject.scripts.workResults.methods.getResults()) || [];
						await worker.doWork();
					},
					next: () => document.querySelector<HTMLElement>('[onclick="getTheNextQuestion(1)"]'),
					wait: (ms) => $.sleep(ms)
				});
				CommonProject.scripts.workResults.cfg.questionPositionSyncHandlerType = 'cx';
			}
			if (!worker.isClose) $message.info({ content: '作业/考试完成，请自行检查后保存或提交。', duration: 0 });
		} catch (error) {
			if (!worker.isClose)
				$message.error('答题程序发生错误：' + (error instanceof Error ? error.message : String(error)));
		} finally {
			worker.emit('done');
		}
	};
	void run();

	return worker;
}

/**
 * 繁体字识别-字典匹配
 * @see 参考 https://bbs.tampermonkey.net.cn/thread-2303-1-1.html
 */
async function mappingRecognize(doc: Document = document) {
	let typrMapping = Object.create({});
	try {
		const topWindow = top as any;
		topWindow.typrMapping =
			topWindow.typrMapping && Object.keys(topWindow.typrMapping).length > 0
				? topWindow.typrMapping
				: await loadTyprMapping();
		typrMapping = topWindow.typrMapping;
	} catch {
		// 超星考试可能嵌套其他平台中，所以会存在跨域，这里需要处理一下跨域情况，如果是跨域直接在当前页面加载字库
		typrMapping = await loadTyprMapping();
	}

	const base64ToUint8Array = (base64: string) => {
		const data = window.atob(base64);
		const buffer = new Uint8Array(data.length);
		for (let i = 0; i < data.length; ++i) {
			buffer[i] = data.charCodeAt(i);
		}
		return buffer;
	};

	const extractBase64Fonts = (styleText: string) => {
		const fonts: string[] = [];
		const regexp = /base64\s*,\s*([A-Za-z0-9+/=\s]+)/g;
		let matched: RegExpExecArray | null;
		while ((matched = regexp.exec(styleText)) !== null) {
			const font = matched[1].replace(/\s/g, '');
			if (font) {
				fonts.push(font);
			}
		}
		return fonts;
	};

	const normalizeMappedCode = (value: unknown) => {
		const code = Number(value);
		return Number.isFinite(code) && code > 0 ? String.fromCodePoint(code) : '';
	};

	const fontMap = typrMapping;
	const secretFonts = CXAnalyses.getSecretFont(doc);
	if (secretFonts.length === 0 || Object.keys(fontMap).length === 0) {
		return false;
	}

	/** 判断是否有繁体字 */
	const fontFaceEls = Array.from(doc.querySelectorAll('style')).filter((style) =>
		style.textContent?.includes('font-cxsecret')
	);
	const base64Fonts = fontFaceEls.flatMap((style) => extractBase64Fonts(style.textContent || ''));

	if (base64Fonts.length === 0) {
		console.log('未检测到学习通加密字体。');
		return false;
	}

	console.log('正在识别学习通加密字体');

	const encryptedChars = Array.from(
		new Set(
			Array.from(secretFonts.map((el) => el.textContent || '').join('')).filter((char) => {
				const code = char.codePointAt(0) || 0;
				return code > 127 && !/\s/.test(char);
			})
		)
	);

	const match: Record<string, string> = {};
	for (const font of base64Fonts) {
		try {
			const code = Typr.parse(base64ToUint8Array(font));
			for (const word of encryptedChars) {
				if (match[word]) {
					continue;
				}
				const codePoint = word.codePointAt(0);
				if (!codePoint) {
					continue;
				}
				const Glyph = Typr.U.codeToGlyph(code, codePoint);
				if (!Glyph) continue;
				const path = Typr.U.glyphToPath(code, Glyph);
				const hex = md5(JSON.stringify(path)).slice(24); // 8位即可区分
				const value = normalizeMappedCode(fontMap[hex]);
				if (value && word !== value) {
					match[word] = value;
				}
			}
		} catch (err) {
			console.warn('解析学习通加密字体失败，继续尝试其他字体：', String(err));
		}
	}

	const mappedChars = Object.keys(match);
	if (mappedChars.length === 0) {
		console.warn('未能匹配学习通加密字体字形，题目可能仍会显示异常字符。');
		return false;
	}

	// 替换加密字体
	secretFonts.forEach((el) => {
		let html = el.innerHTML;
		for (const word of mappedChars) {
			html = html.split(word).join(match[word]);
		}

		el.innerHTML = html;
		el.classList.remove('font-cxsecret'); // 移除字体加密
	});

	console.log(`学习通加密字体识别完成，已还原 ${mappedChars.length}/${encryptedChars.length} 个字符。`);
	return secretFonts.length > 0;
}

async function recognizeSecretFontForQuestion(root: HTMLElement) {
	const doc = root.ownerDocument || document;
	if (!CXAnalyses.getSecretFont(doc).length) {
		return false;
	}

	try {
		const running = state.secretFontRecognizeTasks.get(doc);
		if (running) {
			return await running;
		}

		const task = mappingRecognize(doc);
		state.secretFontRecognizeTasks.set(doc, task);
		return await task;
	} catch (err) {
		console.error('题目字体识别失败，将使用页面原始文本传给 AI：', String(err));
		return false;
	} finally {
		state.secretFontRecognizeTasks.delete(doc);
	}
}

async function loadTyprMapping() {
	const urls = [
		'https://cdn.xuexitong-ai-helper.com/resources/font/table.json',
		'https://cdn.ocsjs.com/resources/font/table.json'
	];
	for (const url of urls) {
		try {
			console.log('正在加载繁体字库。');
			const mapping = await request(url, {
				type: 'GM_xmlhttpRequest',
				method: 'get',
				responseType: 'json'
			});
			if (mapping && Object.keys(mapping).length > 0) {
				return mapping;
			}
		} catch (err) {
			console.warn(`学习通加密字体库加载失败，准备尝试下一个源：${url}`, String(err));
		}
	}
	console.error('学习通加密字体库加载失败，请刷新页面重试。');
	return {};
}

/**
 * cx分析工具
 */
const CXAnalyses = {
	/** 是否处于闯关模式或者解锁模式 */
	isInSpecialMode() {
		return Array.from(top?.document.querySelectorAll('.catalog_points_sa,.catalog_points_er') || []).length !== 0;
	},
	/** 是否为闯关模式，并且当前章节卡在最后一个待完成的任务点 */
	async isStuckInBreakingMode() {
		if (this.isInSpecialMode()) {
			const chapter = top?.document.querySelector<HTMLElement>('.posCatalog_active');
			if (chapter) {
				const id = chapter.getAttribute('id');
				if (id) {
					// 超星好像会重绘组件，导致无法绑定属性到元素中，所以这里使用页面全局变量存储
					const counter = (await $store.getTab('chapter_counter')) || Object.create({});
					let count = Reflect.get(counter, id);
					count = count ? count + 1 : 1;
					Reflect.set(counter, id, count);

					let res = false;
					if (count >= 3) {
						Reflect.set(counter, id, 1);
						res = true;
					}
					await $store.setTab('chapter_counter', counter);
					return res;
				}
			}
		}
		return false;
	},
	/**
	 * 是否处于最后一小节
	 * 当小节为0，返回 true
	 */
	isInFinalTab() {
		// 上方小节任务栏
		const tabs = Array.from<HTMLElement>(top?.document.querySelectorAll('.prev_ul li') || []);
		if (tabs.length === 0) {
			return true;
		}
		return tabs[tabs.length - 1].classList.contains('active');
	},
	/** 是否处于最后一个章节 */
	isInFinalChapter() {
		return Array.from(top?.document.querySelectorAll('.posCatalog_select') || [])
			.pop()
			?.classList.contains('posCatalog_active');
	},
	/** 是否完成全部章节 */
	isFinishedAllChapters() {
		const chapters = this.getChapterInfos();
		return chapters.length > 0 && chapters.every((chapter) => chapter.unFinishCount === 0);
	},
	/** 获取所有章节信息 */
	getChapterInfos() {
		return Array.from(top?.document.querySelectorAll('[onclick^="getTeacherAjax"]') || []).map((el) => ({
			element: el as HTMLElement,
			chapterId: el.getAttribute('onclick')?.match(/\('(.*)','(.*)','(.*)'\)/)?.[3],
			// @ts-ignore
			unFinishCount: parseInt(el.parentElement.querySelector('.jobUnfinishCount')?.value || '0')
		}));
	},
	scrollToActiveChapter() {
		const activeChapter = top?.document.querySelector<HTMLElement>('.posCatalog_active');
		if (activeChapter) {
			activeChapter.scrollIntoView({ behavior: 'smooth', block: 'center' });
		}
	},
	/**
	 * 等待并获取章节信息，直到获取到章节信息为止
	 * - 可设置超时时间（单位秒），默认10秒
	 * - 超时后返回空数组
	 */
	waitForChapterInfos(timeout = 10) {
		return new Promise<any[]>((resolve, reject) => {
			const interval = setInterval(() => {
				const res = this.getChapterInfos();
				if (res.length > 0) {
					clearInterval(interval);
					clearInterval(to);
					resolve(res);
				}
			}, 1000);

			const to = setTimeout(() => {
				clearInterval(interval);
				resolve([]);
			}, timeout * 1000);
		});
	},
	/** 检测页面是否使用字体加密 */
	getSecretFont(doc: Document = document) {
		return Array.from(doc.querySelectorAll('.font-cxsecret')).map((font) => {
			// 这里吧选项按钮和文字分离，如果不分离的话 .font-cxsecret 元素下面还包含选项按钮时，替换时会吧按钮也删除掉导致选项按钮不可用
			const after = font.querySelector('.after');
			return after === null ? font : after;
		}) as HTMLElement[];
	},
	/**
	 * 检测当前章节是否完成
	 */
	isCurrentChapterFinished() {
		const job = top?.document.querySelector('.posCatalog_active');
		if (job) {
			if (job.querySelector('.icon_Completed') !== null) {
				return true;
			}
		}
		return false;
	}
};

/**
 * 屏蔽倍速限制
 */
function rateHack() {
	state.study.hacked = false;
	let dragCount = 0;
	try {
		hack();
		window.document.addEventListener('readystatechange', hack);
		window.addEventListener('load', hack);
	} catch (e) {
		console.error(e);
	}

	function hack() {
		const videojs = $gm.unsafeWindow.videojs;
		const Ext = $gm.unsafeWindow.Ext;

		if (typeof videojs !== 'undefined' && typeof Ext !== 'undefined') {
			if (state.study.hacked) {
				return;
			}
			state.study.hacked = true;

			const _origin = videojs.getPlugin('seekBarControl');
			const plugin = videojs.extend(videojs.getPlugin('plugin'), {
				constructor: function (videoExt: any, data: any) {
					const _sendLog = data.sendLog;
					data.sendLog = (...args: any[]) => {
						if (args[1] === 'drag') {
							dragCount++;
							// 开始播放的时候偶尔会卡顿，导致一直触发 drag 事件（超星的BUG）
							// 这里如果卡顿太多，尝试暂停视频，然后等待视频自动开始。
							if (dragCount > 100) {
								dragCount = 0;
								$el('video')?.pause();
							}
						} else {
							_sendLog.apply(data, args);
						}
					};

					_origin.apply(_origin.prototype, [videoExt, data]);
				}
			});

			videojs.registerPlugin('seekBarControl', plugin);

			// 重写超星视频插件
			Ext.define('ans.VideoJs', {
				override: 'ans.VideoJs',
				constructor: function (data: any) {
					this.addEvents(['seekstart']);
					this.mixins.observable.constructor.call(this, data);
					const vjs = videojs(data.videojs, this.params2VideoOpt(data.params), function () {});
					Ext.fly(data.videojs).on('contextmenu', function (f: any) {
						f.preventDefault();
					});
					Ext.fly(data.videojs).on('keydown', function (f: any) {
						if (f.keyCode === 32 || f.keyCode === 37 || f.keyCode === 39 || f.keyCode === 107) {
							f.preventDefault();
						}
					});

					// 保存清晰度设置
					if (vjs.videoJsResolutionSwitcher) {
						vjs.on('resolutionchange', function () {
							const cr = vjs.currentResolution();
							const re = cr.sources ? cr.sources[0].res : false;
							Ext.setCookie('resolution', re);
						});
					}

					// 保存公网设置
					if (vjs.videoJsPlayLine) {
						vjs.on('playlinechange', function () {
							const cp = vjs.currentPlayline();
							Ext.setCookie('net', cp.net);
						});
					}

					// 下面连着一个倍速限制方法，这里直接不写，实现可以倍速
				}
			});
		}
	}
}

/**
 * cx 任务学习
 */
type StudyOptions = typeof CXProject.scripts.study.cfg & { workOptions: CommonWorkOptions };
let activeStudy: Promise<void> | undefined;

export function study(opts: StudyOptions): Promise<void> {
	if (activeStudy) return activeStudy;
	const controller = new AbortController();
	const leave = () => controller.abort();
	window.addEventListener('pagehide', leave, { once: true });
	activeStudy = studyChapter(opts, controller.signal).catch((error) => {
		if (!controller.signal.aborted) {
			console.error('章节学习已暂停', error);
			$message.error({ content: `章节学习已暂停：${String(error instanceof Error ? error.message : error)}`, duration: 0 });
		}
	}).finally(() => {
		controller.abort();
		window.removeEventListener('pagehide', leave);
		activeStudy = undefined;
	});
	return activeStudy;
}

async function studyChapter(opts: StudyOptions, signal: AbortSignal) {
	await studySleep(3000, signal);
	const searchedJobs: Job[] = [];
	await runStudyJobs({
		signal,
		discover: () => searchJob(opts, searchedJobs, signal),
		snapshot: () => {
			const attachments: Attachment[] | undefined = Array.isArray($gm.unsafeWindow.attachments)
				? $gm.unsafeWindow.attachments : undefined;
			const pending = (attachments || []).filter((attachment) => {
				if (!attachment?.property) return !!attachment?.job;
				const id = studyJobId(attachment);
				if (searchedJobs.some((job) => job.id === id)) return false;
				const module = attachment.property.module;
				if ((module === 'insertvideo' || module === 'insertaudio') && !opts.enableMedia) return false;
				if (module === 'work' && !opts.enableChapterTest) return false;
				if (['insertbook', 'insertdoc', 'insertflash'].includes(module) && !opts.enablePPT) return false;
				return !!attachment.job || (module === 'work' && opts.enableChapterTest &&
					CommonProject.scripts.settings.cfg['work-when-no-job']) || (opts.enableMedia && ['insertvideo', 'insertaudio'].includes(module) &&
					(attachment.isPassed ? opts.restudy : opts.forceLearn));
			}).map((attachment) => studyJobId(attachment) || '未识别的任务');
			return { ready: !!attachments, signature: JSON.stringify(attachments || null), pending };
		}
	});
	assertStudyActive(signal);

	// @ts-ignore
	top._preChapterId = '';

	// 下一章
	const next = async () => {
		if (CXAnalyses.isInFinalTab()) {
			if (await CXAnalyses.isStuckInBreakingMode()) {
				return $modal.alert({
					content:
						'检测到当前课程为闯关模式（有小旗帜图标）, 但是已经重复进入多次，应该是章节测试没有完成，或者其他情况导致，请手动完成章节测试，然后手动点击下一章。'
				});
			}
		}

		if (CXAnalyses.isInFinalChapter() && CXAnalyses.isInFinalTab() &&
			(CXProject.scripts.study.cfg.mode !== 'job' || CXAnalyses.isFinishedAllChapters())) {
			let content = '';

			if (opts.backToFirstWhenFinish) {
				content = '已经抵达最后一个章节，10秒后返回第一个章节重新开始。';
				$message.info({ content, duration: 10 });
				await studySleep(10 * 1000, signal);
				top?.document.querySelector<HTMLElement>('.posCatalog_name')?.click();

			} else {
				if (CXAnalyses.isFinishedAllChapters()) {
					content = '全部任务点已完成！';
				} else {
					content = '已经抵达最后一个章节！但仍然有任务点未完成，请手动切换至未完成的章节。';
				}

				$modal.alert({ content: content });
			}

			CommonProject.scripts.settings.methods.notificationBySetting(content, {
				duration: 0,
				extraTitle: '学习通AI辅助插件'
			});
			return;
		}

		if (CXProject.scripts.study.cfg.mode === 'job' && CXAnalyses.isInFinalTab()) {
			const chapters = CXAnalyses.getChapterInfos();
			if (!chapters.length || chapters.some((chapter) => !Number.isFinite(chapter.unFinishCount))) {
				throw new Error('章节目录或未完成任务数尚未就绪，请刷新后重试。');
			}
			const current = chapters.findIndex((chapter) => chapter.element.parentElement?.classList.contains('posCatalog_active'));
			const pending = chapters.filter((chapter) => chapter.unFinishCount > 0);
			const nextChapter = pending.find((chapter) => chapters.indexOf(chapter) > current) ||
				pending.find((chapter) => !chapter.element.parentElement?.classList.contains('posCatalog_active'));
			if (!nextChapter) {
				const content = pending.length
					? '当前章节仍有未完成任务，请检查平台完成状态并手动处理；已暂停自动跳转。'
					: chapters.length ? '全部任务点已完成！' : '未能读取章节目录，已暂停自动跳转。';
				$modal.alert({ content });
				return;
			}
			CXAnalyses.scrollToActiveChapter();
			await studySleep(1000, signal);
			nextChapter.element.click();
		} else if (CXProject.scripts.study.cfg.mode === 'next' || CXProject.scripts.study.cfg.mode === 'job') {
			const curCourseId = $el<HTMLInputElement>('#curCourseId', top?.document);
			const curChapterId = $el<HTMLInputElement>('#curChapterId', top?.document);
			const curClazzId = $el<HTMLInputElement>('#curClazzId', top?.document);
			const count = $$el('#prev_tab .prev_ul li', top?.document);

			// 自动下一个小节（点击下一节）
			if (curChapterId && curCourseId && curClazzId) {
				// @ts-ignore
				top._preChapterId = curChapterId.value;
				CXAnalyses.scrollToActiveChapter();
				// 等待跳转动画完成
				await studySleep(200, signal);

				/**
				 * count, chapterId, courseId, clazzid, knowledgestr, checkType
				 * checkType 就是询问当前章节还有任务点未完成，是否完成，这里直接不传，默认下一章
				 */
				// @ts-ignore
				top?.PCount.next(count.length.toString(), curChapterId.value, curCourseId.value, curClazzId.value, '');
			} else {
				throw new Error('章节跳转参数未就绪，请刷新页面或手动切换下一节。');
			}
		} else {
			throw new Error('未知的章节跳转模式，请重新选择学习设置。');
		}
	};

	if (CXProject.scripts.study.cfg.mode !== 'manually') {
		const msg = '当前页面可执行任务处理结束，即将跳转；完成状态以平台记录为准。';
		$message.success({ content: msg });
		console.info(msg);
		await studySleep(5000, signal);
		await next();
	} else {
		const msg = '当前页面可执行任务处理结束，自动跳转已关闭，请核对平台记录后手动跳转。';
		$message.warn({ content: msg, duration: 0 });
		console.warn(msg);
	}
}

/**
 * 搜索任务点
 */
function searchJob(
	opts: typeof CXProject.scripts.study.cfg & {
		workOptions: CommonWorkOptions;
	},
	searchedJobs: Job[],
	signal: AbortSignal
): Job | undefined {
	const knowCardWin = $gm.unsafeWindow;

	const searchJobElement = (root: HTMLIFrameElement) => {
		return domSearch(
			{
				videojs: '#video,#audio',
				chapterTest: '.TiMu',
				read: '#img.imglook',
				pptWithAudio: '.swiper-container',
				hyperlink: '#hyperlink',
				timereader: 'iframe[name="bookifame"][src*="timing"]'
			},
			root.contentWindow!.document
		);
	};

	const search = (root: HTMLIFrameElement): Job | undefined => {
		const win = root.contentWindow;

		const { videojs, read, chapterTest, hyperlink, pptWithAudio, timereader } = searchJobElement(root);

		if (win && (videojs || read || chapterTest || hyperlink || pptWithAudio || timereader)) {
			const attachments = Array.isArray(knowCardWin.attachments)
				? knowCardWin.attachments.filter((attachment: Attachment) => attachment?.property) : [];
			const attachment = findStudyAttachment<Attachment>(root, attachments);
			if (attachment && !searchedJobs.some((job) => job.id === studyJobId(attachment))) {
				const { name, title, bookname, author } = attachment.property;
				const jobName = name || title || (bookname ? bookname + author : undefined) || '未知任务';

				const work_type = attachment.job ? 'job' : attachment.isPassed ? 'finished' : 'not-job';

				let func: { (): Promise<any> } | undefined;

				if (videojs) {
					if (!CXProject.scripts.study.cfg.enableMedia) {
						const msg = `音视频自动学习功能已关闭（在上方菜单栏，课程学习中开启）。${jobName} 即将跳过`;
						$message.warn({ content: msg, duration: 10 });
						console.warn(msg);
					} else {
						if (
							// 未完成
							work_type === 'job' ||
							// 重复学习
							(work_type === 'finished' && opts.restudy) ||
							// 强制学习
							(work_type === 'not-job' && opts.forceLearn)
						) {
							func = () => {
								const msg =
									`即将${
										work_type === 'finished' && opts.restudy
											? '重新'
											: work_type === 'not-job' && opts.forceLearn
											? '强制'
											: ''
									}播放 : ` + jobName;
								$message.info({ content: msg });
								console.log(msg);
								return JobRunner.media(opts, win.document, signal);
							};
						}
					}
				} else if (chapterTest) {
					if (!CXProject.scripts.study.cfg.enableChapterTest) {
						const msg = `章节测试自动答题功能已关闭（在上方菜单栏，课程学习中开启）。${jobName} 即将跳过`;
						$message.warn({ content: msg, duration: 10 });
						console.warn(msg);
					} else {
						const status = win.document.querySelector<HTMLElement>('.testTit_status');

						// 已完成
						if (status?.classList.contains('testTit_status_complete')) {
							const msg = `章节测试已完成 : ` + jobName;
							$message.success({ content: msg });
							console.log(msg);
						} else {
							if (
								// 未完成
								work_type === 'job' ||
								// / 强制学习
								(work_type === 'not-job' && CommonProject.scripts.settings.cfg['work-when-no-job'])
							) {
								if (hasAnswerProvider(opts.workOptions) === false) {
									aiConfigEmptyWarning(0);
									func = async () => { throw new Error('章节测试未配置可用 AI，已暂停自动跳转，请配置或手动完成。'); };
								} else {
									func = () => {
										const msg = `开始答题 : ` + jobName;
										$message.info({ content: msg });
										console.log(msg);
										return JobRunner.chapter(root, opts.workOptions, signal);
									};
								}
							}
							if (work_type === 'not-job' && CommonProject.scripts.settings.cfg['work-when-no-job'] === false) {
								const msg = `当前作业 ${jobName} 不是任务点，但待完成，如需开启自动答题请前往：AI设置，开启强制答题。`;
								$message.warn({ content: msg });
								console.warn(msg);
							}
						}
					}
				} else if (read || pptWithAudio || timereader) {
					if (!CXProject.scripts.study.cfg.enablePPT) {
						const msg = `PPT/书籍阅读功能已关闭（在上方菜单栏，课程学习中开启）。${jobName} 即将跳过`;
						$message.warn({ content: msg, duration: 10 });
						console.warn(msg);
					} else {
						if (attachment.job) {
							func = () => {
								const msg = `正在学习 : ` + jobName;
								$message.info({ content: msg });
								console.log(msg);
								if (read) {
									return JobRunner.read(win, signal);
								} else if (timereader) {
									return JobRunner.timereader(timereader as HTMLIFrameElement, signal);
								} else {
									return JobRunner.readPPTWithAudio(win, signal);
								}
							};
						}
					}
				} else if (hyperlink) {
					if (!CXProject.scripts.study.cfg.enableHyperlink) {
						const msg = `链接任务点已关闭（在上方菜单栏，课程学习中开启）。${jobName} 即将跳过`;
						$message.warn({ content: msg, duration: 10 });
						console.warn(msg);
					} else {
						if (attachment.job) {
							func = () => {
								const msg = `正在完成链接阅读任务 : ` + jobName;
								$message.info({ content: msg });
								console.log(msg);
								return JobRunner.hyperlink(hyperlink, signal);
							};
						}
					}
				}

				const job = {
					id: studyJobId(attachment),
					attachment: attachment,
					func: func
				};

				searchedJobs.push(job);

				return job;
			}
		}
	};

	let job;

	for (const iframe of searchStudyFrames(knowCardWin.document)) {
		try { job = search(iframe); }
		catch (error) { console.debug('任务 frame 尚未就绪', error); continue; }
		if (job) {
			return job;
		}
	}

	return job;
}

/**
 * 永久固定显示视频进度
 */
export function fixedVideoProgress() {
	if (state.study.videojs) {
		const { bar } = domSearch({ bar: '.vjs-control-bar' }, state.study.videojs as any);
		if (bar) {
			bar.style.opacity = '1';
		}
	}
}

/**
 * 任务点运行器
 */
const JobRunner = {
	/**
	 * 播放视频和音频
	 */
	async media(
		setting: { playbackRate: number; volume: number; videoQuizStrategy: VideoQuizStrategy },
		doc: Document,
		signal?: AbortSignal
	) {
		const media = await waitForMedia({ root: doc, signal });
		const { videojs } = domSearch({ videojs: '#video,#audio' }, doc);
		if (!videojs) throw new Error('未找到播放器，请刷新或手动播放。');
		state.study.videojs = videojs;
		// @ts-ignore
		top.currentMedia = media;
		fixedVideoProgress();
		const submitted = new WeakSet<HTMLElement>();
		const notified = new WeakSet<HTMLElement>();
		const quiz = () => {
			const submit = doc.querySelector<HTMLElement>('#videoquiz-submit');
			return isStudyElementVisible(submit) ? submit! : undefined;
		};
		try {
			await runStudyMedia(media, {
				signal,
				settings: () => ({
					playbackRate: Number(CXProject.scripts.study.cfg.playbackRate),
					volume: CXProject.scripts.study.cfg.volume
				}),
				play: (play, signal) => playMedia(play, signal),
				beforePlay: async (signal) => {
					if (hasFaceRecognition()) await waitForFaceRecognition(signal);
					if (hasNewFaceRecognition()) await waitForNewFaceRecognition(signal);
				},
				isBlocked: () => !!quiz() || hasFaceRecognition() || hasNewFaceRecognition(),
				onTick: () => {
					const errorDiv = doc.querySelector<HTMLElement>('.vjs-modal-dialog-content');
					if (['视频文件损坏', '网络错误导致视频下载中途失败', '视频因格式不支持', '网络的问题无法加载']
						.some((text) => errorDiv?.innerText.includes(text))) throw new Error('播放器报告加载失败，请检查网络或手动播放。');
					const submit = quiz();
					if (!submit) return;
					if (!notified.has(submit)) {
						notified.add(submit);
						$message.warn({ content: '检测到视频内题目；未通过时请手动完成，脚本不会移除题目或验证弹窗。', duration: 10 });
					}
					if (setting.videoQuizStrategy === 'random' && !submitted.has(submit)) {
						const list = Array.from(doc.querySelectorAll<HTMLElement>('.ans-videoquiz-opt label'))
							.filter((label) => label.getClientRects().length);
						if (list.length && !submit.hasAttribute('disabled')) {
							submitted.add(submit);
							list[Math.floor(Math.random() * list.length)].click();
							submit.click();
						}
					}
				}
			});
		} finally {
			// @ts-ignore
			if (top.currentMedia === media) top.currentMedia = undefined;
			if (state.study.videojs === videojs) state.study.videojs = undefined;
		}
	},
	/**
	 * 阅读，PPT
	 */
	async read(win: Window & { finishJob?: Function }, signal?: AbortSignal) {
		assertStudyActive(signal);
		if (!win.finishJob) throw new Error('文档阅读接口未就绪，请手动完成阅读。');
		win.finishJob();
		await studySleep(3000, signal);
	},
	/**
	 * 时间阅读
	 */
	async timereader(iframe: HTMLIFrameElement, signal?: AbortSignal) {
		const src = iframe.getAttribute('src')?.toString() || '';
		const timing = studyReaderTiming(src, iframe.ownerDocument.baseURI);
		$message.info({
			content: `正在学习长时阅读任务，请稍等，不要切换..（预计${(timing + 3) * 3}秒）`,
			duration: (timing + 3) * 3
		});
		// 这里依靠 onactive 第一个跨域处理程序，等待处理后继续即可
		// 一共有三步，第一步等待timing，然后切换正文页，然后是封底页，最后点击一次PPT文档切换界面，即可完成任务
		await studySleep((timing + 3) * 3 * 1000, signal);
		$message.info('长时阅读预计等待时间已结束，请以平台任务标记为准。');
		await studySleep(5000, signal);
	},
	/**
	 * 章节测验
	 */
	async chapter(
		frame: HTMLIFrameElement,
		{
			upload,
			thread,
			period,
			stopSecondWhenFinish,
			redundanceWordsText,
			answerSeparators,
			answerMatchMode,
			...providerConfig
		}: CommonWorkOptions,
		signal?: AbortSignal
	) {
		assertStudyActive(signal);
		if (providerConfig.aiProvider !== 'deepseek-web' && hasAnswerProvider(CommonProject.scripts.settings.methods.getWorkOptions()) === false) {
			return aiConfigEmptyWarning(0);
		}

		let cancelled = false;
		let closeWorker: (() => void) | undefined;
		const cancel = () => { cancelled = true; closeWorker?.(); };
		signal?.addEventListener('abort', cancel, { once: true });
		let unwatch: (() => void) | undefined;
		let taskNote: MessageElement | undefined;
		const stopButton = $ui.button('⏹停止章节答题', { onclick: () => { cancelled = true; } });
		if (providerConfig.aiProvider === 'deepseek-web') taskNote = $message.info({ duration: 0,
			content: h('div', {}, [createWebTaskStatus(), stopButton]) });
		let activity: Awaited<ReturnType<typeof acquireWebActivity>> | undefined;
		try {
			if (providerConfig.aiProvider === 'deepseek-web') activity = await acquireWebActivity('work', { isCancelled: () => cancelled });
		} catch (error) {
			taskNote?.remove();
			signal?.removeEventListener('abort', cancel);
			throw error;
		}
		try {
			console.info('开始章节测试');
			const visual_state = CommonProject.scripts.render.cfg.visual;

			const frameWindow = frame.contentWindow;
			const { TiMu } = domSearchAll({ TiMu: '.TiMu' }, frameWindow!.document);

			// 最大化面板
			CORSUtils.panelNormal();
			CommonProject.scripts.workResults.methods.init();
			// 固定显示答题结果面板
			CORSUtils.pinWorkPanel();

			const chapterTestTaskQuestionTitleTransform = (
				titles: (HTMLElement | undefined)[],
				imageUrls = inspectQuestionImages(titles).imageUrls
			) => {
				const removed = removeRedundantWords(
					titles.map((t) => (t ? questionElementText(t, imageUrls) : '')).join(' '),
					redundanceWordsText.split('\n')
				);

				return (
					removed
						.trim()
						/** 超星旧版作业题目冗余数据 */
						.replace(/^\d+[。、.]/, '')
						.replace(/（\d+\.\d+分）/, '')
						.replace(/\(..题, \d+?分\)/, '')
						.replace(/\(..题, \d+\.\d+分\)/, '')
						.replace(/[[(【（](..题|名词解释|完形填空|阅读理解)[\])】）]/, '')
						.trim()
				);
			};

			/** 新建答题器 */
			const worker = new CourseWorker({
				root: TiMu,
				elements: {
					title: (root) => cxQuestionTitles(root, '.Zy_TItle .clearfix'),
					/**
					 * 兼容各种选项
					 *
					 * ul li .after 单选多选
					 * ul li label:not(.after) 判断题
					 * ul li textarea 填空题
					 */
					options: 'ul li .after,ul li textarea,ul textarea,ul li label:not(.before)',
					type: 'input[id^="answertype"]',
					lineSelectBox: (root) => lineSelectBoxes(root)
				},
				thread: providerConfig.aiProvider === 'deepseek-web' ? 1 : thread ?? 1,
				requestPeriod: Math.max(0, Number(period || 0) * 1000),
				answerSeparators: answerSeparators.split(',').map((s) => s.trim()),
				answerMatchMode: answerMatchMode,
				/** 默认搜题方法构造器 */
				answerer: (_elements, ctx) =>
					searchCXQuestion(ctx, chapterTestTaskQuestionTitleTransform, providerConfig, activity?.id),

				work: async (ctx) => {
					const { elements, searchInfos } = ctx;
					const type = resolveQuestionType(elements, ctx, elements.title.map((el) => el?.textContent || '').join(' '));

					if (type === 'programming') return answerCXProgrammingQuestion(ctx, chapterTestTaskQuestionTitleTransform, providerConfig, activity?.id);
					if (type && (type === 'completion' || type === 'multiple' || type === 'judgement' || type === 'single')) {
						return fillStandardAnswer(ctx, type, () => $.sleep(500));
					}
					// 连线题自定义处理
					else if (type && type === 'line') {
						for (const info of searchInfos) {
							for (const result of info.results) {
								const filled = await fillLineAnswer(
									result.answer,
									ctx.root,
									() => $.sleep(200),
									ctx.isCancelled,
									ctx.waitUntilReady
								);
								if (filled.finish) return filled;
							}
						}
						return { finish: false };
					}

					return { finish: false };
				},

				/** 完成答题后 */
				async onResultsUpdate(curr, _, res) {
					CommonProject.scripts.workResults.methods.setResults(
						simplifyWorkResult(res, (titles) => chapterTestTaskQuestionTitleTransform(titles))
					);
					CommonProject.scripts.workResults.methods.updateWorkStateByResults(res);

					if (curr.ctx?.isCancelled?.()) return;
					// 没有完成时随机作答
					if (curr.result?.finish === false && curr.resolved === true) {
						if (isQuestionSkipped(curr.ctx?.searchInfos)) {
							console.log('此题已跳过，不进行随机作答');
							return;
						}

						const options = curr.ctx?.elements?.options || [];

						const typeInput = curr.ctx?.elements?.type[0] as HTMLInputElement | undefined;
						const type = typeInput ? getQuestionType(parseInt(typeInput.value)) : undefined;

						const commonSetting = CommonProject.scripts.settings.cfg;

						if (
							commonSetting['randomWork-choice'] &&
							(type === 'judgement' || type === 'single' || type === 'multiple')
						) {
							console.log('正在随机作答');

							await curr.ctx?.waitUntilReady?.();
							if (curr.ctx?.isCancelled?.()) return;
							const option = options[Math.floor(Math.random() * options.length)];
							// @ts-ignore 随机选择选项
							option?.parentElement?.querySelector('a,label')?.click();
						} else if (commonSetting['randomWork-complete'] && type === 'completion') {
							console.log('正在随机作答');

							// 随机填写答案
							for (const option of options) {
								await curr.ctx?.waitUntilReady?.();
								if (curr.ctx?.isCancelled?.()) return;
								const completeTexts = commonSetting['randomWork-completeTexts-textarea'].split('\n').filter(Boolean);
								const text = completeTexts[Math.floor(Math.random() * completeTexts.length)];
								if (text) fillTextAnswer(option, text);
								else console.error('请设置随机填空的文案');
								await $.sleep(500);
							}
						}
					}
				},
				async onElementSearched(elements, root) {
					await recognizeSecretFontForQuestion(root);

					const typeInput = elements.type[0] as HTMLInputElement;
					const type = typeInput ? getQuestionType(parseInt(typeInput.value)) : undefined;

					/** 判断题转换成文字，以便于答题程序判断 */
					if (type === 'judgement') {
						elements.options.forEach((option) => {
							const opt = option?.textContent?.trim() || '';
							if (opt.includes('对') || opt.includes('错')) {
								// 2023/8/5日后超星已修复判断题，将图片修改成文字，如果已经有对错的文本，则不需要再转换
							}
							// 如果是英语的对错题目，他是一个英文单词 True,False
							else if (opt === 'True') {
								option.textContent = '√';
							} else if (opt === 'False') {
								option.textContent = 'x';
							}
							// 支持香港地区的繁体字
							else if (opt === '對') {
								option.textContent = '√';
							} else if (opt === '錯') {
								option.textContent = 'x';
							} else {
								const ri = option.querySelector('.ri');
								const span = document.createElement('span');
								span.innerText = ri ? '√' : '×';
								option.appendChild(span);
							}
						});
					}
				}
			});
			closeWorker = () => worker.emit('close');
			worker.on('close', () => { cancelled = true; });
			worker.opts.readAnswer = (ctx) =>
				prepareCXQuestion(ctx, worker, chapterTestTaskQuestionTitleTransform, providerConfig);

			if (providerConfig.aiProvider === 'deepseek-web') {
				reportWebTaskStatus('idle', '章节答题已开始。');
				const pauseButton = $ui.button('⏸暂停', { onclick: () => {
					worker.emit(worker.isStop ? 'continuate' : 'stop');
					pauseButton.value = worker.isStop ? '▶️继续' : '⏸暂停';
				} });
				stopButton.onclick = () => { cancelled = true; worker.emit('close'); };
				taskNote?.remove();
				taskNote = $message.info({ duration: 0, content: h('div', {}, [createWebTaskStatus(), pauseButton, stopButton]) });
				unwatch = watchWebTaskStatus((status) => {
					if (status.phase === 'attention') { worker.emit('stop'); pauseButton.value = '▶️继续'; }
				});
			}
			if (cancelled) worker.emit('close');
			const results = await worker.doWork();
			assertStudyActive(signal);
			await worker.waitUntilReady();

			const msg = `答题完成，将等待 ${stopSecondWhenFinish} 秒后进行保存或提交。`;
			console.info(msg);
			$message.info({ content: msg, duration: stopSecondWhenFinish });
			await studySleep(stopSecondWhenFinish * 1000, signal);

			// Re-check after the countdown: stop/pause also controls saving and submission.
			await worker.waitUntilReady();
			await worker.uploadHandler({
				type: upload,
				results,
				async callback(finishedRate, uploadable) {
					const msg = `完成率 ${finishedRate.toFixed(2)}% :  ${uploadable ? '3秒后将自动提交' : '3秒后将自动保存'} `;
					console.info(msg);
					$message.success({ content: msg, duration: 3 });

					await studySleep(3000, signal);

					await worker.waitUntilReady();
					if (uploadable) {
						// @ts-ignore 提交
						frameWindow.btnBlueSubmit();

						await studySleep(3000, signal);
						/** 确定按钮 */
						await worker.waitUntilReady();
						// @ts-ignore 确定
						frameWindow.submitCheckTimes();
						// @ts-ignore 2024/4 更新后上方函数无法关闭弹窗，需要手动关闭确定弹窗
						top.$('#workpop').hide();
					} else {
						// @ts-ignore 禁止弹窗
						frameWindow.alert = () => {};
						// @ts-ignore 暂时保存
						frameWindow.noSubmit();
					}
				}
			});

			// 还原尺寸状态
			if (visual_state === 'minimize' && CommonProject.scripts.render.cfg.visual !== 'minimize') {
				CORSUtils.panelMinimize();
			}

			worker.emit('done');
		} finally {
			signal?.removeEventListener('abort', cancel);
			unwatch?.(); taskNote?.remove();
			activity?.release();
			if (cancelled) reportWebTaskStatus('idle', '章节答题已停止。');
		}
	},
	/**
	 * 带音频的PPT
	 */
	async readPPTWithAudio(win: Window & { swiperNext?: Function }, signal?: AbortSignal) {
		if (!win.swiperNext) throw new Error('PPT 阅读接口未就绪，请手动阅读。');
		// 关闭音视频声音
		win.document.querySelectorAll('audio').forEach((audio) => {
			audio.addEventListener('play', () => {
				audio.muted = true;
			});
		});

		// 阅读PPT
		const len = win.document.querySelectorAll('.swiper-container .swiper-slide').length;
		for (let index = 0; index < len; index++) {
			assertStudyActive(signal);
			win.swiperNext();
			await studySleep(1000, signal);
		}
		await studySleep(3000, signal);
	},
	/**
	 * 链接任务点
	 */
	async hyperlink(a: HTMLElement, signal?: AbortSignal) {
		assertStudyActive(signal);
		// 修改点击事件，防止出现弹窗
		const _click = a.onclick;
		a.onclick = () => false;
		// 点击完成
		a.click();
		// 还原点击事件
		a.onclick = _click;
		await studySleep(3000, signal);
	}
};

function isQuestionSkipped(infos: SearchInformation[] | undefined) {
	return Boolean(infos?.some((info) => (info.data as any)?.skipped === true));
}

/** 阅读理解和完形填空的共同处理器 */
async function readerAndFillHandle(
	searchInfos: SearchInformation[],
	list: HTMLElement[],
	cancelled?: () => boolean,
	beforeWrite?: () => Promise<void>
) {
	for (const info of searchInfos)
		for (const result of info.results) {
			const filled = await fillGroupedChoices(
				result.answer,
				list,
				'span.saveSingleSelect[data]',
				() => $.sleep(200),
				cancelled,
				beforeWrite
			);
			if (filled.finish) return filled;
		}
	return { finish: false };
}

function hasFaceRecognition() {
	// 人脸元素有时候 src 属性为空字符串，所以这里需要判断 src 是否为空字符串，如是则人脸识别会出现。
	const faces = $$el<HTMLImageElement>('#fcqrimg', top?.document);
	let active = false;
	for (const face of faces) {
		const src = face.getAttribute('src');
		if (src && isStudyElementVisible(face)) {
			active = true;
			break;
		}
	}
	return active;
}

function hasNewFaceRecognition() {
	const faces = $$el<HTMLImageElement>('.chapterVideoFaceMaskDiv', top?.document);
	let active = false;
	for (const face of faces) {
		if (isStudyElementVisible(face)) {
			active = true;
			break;
		}
	}
	return active;
}

/**
 * 等待新版人脸识别，视频开头会出现的人脸识别
 */
async function waitForNewFaceRecognition(signal?: AbortSignal) {
	await waitForFaceCheck(hasNewFaceRecognition, signal);
}
/** 等待用户手动识别，离页后不再保留轮询。 */
async function waitForFaceRecognition(signal?: AbortSignal) {
	await waitForFaceCheck(hasFaceRecognition, signal);
}

async function waitForFaceCheck(active: () => boolean, signal?: AbortSignal) {
	let notified = false;
	while (active()) {
		assertStudyActive(signal);
		if (!notified) {
			notified = true;
			const msg = '检测到人脸识别，请手动进行识别后脚本才会继续运行。';
			if (CXProject.scripts.study.cfg.notifyWhenHasFaceRecognition) {
				CommonProject.scripts.settings.methods.notificationBySetting(msg, { duration: 0 });
			}
			$message.warn({ content: msg, duration: 0 });
		}
		await studySleep(1000, signal);
	}
	assertStudyActive(signal);
}

/**
 * 答题程序位于其他 iframe 中，而 methods.pin 等 是依赖于 setTab 方法的，所以需要重新定义一个顶层函数来调用 pin 方法
 * 跨域调用
 */

const CORSUtils = {
	pinWorkPanel: cors.defineTopFunction(() => {
		CommonProject.scripts.render.methods.pin(CommonProject.scripts.workResults);
	}),
	panelNormal: cors.defineTopFunction(() => {
		CommonProject.scripts.render.methods.normal();
	}),
	panelMinimize: cors.defineTopFunction(() => {
		CommonProject.scripts.render.methods.minimize();
	})
};
