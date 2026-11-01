import { request } from '@xuexitong-ai-helper/core/src/core/utils/request';
import { parseCourseTaskLinks, parseTaskDocument, taskURL, type PendingTask } from './pending-tasks';

export interface DesktopTaskOptions {
	signal?: AbortSignal;
	loadText?: (url: string, signal?: AbortSignal) => Promise<string>;
}

/** Resolve the platform's signed desktop link only when the user opens this task. */
export async function resolveDesktopTaskURL(task: PendingTask, options: DesktopTaskOptions = {}): Promise<string> {
	const direct = taskURL(task.url);
	if (!task.desktopWorkId) return direct;
	if (!/^\d+$/.test(task.desktopWorkId)) throw new Error('作业编号无效，请刷新待办后重试。');
	const entry = taskURL(task.course.url);
	if (!entry || /\/(?:android|phone)\//i.test(new URL(entry).pathname))
		throw new Error('未找到电脑端课程入口，请刷新待办后重试。');
	const { signal } = options;
	const assertActive = () => {
		if (signal?.aborted) throw new Error('已取消打开作业。');
	};
	const load = async (url: string) => {
		assertActive();
		const html = await (options.loadText
			? options.loadText(url, signal)
			: request(url, {
					type: 'GM_xmlhttpRequest',
					method: 'get',
					responseType: 'text',
					timeout: 20000,
					isCancelled: () => Boolean(signal?.aborted)
			  }));
		assertActive();
		return html;
	};
	const lists = parseCourseTaskLinks(await load(entry));
	const work = lists.find((list) => list.kind === 'work');
	if (!work) throw new Error('本课程未提供电脑端作业列表，请在课程页面检查。');
	const listURL = new URL(work.url);
	const courseId = listURL.searchParams.get('courseId');
	const classId = listURL.searchParams.get('classId');
	let pageCount = 1,
		status = '',
		topicId = '';
	const seen = new Set<string>();
	for (let pageNumber = 1; pageNumber <= pageCount; pageNumber++) {
		const url = new URL(listURL.href);
		if (pageNumber > 1) {
			url.pathname = '/mooc-ans/mooc2/work/list';
			url.searchParams.set('pageNum', String(pageNumber));
			url.searchParams.set('status', status);
			if (topicId) url.searchParams.set('topicId', topicId);
		}
		const html = await load(url.href),
			doc = parseTaskDocument(html);
		const rows = Array.from(doc.querySelectorAll('.bottomList ul li'));
		if (!doc.querySelector('.bottomList') && !/暂无作业/.test(doc.body.textContent || ''))
			throw new Error('未能读取电脑端作业列表，请确认登录状态后重试。');
		const signature = rows.map((row) => row.outerHTML).join('\n');
		if (signature && seen.has(signature)) throw new Error('平台作业分页没有切换，请打开课程列表手动选择。');
		seen.add(signature);
		if (pageNumber === 1) {
			pageCount = Number(html.match(/pageNum\s*:\s*(\d+)/)?.[1] || 1);
			if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 500)
				throw new Error('电脑端作业列表分页异常，请打开课程列表手动选择。');
			status = doc.getElementById('status')?.getAttribute('value') || '0';
			topicId = doc.getElementById('topicId')?.getAttribute('value') || '';
		}
		const matches = new Set<string>();
		for (const row of rows) {
			const source = row.hasAttribute('data') ? row : row.querySelector('[onclick*="goTask"][data]');
			const raw = taskURL(source?.getAttribute('data') || '', url.href);
			if (!raw) continue;
			const candidate = new URL(raw),
				params = candidate.searchParams;
			if (!/\/(?:mooc2\/work\/(?:task|dowork)|work\/doHomeWorkNew)$/.test(candidate.pathname)) continue;
			if (params.get('courseId') !== courseId || (params.get('classId') || params.get('clazzId')) !== classId) continue;
			if ((params.get('workId') || params.get('workRelationId')) === task.desktopWorkId) matches.add(raw);
		}
		if (matches.size > 1) throw new Error('同一作业有多个电脑端入口，请打开课程列表手动选择，避免进入错误作答记录。');
		if (matches.size === 1) return [...matches][0];
	}
	throw new Error('未在电脑端列表找到这份作业，请刷新待办或在课程页面手动选择。');
}
