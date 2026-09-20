import { $, CommonEventEmitter } from 'easy-us';
import { domSearchAll } from '../utils/dom';
import {
	CustomWorkOptions,
	RawElements,
	ResolverResult,
	SimplifyWorkResult,
	WorkContext,
	WorkerEvents,
	WorkOptions,
	WorkResult,
	WorkUploadType
} from './interface';
import { createDefaultQuestionResolver } from './question.resolver';
import { defaultWorkTypeResolver } from './utils';

/**
 * 自动答题器， 传入一些指定的配置， 就可以进行自动答题。
 *
 * @param work      工作器, 传入一个方法可自定义工作器，或者使用默认的工作器，详情： {@link WorkOptions.work}
 * @param answerer  查题器
 *
 */
export class CourseWorker<E extends RawElements = RawElements> extends CommonEventEmitter<WorkerEvents> {
	opts: WorkOptions<E>;
	isRunning = false;
	isClose = false;
	isStop = false;
	totalQuestionCount = 0;

	private activeRun?: Promise<WorkResult<E>[]>;

	constructor(opts: WorkOptions<E>) {
		super();
		this.opts = opts;
		// Register once, not once per page/run. Closing also releases a paused worker.
		this.on('close', () => {
			this.isClose = true;
			this.isStop = false;
		});
		this.on('stop', () => {
			this.isStop = true;
		});
		this.on('continuate', () => {
			this.isStop = false;
		});
	}

	/** Repeated starts share the same run instead of submitting the same questions twice. */
	doWork(options?: { enable_debug?: boolean; questionIndexes?: number[] }): Promise<WorkResult<E>[]> {
		if (this.activeRun) return this.activeRun;
		if (this.isClose) return Promise.resolve([]);
		this.isRunning = true;
		const task = Promise.resolve()
			.then(() => this.run(options))
			.finally(() => {
				this.isRunning = false;
				if (this.activeRun === task) this.activeRun = undefined;
			});
		this.activeRun = task;
		return task;
	}

	async waitForIdle() {
		await this.activeRun?.catch(() => undefined);
	}

	private async ready() {
		while (this.isStop && !this.isClose) await $.sleep(100);
		return !this.isClose;
	}

