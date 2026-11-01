import { resolveDesktopTaskURL } from '../utils/pending-task-navigation';
import { scanPendingTaskSummary } from '../utils/pending-task-summary';
import {
	scanPendingTasks,
	formatTaskRemaining,
	taskRemaining,
	taskURL,
	TaskVerificationRequired,
	type PendingTask,
	type TaskScanReport
} from '../utils/pending-tasks';

let lastReport: TaskScanReport | undefined;
let disposeCurrentPanel: (() => void) | undefined;
const kindNames = { work: '作业', exam: '考试', review: '互评' };
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = '') {
	const node = document.createElement(tag);
	node.textContent = text;
	if (className) node.className = className;
	return node;
}
function link(text: string, url: string, className = '') {
	const node = element('a', text, className);
	node.href = taskURL(url);
	node.target = '_blank';
	node.rel = 'noopener noreferrer';
	return node;
}
/** A user-opened view; no background course scans, task submissions, or exam starts. */
export function createPendingTasksPanel(scan = scanPendingTaskSummary, completeScan = scanPendingTasks) {
	disposeCurrentPanel?.();
	const root = element('section', '', 'pending-tasks');
	let report = lastReport,
		controller: AbortController | undefined,
		disposed = false;
	let active = 'all';
	let scanError = '';
	const openings = new Map<string, { controller: AbortController; popup: Window }>();
	const heading = element('div', '', 'pending-task-head');
	const title = element('div');
	title.append(element('h3', '待办作业与考试'), link('学习通个人空间', 'https://i.chaoxing.com/'));
	const actions = element('div', '', 'pending-task-actions');
	const refresh = element('button', '刷新待办', 'base-style-button');
	const complete = element('button', '完整补查', 'base-style-button-secondary');
	complete.title = '逐课核对未开放作业和互评任务，耗时较长。';
	const stop = element('button', '停止读取', 'base-style-button-secondary');
	refresh.type = complete.type = stop.type = 'button';
	stop.hidden = true;
	actions.append(refresh, complete, stop);
	heading.append(title, actions);
	const status = element('p', '', 'pending-task-status secondary');
	status.setAttribute('role', 'status');
	status.setAttribute('aria-live', 'polite');
	const tabs = element('nav', '', 'pending-task-tabs');
	tabs.setAttribute('aria-label', '任务类型');
	const variants = [
		['all', '全部'],
		['work', '作业'],
		['exam', '考试'],
		['review', '待互评'],
		['expired', '已过期']
	];
	for (const [key, label] of variants) {
		const button = element('button', label);
		button.type = 'button';
		button.dataset.filter = key;
		button.onclick = () => {
			active = key;
			render();
		};
		tabs.append(button);
	}
	const filters = element('div', '', 'pending-task-filters');
	const search = element('input');
	search.type = 'search';
	search.placeholder = '搜索任务或科目';
	search.setAttribute('aria-label', '搜索任务或科目');
	const subject = element('select');
	subject.setAttribute('aria-label', '筛选科目');
	const sort = element('select');
	sort.setAttribute('aria-label', '任务排序');
	for (const [value, name] of [
		['time', '按距截止时间排序'],
		['course', '按科目排序']
	]) {
		const option = element('option', name);
		option.value = value;
		sort.append(option);
	}
	filters.append(search, subject, sort);
	const navigation = element('p', '', 'pending-task-status secondary');
	navigation.setAttribute('aria-live', 'polite');
	navigation.hidden = true;
	const list = element('div', '', 'pending-task-list');
	const empty = element('p', '', 'pending-task-empty secondary');
	const failures = element('details', '', 'pending-task-errors');
	const footer = element('p', '', 'pending-task-footer secondary');
	root.append(heading, status, navigation, tabs, filters, list, empty, failures, footer);
	function taskLink(text: string, task: PendingTask, className: string) {
		const node = link(text, task.url, className);
		if (!task.desktopWorkId) return node;
		node.title = '打开时获取这份作业的电脑端入口';
		node.onclick = async (event) => {
			event.preventDefault();
			if (disposed || openings.has(task.id)) return;
			const popup = window.open('', '_blank');
			if (!popup) {
				navigation.hidden = false;
				navigation.textContent = '浏览器阻止了新标签页，请允许弹出窗口后重试。';
				return;
			}
			popup.opener = null;
			popup.document.title = '正在打开电脑端作业';
			popup.document.body.textContent = '正在获取电脑端作业入口，请稍候…';
			const current = new AbortController();
			openings.set(task.id, { controller: current, popup });
			node.setAttribute('aria-busy', 'true');
			navigation.hidden = false;
			navigation.textContent = '正在获取“' + task.title + '”的电脑端入口…';
			try {
				const target = await resolveDesktopTaskURL(task, { signal: current.signal });
				if (disposed || current.signal.aborted || popup.closed) return;
				popup.location.replace(target);
				navigation.hidden = true;
			} catch (error) {
				if (disposed || current.signal.aborted || popup.closed) return;
				const message = String((error as any)?.message || error).slice(0, 240);
				navigation.textContent = message;
				if (error instanceof TaskVerificationRequired) popup.location.replace(task.course.url);
				else
					popup.document.body.replaceChildren(
						element('p', message),
						link('打开电脑端课程，手动选择作业', task.course.url)
					);
			} finally {
				openings.delete(task.id);
				node.removeAttribute('aria-busy');
			}
		};
		return node;
	}
	function renderTask(task: PendingTask) {
		const row = element('article', '', 'pending-task-row');
		const main = element('div', '', 'pending-task-main');
		main.append(taskLink(task.title, task, 'pending-task-title'));
		const meta = element('div', '', 'pending-task-meta');
		meta.append(
			element('span', kindNames[task.kind], 'pending-task-kind task-' + task.kind),
			element('span', task.course.name),
			element('span', task.status)
		);
		if (task.course.closed) meta.append(element('span', '已结课'));
		if (task.course.semesterUnassigned) meta.append(element('span', '未设置学期'));
		main.append(meta);
		if (task.tip) main.append(element('p', task.tip, 'pending-task-tip secondary'));
		const side = element('div', '', 'pending-task-side');
		const remaining = taskRemaining(task);
		const time = element('strong', formatTaskRemaining(task), 'pending-task-time');
		if (task.state !== 'expired' && remaining !== undefined && remaining < 86400000) time.classList.add('urgent');
		if (remaining === undefined) time.classList.add('unknown');
		if (task.deadline !== undefined)
			time.title =
				'截止：' +
				new Date(task.deadline).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) +
				'（北京时间）';
		else time.title = task.timeText;
		side.append(
			element('span', '距截止时间', 'pending-task-time-label secondary'),
			time,
			taskLink(
				task.state === 'expired'
					? '查看列表'
					: task.kind === 'exam'
					? '查看考试说明'
					: task.kind === 'review'
					? '进入互评'
					: '打开作业',
				task,
				'pending-task-open'
			)
		);
		row.append(main, side);
		return row;
	}
	function render() {
		if (disposed) return;
		const tasks = report?.tasks || [],
			pending = tasks.filter((task) => task.state !== 'expired');
		for (const [index, [key, name]] of variants.entries()) {
			const button = tabs.children[index] as HTMLButtonElement;
			const count =
				key === 'expired'
					? tasks.length - pending.length
					: key === 'all'
					? pending.length
					: pending.filter((task) => task.kind === key).length;
			button.textContent = name + ' ' + count;
			button.setAttribute('aria-pressed', String(key === active));
		}
		const selected = subject.value;
		const courses = [...new Set(tasks.map((task) => task.course.name))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
		if (JSON.stringify(courses) !== subject.dataset.courses) {
			subject.replaceChildren(element('option', '全部科目'));
			for (const name of courses) {
				const option = element('option', name);
				option.value = name;
				subject.append(option);
			}
			(subject.firstElementChild as HTMLOptionElement).value = '';
			subject.value = courses.includes(selected) ? selected : '';
			subject.dataset.courses = JSON.stringify(courses);
		}
		const query = search.value.trim().toLowerCase();
		const visible = (active === 'expired' ? tasks.filter((task) => task.state === 'expired') : pending).filter(
			(task) =>
				(active === 'all' || active === 'expired' || task.kind === active) &&
				(!subject.value || task.course.name === subject.value) &&
				!task.course.closed &&
				(!query || (task.title + ' ' + task.course.name).toLowerCase().includes(query))
		);
		visible.sort((a, b) =>
			sort.value === 'course'
				? a.course.name.localeCompare(b.course.name, 'zh-CN')
				: (taskRemaining(a) ?? Infinity) - (taskRemaining(b) ?? Infinity)
		);
		list.replaceChildren(...visible.map(renderTask));
		empty.hidden = Boolean(visible.length);
		empty.textContent = scanError
			? '本次读取失败，请检查登录状态后刷新。'
			: !report
			? '点击“刷新待办”，读取当前登录账号的课程。'
			: controller
			? '正在读取课程列表…'
			: report.errors.length || report.cancelled
			? '当前结果不完整，请查看读取状态或重新刷新。'
			: pending.length || active === 'expired'
			? '没有符合筛选条件的任务。'
			: '已读取的课程中没有未完成任务。';
		if (report) {
			const incomplete = report.verificationUrl
				? ' · 平台要求验证码，读取已暂停，结果不完整'
				: report.errors.length
				? ' · ' + report.errors.length + ' 处读取失败，结果可能不完整'
				: report.cancelled
				? ' · 读取已停止，结果不完整'
				: '';
			status.textContent =
				(controller ? '正在读取 ' : '已读取 ') +
				report.completedCourses +
				'/' +
				report.courseCount +
				' 门课程，' +
				report.pagesRead +
				' 页 · 待办 ' +
				pending.length +
				' 项' +
				incomplete;
			footer.textContent =
				'读取于 ' +
				new Date(report.fetchedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) +
				'（北京时间）。列表状态为本次读取结果；完成后可刷新。';
		}
		if (report?.source === 'summary')
			status.textContent =
				(controller ? '正在读取汇总' : '已读取汇总') +
				' · 范围内 ' +
				report.courseCount +
				' 门课 · ' +
				report.pagesRead +
				' 页 · 待办 ' +
				pending.length +
				' 项' +
				(report.errors.length ? ' · 部分数据未能读取' : report.cancelled ? ' · 读取已停止' : '');
		if (report?.verificationUrl) status.append(' ', link('打开平台验证页', report.verificationUrl));
		if (scanError) status.textContent = scanError + (report ? ' · 下方保留上次读取的结果' : '');
		failures.replaceChildren(element('summary', '查看读取失败的课程（' + (report?.errors.length || 0) + '）'));
		failures.hidden = !report?.errors.length;
		for (const error of report?.errors || []) {
			const item = element('p');
			item.append(
				error.url ? link(error.course, error.url) : element('span', error.course),
				document.createTextNode('：' + error.message)
			);
			failures.append(item);
		}
	}
	async function refreshTasks(full = false) {
		if (controller || disposed) return;
		const current = (controller = new AbortController());
		scanError = '';
		refresh.disabled = complete.disabled = true;
		stop.hidden = false;
		status.textContent = '正在读取当前登录账号的课程…';
		try {
			const result = await (full ? completeScan : scan)({
				signal: current.signal,
				onProgress: (progress) => {
					if (disposed || current !== controller) return;
					report = progress;
					render();
				}
			});
			if (disposed) return;
			report = lastReport = result;
		} catch (error) {
			if (disposed) return;
			scanError = current.signal.aborted ? '已停止读取待办。' : '读取失败：' + String((error as any)?.message || error);
		} finally {
			if (controller === current) controller = undefined;
			refresh.disabled = complete.disabled = false;
			stop.hidden = true;
		}
		render();
	}
	refresh.onclick = () => {
		void refreshTasks();
	};
	complete.onclick = () => {
		void refreshTasks(true);
	};
	stop.onclick = () => controller?.abort();
	search.oninput = render;
	subject.onchange = sort.onchange = render;
	const interval = setInterval(render, 60000);
	const observer = new MutationObserver(() => {
		if (!root.isConnected) dispose();
	});
	function dispose() {
		if (disposed) return;
		disposed = true;
		controller?.abort();
		for (const { controller, popup } of openings.values()) {
			controller.abort();
			if (!popup.closed) popup.close();
		}
		openings.clear();
		clearInterval(interval);
		observer.disconnect();
		window.removeEventListener('pagehide', dispose);
		if (disposeCurrentPanel === dispose) disposeCurrentPanel = undefined;
	}
	disposeCurrentPanel = dispose;
	window.addEventListener('pagehide', dispose);
	queueMicrotask(() => {
		if (root.isConnected) observer.observe(root.getRootNode(), { childList: true, subtree: true });
	});
	render();
	return root;
}
