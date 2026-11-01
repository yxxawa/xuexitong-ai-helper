import {
	parseSummaryCourses,
	selectSemesterTaskCourses,
	taskSemesterScopeNotice,
	TASK_COURSES_URL
} from './pending-task-courses';
import { request } from '@xuexitong-ai-helper/core/src/core/utils/request';

export interface TaskSemester {
	id: string;
	number: string;
	name: string;
}
export interface TaskCourse {
	semesterUnassigned?: boolean;
	key: string;
	name: string;
	url: string;
	closed: boolean;
}
export interface PendingTask {
	desktopWorkId?: string;
	id: string;
	kind: 'work' | 'exam' | 'review';
	state: 'pending' | 'upcoming' | 'expired';
	title: string;
	course: TaskCourse;
	status: string;
	url: string;
	timeText: string;
	deadline?: number;
	remainingUntil?: number;
	tip: string;
	fetchedAt: number;
}
export interface TaskScanReport {
	tasks: PendingTask[];
	courseCount: number;
	completedCourses: number;
	pagesRead: number;
	errors: { course: string; message: string; url?: string }[];
	fetchedAt: number;
	cancelled: boolean;
	verificationUrl?: string;
	source?: 'summary' | 'courses';
	coverageNotice?: string;
	semester?: TaskSemester;
}
export interface TaskScanOptions {
	currentTermOnly?: boolean;
	signal?: AbortSignal;
	courseListUrl?: string;
	loadText?: (url: string, signal?: AbortSignal) => Promise<string>;
	onProgress?: (report: TaskScanReport) => void;
}
export class TaskVerificationRequired extends Error {
	constructor() {
		super('平台要求输入图片验证码，请打开课程完成验证后刷新待办。');
	}
}
function documentFrom(html: string) {
	const doc = new DOMParser().parseFromString(html, 'text/html');
	if (/提示页面|访问验证|安全验证/.test(doc.title) && /验证码|9010/.test(doc.body.textContent || ''))
		throw new TaskVerificationRequired();
	if (doc.querySelector('input[type="password"]') || /用户登录|统一身份认证/.test(doc.title))
		throw new Error('请先登录学习通个人空间，再刷新待办。');
	return doc;
}
export function taskURL(value: string, base = 'https://i.chaoxing.com/') {
	if (!value.trim()) return '';
	try {
		const url = new URL(value, base);
		return /^https?:$/.test(url.protocol) && /(^|\.)chaoxing\.com$/i.test(url.hostname) ? url.href : '';
	} catch {
		return '';
	}
}
/** Read the portal's own course destination, including portals that set iframe.src through JS. */
export function findCourseListURL(html: string) {
	const doc = documentFrom(html);
	for (const node of Array.from(doc.querySelectorAll('[src],[href],[dataurl],[data-url]'))) {
		for (const attribute of ['src', 'href', 'dataurl', 'data-url']) {
			const raw = node.getAttribute(attribute) || '';
			if (!raw.includes('/fyportal/courselist/course')) continue;
			const url = taskURL(raw);
			if (url) return url;
		}
	}
	const match = html.match(/https?:\/\/[^\s"'<>\\)]+\/fyportal\/courselist\/course[^\s"'<>\\)]*/i);
	if (match) {
		const decoded = doc.createElement('textarea');
		decoded.innerHTML = match[0];
		const url = taskURL(decoded.value);
		if (url) return url;
	}
	throw new Error('未找到“我学的课”入口，请打开学习通个人空间并确认已登录。');
}
/** The course portal supplies the school's current term, independently of browser date or selected filters. */
export function parseCurrentTaskSemester(html: string): TaskSemester {
	const doc = documentFrom(html);
	const context = doc.querySelector('.spaceBox[sectionid], .spaceBox[semesternum]');
	const sectionId = context?.getAttribute('sectionid')?.trim() || '';
	const semesterNum = context?.getAttribute('semesternum')?.trim() || '';
	const options = Array.from(
		doc.querySelectorAll<HTMLOptionElement>('#stukc select[name="xq"] option, #stukc #searchSemesterSel option')
	);
	const match = options.find(
		(option) =>
			option.value !== '0' &&
			(sectionId && sectionId !== '0'
				? option.value === sectionId
				: semesterNum && semesterNum !== '0' && option.getAttribute('semesterNum') === semesterNum)
	);
	const number = match?.getAttribute('semesterNum') || semesterNum;
	if (!match || !/^\d+$/.test(match.value) || !number || (semesterNum && semesterNum !== '0' && number !== semesterNum))
		throw new Error('平台未返回可确认的当前学期，请在学习通“我学的课”检查后重试。');
	return { id: match.value, number, name: match.textContent?.trim() || '当前学期' };
}
export function parseTaskCourses(html: string, base: string): TaskCourse[] {
	const doc = documentFrom(html),
		courses = new Map<string, TaskCourse>();
	for (const row of Array.from(doc.querySelectorAll('li.w_couritem'))) {
		const link = row.querySelector<HTMLAnchorElement>('h3 a'),
			name = link?.textContent?.trim();
		const url = taskURL(link?.getAttribute('href') || '', base);
		if (!name || !url || !/\/entercoursenewfy(?:\?|$)/.test(url)) continue;
		const params = new URL(url).searchParams;
		const key = [params.get('courseId'), params.get('clazzId'), params.get('cpi')].join(':');
		courses.set(key === '::' ? url : key, {
			key: key === '::' ? url : key,
			name,
			url,
			closed: /已结课/.test(row.textContent || '') || Boolean(row.querySelector('[title*="已结课"],[alt*="已结课"]'))
		});
	}
	if (!courses.size && !/暂无课程|没有课程|还没有加入课程/.test(doc.body.textContent || ''))
		throw new Error('课程列表未加载或结构已变化，请进入个人空间“我学的课”后重试。');
	// Refuse a partial catalog rather than silently reporting every course scanned.
	if (Number(html.match(/pageNum\s*:\s*(\d+)/)?.[1] || 1) > 1)
		throw new Error('当前课程目录存在分页，暂无法确认全部课程；请在个人空间切换为全部课程。');
	return [...courses.values()];
}
async function loadTaskCourses(
	html: string,
	base: string,
	load: (url: string) => Promise<string>,
	report: TaskScanReport,
	signal?: AbortSignal,
	currentTermOnly = true
) {
	const doc = documentFrom(html);
	if (currentTermOnly) {
		const semester = parseCurrentTaskSemester(html);
		report.semester = semester;
		report.coverageNotice = taskSemesterScopeNotice(semester);
		const parsed = parseSummaryCourses(await load(TASK_COURSES_URL));
		if (parsed.hasMore)
			report.errors.push({
				course: '课程目录',
				message: '课程汇总尚有未读取分页，课程范围可能不完整。',
				url: 'https://i.chaoxing.com/'
			});
		return selectSemesterTaskCourses(parsed.courses, semester);
	}
	if (doc.querySelector('li.w_couritem h3 a') || !doc.querySelector('#stuCourseList'))
		return parseTaskCourses(html, base);
	// The portal's native getStuCourseList requests all terms with these empty filters.
	const studyURL = new URL('/fyportal/courselist/getStudyCourse', base);
	for (const [key, value] of Object.entries({
		sectionId: '0',
		semesterNum: '',
		coursesource: '0',
		coursename: '',
		searchkkstatus: '0',
		belongSchoolId: '0'
	}))
		studyURL.searchParams.set(key, value);
	const courses = new Map(
		parseTaskCourses(await load(studyURL.href), studyURL.href).map((course) => [course.key, course])
	);
	try {
		const folderURL = new URL('/fyportal/courselist/getFolderList?type=1', base);
		const response = JSON.parse(await load(folderURL.href));
		if (!Array.isArray(response.data)) throw new Error('课程文件夹列表没有返回有效数据。');
		const uid = doc.querySelector('.spaceBox[uid]')?.getAttribute('uid') || '';
		for (const folder of response.data) {
			try {
				if (!uid || !/^\d+$/.test(String(folder.id)) || !folder.ckenc) throw new Error('课程文件夹入口缺少参数。');
				const url = new URL('/fyportal/courselist/getFolderCourse', base);
				url.searchParams.set('uid', uid);
				url.searchParams.set('folderid', String(folder.id));
				url.searchParams.set('ckenc', String(folder.ckenc));
				for (const course of parseTaskCourses(await load(url.href), url.href)) courses.set(course.key, course);
			} catch (error) {
				if (signal?.aborted || error instanceof TaskVerificationRequired) throw error;
				report.errors.push({
					course: '课程文件夹：' + String(folder.foldername || folder.id),
					message: '未能读取文件夹内课程，请在个人空间检查后重试。',
					url: 'https://i.chaoxing.com/'
				});
			}
		}
	} catch (error) {
		if (signal?.aborted || error instanceof TaskVerificationRequired) throw error;
		report.errors.push({
			course: '课程目录',
			message: '未能读取课程文件夹列表，结果可能不完整。',
			url: 'https://i.chaoxing.com/'
		});
	}
	return [...courses.values()];
}

export function parseCourseTaskLinks(html: string) {
	const doc = documentFrom(html);
	const value = (id: string) => doc.getElementById(id)?.getAttribute('value') || '';
	if (!value('courseid') || !value('clazzid') || !value('cpi')) throw new Error('课程入口未返回有效的学生课程页面。');
	return (['work', 'exam'] as const).flatMap((kind) => {
		const work = kind === 'work';
		const anchor = doc.querySelector(`[dataname="${work ? 'zy' : 'ks'}"] [data-url]`);
		if (!anchor) return [];
		const base = taskURL(anchor.getAttribute('data-url') || '', 'https://mooc2-ans.chaoxing.com/');
		const enc = value(work ? 'workEnc' : 'examEnc');
		if (!base || !enc) throw new Error('课程作业或考试入口尚未就绪，请刷新课程后重试。');
		const url = new URL(base);
		url.searchParams.set(work ? 'courseId' : 'courseid', value('courseid'));
		url.searchParams.set(work ? 'classId' : 'clazzid', value('clazzid'));
		url.searchParams.set('cpi', value('cpi'));
		url.searchParams.set('ut', 's');
		url.searchParams.set('enc', enc);
		if (!work) url.searchParams.set('openc', value('openc'));
		return [{ kind, url: url.href }];
	});
}
function remainingMilliseconds(text: string): number | undefined {
	if (!/剩余/.test(text)) return undefined;
	const units: Record<string, number> = { 天: 86400000, 小时: 3600000, 分钟: 60000, 分: 60000, 秒: 1000 };
	const matches = [...text.matchAll(/(\d+)\s*(天|小时|分钟|分|秒)/g)];
	return matches.length ? matches.reduce((total, match) => total + Number(match[1]) * units[match[2]], 0) : undefined;
}
export function parseTaskList(
	html: string,
	course: TaskCourse,
	kind: 'work' | 'exam',
	base: string,
	fetchedAt = Date.now()
) {
	const doc = documentFrom(html),
		tasks: PendingTask[] = [],
		unknownStates = new Set<string>();
	const rows = Array.from(doc.querySelectorAll('.bottomList ul li'));
	if ((!doc.querySelector('.bottomList') || !rows.length) && !/暂无(?:作业|考试)/.test(doc.body.textContent || ''))
		throw new Error('未能识别任务列表，可能登录已过期或平台页面发生变化。');
	const value = (id: string) => doc.getElementById(id)?.getAttribute('value') || '';
	for (const [index, row] of rows.entries()) {
		const status = row.querySelector('p.status')?.textContent?.trim() || '';
		if (/^(已完成|已交|已提交|待批阅|待评分|已互评|已批阅|已评分|已批改|已阅)/.test(status)) continue;
		const timeText = row.querySelector('.time')?.textContent?.trim() || '';
		const expired = /已过期|已截止|已结束/.test(status + timeText);
		if (!expired && !/^(未交|待做|待互评|未开始|未完成|进行中|待提交|待补交|已暂存)$/.test(status)) {
			unknownStates.add(status || '无状态');
			continue;
		}
		const title = row.querySelector('.right-content p')?.textContent?.trim();
		if (!title) {
			unknownStates.add('缺少题目名称');
			continue;
		}
		const taskKind = status === '待互评' ? 'review' : kind;
		const source = row.hasAttribute('data') ? row : row.querySelector('[onclick*="goTask"][data]');
		let url = taskURL(source?.getAttribute('data') || '', base);
		const native =
			row.getAttribute('onclick') || row.querySelector('[onclick*="goTest"]')?.getAttribute('onclick') || '';
		const exam = native.match(/goTest\(\s*['"]?(\d+)['"]?\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*['"]([^'"]+)['"]/);
		let tip = row.querySelector('.span_tip')?.getAttribute('title') || '';
		let deadline: number | undefined;
		if (kind === 'exam' && exam) {
			const date = Date.parse(exam[4].replace(' ', 'T').replace(/\.\d+$/, '') + '+08:00');
			if (Number.isFinite(date)) deadline = date;
			const stopped = /,\s*['"]?1['"]?\s*\);?\s*$/.test(native);
			if (!expired && !stopped) {
				const notes = new URL('/exam-ans/exam/test/examcode/examnotes', base);
				for (const id of ['courseId', 'classId', 'cpi']) notes.searchParams.set(id, value(id));
				notes.searchParams.set('examId', exam[2]);
				url = taskURL(notes.href);
			} else if (stopped) tip = '教师已停止考试，请在原列表查看。';
		}
		if (expired || !url) url = taskURL(base);
		const remaining = remainingMilliseconds(timeText);
		const params = new URL(url).searchParams;
		const nativeId = params.get('workId') || params.get('examId') || params.get('relationid');
		const id = JSON.stringify([
			course.key,
			taskKind,
			nativeId || base + ':' + index,
			params.get('answerId') || params.get('answerid')
		]);
		tasks.push({
			id,
			kind: taskKind,
			state: expired ? 'expired' : status === '未开始' ? 'upcoming' : 'pending',
			title,
			course,
			status,
			url,
			timeText,
			deadline,
			remainingUntil: remaining !== undefined ? fetchedAt + remaining : undefined,
			tip,
			fetchedAt
		});
	}
	const pages = Number(html.match(/pageNum\s*:\s*(\d+)/)?.[1] || 1);
	if (!Number.isInteger(pages) || pages < 1 || pages > 500) throw new Error('任务列表分页数量异常。');
	return {
		tasks,
		pages,
		status: value('status'),
		topicId: value('topicId'),
		unknownStates: [...unknownStates],
		signature: rows.map((row) => row.outerHTML).join('\n')
	};
}
export function taskRemaining(task: PendingTask, now = Date.now()) {
	const deadline = task.deadline ?? task.remainingUntil;
	return deadline === undefined ? undefined : deadline - now;
}
export function formatTaskRemaining(task: PendingTask, now = Date.now()) {
	if (task.state === 'expired') return '已过期';
	const remaining = taskRemaining(task, now);
	if (remaining === undefined) return task.timeText || (task.state === 'upcoming' ? '尚未开放' : '平台未显示截止时间');
	if (remaining <= 0) return '时间已到，请到平台确认';
	const minutes = Math.ceil(remaining / 60000),
		days = Math.floor(minutes / 1440),
		hours = Math.floor((minutes % 1440) / 60);
	return (days ? days + '天 ' : '') + (hours ? hours + '小时 ' : '') + (minutes % 60) + '分钟';
}
export async function scanPendingTasks(options: TaskScanOptions = {}): Promise<TaskScanReport> {
	const { signal } = options;
	const report: TaskScanReport = {
		tasks: [],
		courseCount: 0,
		completedCourses: 0,
		pagesRead: 0,
		errors: [],
		fetchedAt: Date.now(),
		cancelled: false
	};
	const publish = () => {
		report.fetchedAt = Date.now();
		options.onProgress?.({ ...report, tasks: [...report.tasks], errors: [...report.errors] });
	};
	let lastReadAt = 0;
	const load = async (url: string) => {
		if (signal?.aborted) throw new Error('已停止读取待办。');
		if (!taskURL(url)) throw new Error('平台返回了无效的学习通地址。');
		if (!options.loadText) {
			const delay = Math.max(0, 600 - (Date.now() - lastReadAt));
			if (delay)
				await new Promise<void>((resolve, reject) => {
					const cancel = () => {
						clearTimeout(timer);
						reject(new Error('已停止读取待办。'));
					};
					const timer = setTimeout(() => {
						signal?.removeEventListener('abort', cancel);
						resolve();
					}, delay);
					signal?.addEventListener('abort', cancel, { once: true });
				});
			if (signal?.aborted) throw new Error('已停止读取待办。');
			lastReadAt = Date.now();
		}
		const html = await (options.loadText
			? options.loadText(url, signal)
			: request(url, {
					type: 'GM_xmlhttpRequest',
					method: 'get',
					responseType: 'text',
					timeout: 20000,
					isCancelled: () => Boolean(signal?.aborted)
			  }));
		if (/<title[^>]*>[^<]*(?:提示页面|访问验证|安全验证)/i.test(html)) documentFrom(html);
		return html;
	};
	const catalogURL = options.courseListUrl || findCourseListURL(await load('https://i.chaoxing.com/base'));
	const courses = await loadTaskCourses(
		await load(catalogURL),
		catalogURL,
		load,
		report,
		signal,
		options.currentTermOnly !== false
	);
	report.courseCount = courses.length;
	publish();
	let next = 0;
	const known = new Set<string>();
	const addError = (course: TaskCourse, error: unknown) => {
		if (error instanceof TaskVerificationRequired) report.verificationUrl = course.url;
		const message = String((error as any)?.message || error)
			.replace(/https?:\/\/\S+/g, '(平台地址)')
			.replace(/<[^>]*>/g, '')
			.slice(0, 180);
		report.errors.push({ course: course.name, message, url: course.url });
	};
	const worker = async () => {
		while (next < courses.length && !signal?.aborted && !report.verificationUrl) {
			const course = courses[next++];
			try {
				const lists = parseCourseTaskLinks(await load(course.url));
				for (const list of lists) {
					try {
						let pageCount = 1,
							status = '',
							topicId = '';
						const signatures = new Set<string>();
						for (let pageNumber = 1; pageNumber <= pageCount && !signal?.aborted; pageNumber++) {
							const url = new URL(list.url);
							if (pageNumber > 1) {
								if (list.kind === 'work') url.pathname = '/mooc-ans/mooc2/work/list';
								url.searchParams.set('pageNum', String(pageNumber));
								url.searchParams.set('status', status);
								if (topicId) url.searchParams.set('topicId', topicId);
							}
							const html = await load(url.href);
							if (signal?.aborted) break;
							const parsed = parseTaskList(html, course, list.kind, url.href);
							if (parsed.signature && signatures.has(parsed.signature))
								throw new Error('平台分页没有切换，当前结果可能不完整。');
							signatures.add(parsed.signature);
							if (pageNumber === 1) {
								pageCount = parsed.pages;
								status = parsed.status;
								topicId = parsed.topicId;
							}
							report.pagesRead++;
							for (const task of parsed.tasks)
								if (!known.has(task.id)) {
									known.add(task.id);
									report.tasks.push(task);
								}
							if (parsed.unknownStates.length)
								addError(course, '无法识别部分任务状态：' + parsed.unknownStates.join('、'));
							publish();
						}
					} catch (error) {
						if (signal?.aborted) break;
						addError(course, error);
						if (report.verificationUrl) break;
					}
				}
			} catch (error) {
				if (signal?.aborted) break;
				addError(course, error);
			}
			if (signal?.aborted || report.verificationUrl) break;
			report.completedCourses++;
			publish();
		}
	};
	await worker();
	report.cancelled = Boolean(signal?.aborted);
	publish();
	return report;
}

export { documentFrom as parseTaskDocument, remainingMilliseconds as parseTaskRemaining };