	private async run(options?: { enable_debug?: boolean; questionIndexes?: number[] }): Promise<WorkResult<E>[]> {
		this.emit('start');
		let roots: HTMLElement[] =
			typeof this.opts.root === 'string' ? Array.from(document.querySelectorAll(this.opts.root)) : this.opts.root;
		if (options?.questionIndexes) {
			const indexes = [...new Set(options.questionIndexes)]
				.filter((i) => Number.isInteger(i) && i >= 0)
				.sort((a, b) => a - b);
			roots = indexes.map((i) => roots[i]).filter(Boolean);
		}
		if (!roots.length) throw new Error('未找到任何题目，答题结束。');
		this.totalQuestionCount += roots.length;
		const results: WorkResult<E>[] = [];
		for (const root of roots) {
			if (!(await this.ready())) return results;
			const ctx: WorkContext<E> = {
				isCancelled: () => this.isClose,
				searchInfos: [],
				root,
				elements: domSearchAll<E>(this.opts.elements, root),
				type: undefined,
				answerSeparators: this.opts.answerSeparators,
				answerMatchMode: this.opts.answerMatchMode || 'similar'
			};
			const result: WorkResult<E> = { requested: false, resolved: false, ctx };
			try {
				await this.opts.onElementSearched?.(ctx.elements, root);
				ctx.elements.title = ctx.elements.title?.filter(Boolean) as HTMLElement[];
				ctx.elements.options = ctx.elements.options?.filter(Boolean) as HTMLElement[];
				if (typeof this.opts.work === 'object') {
					ctx.type =
						this.opts.work.type === undefined
							? defaultWorkTypeResolver(ctx)
							: typeof this.opts.work.type === 'string'
							? this.opts.work.type
							: this.opts.work.type(ctx);
				}
				const existing = await this.opts.readAnswer?.(ctx);
				if (existing?.answer && !this.opts.forceAnswer) {
					ctx.searchInfos = [
						{
							name: '页面已有答案',
							data: { existing_answer: true },
							results: [
								{
									question: existing.title,
									answer: existing.answer,
									extra_data: { existing_answer: true, parsed_answer: existing.answer }
								}
							]
						}
					];
					result.requested = result.resolved = true;
					result.result = { finish: true, preAnswered: true };
				}
			} catch (error) {
				result.error = String(error);
				result.requested = true;
			}
			results.push(result);
		}
		// A failed display/storage callback must not strand the request queue.
		let updates = Promise.resolve();
		const update = (index: number) => {
			updates = updates.then(async () => {
				if (this.isClose) return;
				try {
					await this.opts.onResultsUpdate?.(results[index], index, results);
				} catch (error) {
					console.error('答题结果显示失败', error);
				}
			});
			return updates;
		};
		await update(0);
		const complete: (() => void)[] = [];
		const requested = results.map(
			(_, i) =>
				new Promise<void>((resolve) => {
					complete[i] = resolve;
				})
		);
		let cursor = 0;
		let nextRequestAt = 0;
		let rateGate = Promise.resolve();
		const interval = Math.max(0, Number(this.opts.requestPeriod) || 0);
		const reserveRequest = () => {
			const turn = rateGate.then(async () => {
				while (Date.now() < nextRequestAt && !this.isClose) await $.sleep(Math.min(100, nextRequestAt - Date.now()));
				if (await this.ready()) nextRequestAt = Date.now() + interval;
			});
			rateGate = turn.catch(() => undefined);
			return turn;
		};
		const requestLoop = async () => {
			while (cursor < results.length) {
				const index = cursor++;
				const result = results[index];
				try {
					if (result.requested || !(await this.ready())) continue;
					await reserveRequest();
					if (!(await this.ready())) continue;
					const infos = await this.opts.answerer(result.ctx!.elements, result.ctx!);
					result.ctx!.searchInfos = (infos || []).map((info) => ({
						...info,
						results: (info.results || []).map((answer) => ({ ...answer, answer: String(answer.answer ?? '').trim() }))
					}));
				} catch (error) {
					result.error = error instanceof Error ? error.message : String(error);
				} finally {
					result.requested = true;
					await update(index);
					complete[index]();
				}
			}
		};
		const resolveLoop = async () => {
			for (let index = 0; index < results.length; index++) {
				// Await this exact request, including its configured API timeout/retry.
				// No separate 70-second timer: it used to mark slow/queued questions as failed prematurely.
				await requested[index];
				if (!(await this.ready())) return;
				const result = results[index];
				if (result.resolved && result.result?.finish) continue;
				const ctx = result.ctx!;
				try {
					if (result.error) throw new Error(result.error);
					const infos = ctx.searchInfos.filter(
						(info) => !info.error && !(info.data as any)?.skipped && info.results.some((r) => r.answer?.trim())
					);
					if (!infos.length)
						throw new Error(ctx.searchInfos.find((info) => info.error)?.error || '未获取到可用答案，请核对后重试。');
					// Never fill from an error/skip response, even if a provider attached stale answer data.
					ctx.searchInfos = infos;
					if (typeof this.opts.work === 'object') {
						if (!ctx.type || !ctx.elements.options?.length) throw new Error('无法识别题型或选项，请手动检查本题。');
						const handler = this.opts.work.handler;
						result.result = await createDefaultQuestionResolver(ctx)[ctx.type](
							infos,
							ctx.elements.options as HTMLElement[],
							async (type, answer, option, context) => {
								if (this.isClose) throw new Error('答题已取消');
								await handler(type, answer, option, context);
							}
						);
					} else result.result = await this.opts.work(ctx);
				} catch (error) {
					result.error = error instanceof Error ? error.message : String(error);
				}
				result.result ||= { finish: false };
				result.resolved = true;
				await update(index);
			}
		};
		const threads = Math.max(1, Math.min(8, Math.floor(Number(this.opts.thread)) || 1));
		await Promise.all([resolveLoop(), ...Array.from({ length: threads }, () => requestLoop())]);
		if (options?.enable_debug) console.debug('答题结果', results);
		return results;
	}

	/** 答题结果处理器 */
	uploadHandler(options: {
		// doWork 的返回值结果
		results: WorkResult<E>[];
		// 提交类型
		type: WorkUploadType;
		/**
		 * 是否上传处理器
		 *
		 * @param  uploadable  是否可以上传
		 * @param finishedRate 完成率
		 */
		callback: (finishedRate: number, uploadable: boolean) => void | Promise<void>;
	}) {
		const { results, type, callback } = options;
		if (type !== 'nomove') {
			let finished = 0;
			for (const result of results) {
				if (result.result?.finish) {
					finished++;
				}
			}
			const rate = results.length === 0 ? 0 : (finished / results.length) * 100;
			if (type === 'force') {
				return callback(rate, true);
			} else {
				return callback(rate, type === 'save' ? false : rate >= parseFloat(type.toString()));
			}
		}
	}
}

export class CustomCourseWorker extends CommonEventEmitter<WorkerEvents> {
	opts: CustomWorkOptions;
	isRunning = false;
	isClose = false;
	isStop = false;

	constructor(opts: CustomWorkOptions) {
		super();
		this.opts = opts;
	}

	/** 启动答题器  */
	async doWork(options?: { enable_debug?: boolean; questionIndexes?: number[] }) {
		this.emit('start');
		this.isRunning = true;

		this.once('close', () => {
			this.isClose = true;
		});

		this.on('stop', () => {
			this.isStop = true;
		});

		this.on('continuate', () => {
			this.isStop = false;
		});

		let questions = await this.opts.questions?.();
		const questionIndexes = Array.from(new Set(options?.questionIndexes || []))
			.filter((index) => Number.isInteger(index) && index >= 0)
			.sort((a, b) => a - b);

		if (questionIndexes.length) {
			questions = questionIndexes.map((index) => questions[index]).filter(Boolean);
		}

		if (options?.enable_debug) {
			console.debug('开始答题', this);
			console.debug('题目数量: ', this.opts.questions.length);
		}
		const results: SimplifyWorkResult[] = [];

		for (let index = 0; index < questions.length; index++) {
			/** 强行关闭 */
			if (this.isClose === true) {
				this.isRunning = false;
				return;
			}
			/** 检查是否暂停中 */
			if (this.isStop) {
				await waitForContinuate(() => this.isStop);
			}

			const question = questions[index];
			results[index] = {
				question: question.text,
				requested: false,
				resolved: false,
				searchInfos: [],
				type: question.type,
				finish: false,
				error: ''
			};

			try {
				const infos = await this.opts.answerer(question.text);
				results[index].searchInfos = infos.map((i) => ({
					name: i.name,
					homepage: i.homepage,
					response: i.response,
					data: i.data,
					results: i.results.map((r) => [r.question, r.answer, r.extra_data || {}]),
					error: i.error
				}));
				results[index].requested = true;
				this.opts.onResultsUpdate?.(results[index], index, results);

				try {
					const resolved = await this.opts.resolver(infos);
					results[index].finish = resolved.finish;
					results[index].error = resolved.error;
					results[index].resolved = true;
				} catch (err) {
					results[index].finish = false;
					results[index].error = err instanceof Error ? err.message : String(err);
					results[index].resolved = true;
				}
				this.opts.onResultsUpdate?.(results[index], index, results);
			} catch (err) {
				results[index].requested = true;
				results[index].resolved = false;
				results[index].finish = true;
				results[index].error = err instanceof Error ? err.message : String(err);
				this.opts.onResultsUpdate?.(results[index], index, results);
			}

			await $.sleep(this.opts.period);
		}
	}
}

async function waitForContinuate(isStopping: () => boolean) {
	if (isStopping()) {
		await new Promise<void>((resolve, reject) => {
			const interval = setInterval(() => {
				if (isStopping() === false) {
					clearInterval(interval);
					resolve();
				}
			}, 200);
		});
	}
}
