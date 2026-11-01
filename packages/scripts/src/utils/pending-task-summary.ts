import {
	parseSummaryCourses,
	selectSemesterTaskCourses,
	taskSemesterScopeNotice,
	TASK_COURSES_URL,
	type SummaryCourse
} from './pending-task-courses';
import { request } from '@xuexitong-ai-helper/core/src/core/utils/request';
import {
	parseTaskDocument,
	parseCurrentTaskSemester,
	parseTaskRemaining,
	taskURL,
	TaskVerificationRequired,
	type PendingTask,
	type TaskCourse,
	type TaskScanOptions,
	type TaskScanReport
} from './pending-tasks';

export const TASK_SUMMARY_URLS = {
	semester: 'https://fycourse.fanya.chaoxing.com/fyportal/courselist/course',
	courses: TASK_COURSES_URL,
	work: 'https://mooc1-api.chaoxing.com/work/stu-work',
	exam: 'https://mooc1-api.chaoxing.com/exam-ans/exam/phone/examcode',
	examTable: 'https://mooc1.chaoxing.com/exam-ans/exam/test/examcode/examlist?edition=1&nohead=0&fid='
};
export { parseSummaryCourses } from './pending-task-courses';
function courseFor(url: URL, label: string, courses: SummaryCourse[]): SummaryCourse {
	const params = url.searchParams;
	const courseId = params.get('courseId') || params.get('courseid') || '';
	const classId = params.get('classId') || params.get('clazzId') || params.get('clazzid') || '';
	const matching = courses.filter((course) => course.courseId === courseId && (!classId || course.classId === classId));
	if (matching.length === 1) return matching[0];
	const cpi = params.get('cpi') || '';
	const entry = new URL('https://mooc1.chaoxing.com/visit/stucoursemiddle');
	for (const [key, value] of Object.entries({ courseid: courseId, clazzid: classId, cpi, ismooc2: '1' }))
		if (value) entry.searchParams.set(key, value);
	return {
		courseId,
		classId,
		cpi,
		key: [courseId, classId, cpi].join(':'),
		name: label.replace(/^《(.*)》$/, '$1').trim() || '平台未提供科目',
		url: entry.href,
		closed: false
	};
}
function taskId(kind: PendingTask['kind'], url: URL, course: SummaryCourse) {
	return JSON.stringify([
		kind,
		course.courseId,
		course.classId,
		url.searchParams.get('taskrefId') ||
			url.searchParams.get('examId') ||
			url.searchParams.get('workRelationId') ||
			url.searchParams.get('workId') ||
			url.href
	]);
}
function taskState(status: string, timeText = ''): PendingTask['state'] | undefined {
	if (/^(?:已交|已提交|已完成|待批阅|待评分|已批阅|已评分|已互评)/.test(status)) return;
	if (/已过期|已截止|已结束/.test(status + timeText)) return 'expired';
	if (/^(未开始|未开放)$/.test(status)) return 'upcoming';
	return /^(未交|未提交|待做|待重做|待互评|未完成|进行中|待提交|待补交)$/.test(status) ? 'pending' : undefined;
}
function knownStatus(status: string) {
	return /^(?:已交|已提交|已完成|待批阅|待评分|已批阅|已评分|已互评|已过期|已截止|已结束|未开始|未开放|未交|未提交|待做|待重做|待互评|未完成|进行中|待提交|待补交)/.test(
		status
	);
}
function examNotes(course: SummaryCourse, id: string) {
	if (!course.courseId || !course.classId || !/^\d+$/.test(id)) return TASK_SUMMARY_URLS.examTable;
	const url = new URL('https://mooc1.chaoxing.com/exam-ans/exam/test/examcode/examnotes');
	for (const [key, value] of Object.entries({
		courseId: course.courseId,
		classId: course.classId,
		examId: id,
		cpi: course.cpi
	}))
		if (value) url.searchParams.set(key, value);
	return url.href;
}
export function parseSummaryList(
	html: string,
	kind: 'work' | 'exam',
	courses: SummaryCourse[],
	fetchedAt = Date.now()
) {
	const doc = parseTaskDocument(html);
	const container = doc.querySelector(kind === 'work' ? 'ul.nav' : 'ul.ks_list');
	if (!container) throw new Error('未能识别' + (kind === 'work' ? '作业' : '考试') + '汇总，请使用完整补查。');
	const tasks: PendingTask[] = [],
		warnings = new Set<string>();
	for (const row of Array.from(container.querySelectorAll<HTMLElement>('li[data]'))) {
		const content = row.querySelector('div[role="option"]');
		const spans = content ? Array.from(content.children).filter((node) => node.tagName === 'SPAN') : [];
		const title = row.querySelector(kind === 'work' ? 'p' : 'dt')?.textContent?.trim() || '';
		const status =
			(kind === 'work' ? spans[0]?.textContent : row.querySelector('.ks_state')?.textContent)?.trim() || '';
		if (!knownStatus(status)) {
			warnings.add('汇总中存在无法识别的任务状态。');
			continue;
		}
		const timeText = (kind === 'work' ? row.querySelector('.fr') : row.querySelector('dd'))?.textContent?.trim() || '';
		const state = taskState(status, timeText);
		if (!state) continue;
		const raw = taskURL(
			row.getAttribute('data') || '',
			kind === 'work' ? TASK_SUMMARY_URLS.work : TASK_SUMMARY_URLS.exam
		);
		if (!raw || !title) {
			warnings.add('汇总中有任务缺少名称或有效入口。');
			continue;
		}
		const url = new URL(raw),
			course = courseFor(url, kind === 'work' ? spans[1]?.textContent || '' : '', courses);
		const taskKind = status === '待互评' ? 'review' : kind;
		const remaining = parseTaskRemaining(timeText);
		let target = raw,
			tip = '';
		let desktopWorkId: string | undefined;
		if (kind === 'exam') {
			if (row.getAttribute('data-stopexam') === '1') {
				target = TASK_SUMMARY_URLS.examTable;
				tip = '教师已停止考试，请在原列表查看。';
			} else target = examNotes(course, url.searchParams.get('taskrefId') || '');
		} else if (/\/(?:android|phone)\//i.test(url.pathname)) {
			desktopWorkId =
				url.searchParams.get('taskrefId') ||
				url.searchParams.get('workRelationId') ||
				url.searchParams.get('workId') ||
				undefined;
			// The actual signed desktop task URL is fetched on click; never navigate to the mobile entry.
			target = course.url;
			if (!desktopWorkId) warnings.add('部分作业缺少编号，将打开电脑端课程入口。');
		}
		tasks.push({
			id: taskId(taskKind, url, course),
			kind: taskKind,
			state,
			title,
			course,
			status,
			url: target,
			desktopWorkId,
			timeText,
			remainingUntil: remaining === undefined ? undefined : fetchedAt + remaining,
			fetchedAt,
			tip
		});
	}
	if (/\bhaveMore\s*=\s*['"]?1\b/.test(html)) warnings.add('平台汇总仍有未读取内容，请使用完整补查。');
	return { tasks, warnings: [...warnings] };
}
export function parseSummaryExamTable(html: string, courses: SummaryCourse[], fetchedAt = Date.now()) {
	const doc = parseTaskDocument(html);
	if (!doc.querySelector('table') || !/考试列表/.test(doc.title + doc.body.textContent))
		throw new Error('未能识别考试时间汇总，请使用完整补查。');
	const tasks: PendingTask[] = [],
		finished: string[] = [],
		warnings = new Set<string>();
	for (const row of Array.from(doc.querySelectorAll('tr.dataTr'))) {
		const cells = Array.from(row.querySelectorAll('td'));
		const title = cells[1]?.textContent?.trim() || '',
			timeText = cells[2]?.textContent?.trim() || '';
		const examStatus = cells[4]?.textContent?.trim() || '',
			status = cells[5]?.textContent?.trim() || '';
		const action = row.querySelector<HTMLElement>('[onclick*="go"]')?.getAttribute('onclick') || '';
		const arg = action.match(/\bgo\(\s*['"]([^'"]+)['"]/);
		const raw = arg && taskURL(arg[1], TASK_SUMMARY_URLS.examTable);
		if (!raw || !title || !knownStatus(status)) {
			warnings.add('部分考试时间或入口未能读取，请使用完整补查。');
			continue;
		}
		const transfer = new URL(raw),
			refer = transfer.searchParams.get('refer');
		const target = refer ? taskURL(refer, TASK_SUMMARY_URLS.examTable) : raw;
		if (!target) {
			warnings.add('平台返回了无效考试入口。');
			continue;
		}
		const url = new URL(target),
			course = courseFor(url, '', courses),
			id = taskId('exam', url, course);
		const state = taskState(status, examStatus + ' ' + timeText);
		if (!state) {
			finished.push(id);
			continue;
		}
		const dates = [...timeText.matchAll(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?/g)];
		const end = dates.length ? Date.parse(dates[dates.length - 1][0].replace(/\s+/, 'T') + '+08:00') : NaN;
		const deadline = Number.isFinite(end) ? end : undefined;
		const finalState = state === 'pending' && deadline !== undefined && deadline <= fetchedAt ? 'expired' : state;
		tasks.push({
			id,
			kind: 'exam',
			state: finalState,
			title,
			course,
			status,
			timeText: '',
			deadline,
			fetchedAt,
			tip: '',
			url:
				finalState === 'expired' ? TASK_SUMMARY_URLS.examTable : examNotes(course, url.searchParams.get('examId') || '')
		});
	}
	const paging = html.match(/Math\.ceil\(\s*(\d+)\s*\/\s*(\d+)\s*\)/);
	const total = paging ? Number(paging[1]) : doc.querySelectorAll('tr.dataTr').length;
	const size = paging ? Number(paging[2]) : Math.max(1, total);
	const pages = Math.ceil(total / size);
	if (!Number.isFinite(pages) || pages > 500 || size < 1) throw new Error('考试汇总分页数量异常。');
	if (/page\.showPage/.test(html) && !paging) warnings.add('考试汇总分页格式变化，请使用完整补查。');
	return {
		tasks,
		finished,
		warnings: [...warnings],
		pages: Math.max(1, pages),
		size,
		signature: Array.from(doc.querySelectorAll('tr.dataTr'))
			.map((row) => row.outerHTML)
			.join('\n')
	};
}

/** Read cross-course summaries directly; never silently start a full course crawl. */
export async function scanPendingTaskSummary(options: TaskScanOptions = {}): Promise<TaskScanReport> {
	const { signal } = options;
	const report: TaskScanReport = {
		tasks: [],
		courseCount: 0,
		completedCourses: 0,
		pagesRead: 0,
		errors: [],
		fetchedAt: Date.now(),
		cancelled: false,
		source: 'summary',
		coverageNotice: '平台汇总可能不包含未开放作业和部分互评任务，需要核对当前学期全部任务时请点“完整补查”。'
	};
	const pending = new Map<string, PendingTask>();
	const publish = () => {
		report.tasks = [...pending.values()];
		report.fetchedAt = Date.now();
		options.onProgress?.({ ...report, tasks: [...report.tasks], errors: [...report.errors] });
	};
	const load = async (url: string) => {
		if (signal?.aborted) throw new Error('已停止读取待办。');
		const text = await (options.loadText
			? options.loadText(url, signal)
			: request(url, {
					type: 'GM_xmlhttpRequest',
					method: 'get',
					responseType: 'text',
					timeout: 15000,
					isCancelled: () => Boolean(signal?.aborted)
			  }));
		if (signal?.aborted) throw new Error('已停止读取待办。');
		if (!/^\s*[\[{]/.test(text)) parseTaskDocument(text);
		return text;
	};
	const error = (name: string, exception: any, url: string) => {
		if (exception instanceof TaskVerificationRequired) report.verificationUrl = url;
		const message = String(exception?.message || exception)
			.replace(/https?:\/\/\S+/g, '(平台地址)')
			.replace(/<[^>]*>/g, '')
			.slice(0, 180);
		report.errors.push({ course: name, message, url });
	};
	let courses: SummaryCourse[] = [];
	try {
		const parsed = parseSummaryCourses(await load(TASK_SUMMARY_URLS.courses));
		if (options.currentTermOnly === false) courses = parsed.courses;
		else {
			const semester = parseCurrentTaskSemester(await load(TASK_SUMMARY_URLS.semester));
			report.semester = semester;
			courses = selectSemesterTaskCourses(parsed.courses, semester);
			report.coverageNotice = taskSemesterScopeNotice(semester) + report.coverageNotice;
		}
		report.courseCount = courses.length;
		if (parsed.hasMore)
			error('科目名称', '课程汇总尚有未读取分页，当前学期的课程可能不完整。', TASK_SUMMARY_URLS.courses);
	} catch (exception) {
		if (!signal?.aborted) error('当前学期课程', exception, TASK_SUMMARY_URLS.semester);
		report.cancelled = Boolean(signal?.aborted);
		publish();
		return report;
	}
	publish();
	for (const kind of ['work', 'exam', 'examTable'] as const) {
		if (signal?.aborted || report.verificationUrl) break;
		const base = TASK_SUMMARY_URLS[kind];
		try {
			let pages = 1,
				size = 12;
			const seenPages = new Set<string>();
			for (let index = 0; index < pages && !signal?.aborted; index++) {
				const url = new URL(base);
				if (index) url.searchParams.set('start', String(index * size));
				const html = await load(url.href);
				const parsed =
					kind === 'examTable' ? parseSummaryExamTable(html, courses) : parseSummaryList(html, kind, courses);
				if (kind === 'examTable') {
					const table = parsed as ReturnType<typeof parseSummaryExamTable>;
					if (table.signature && seenPages.has(table.signature))
						throw new Error('考试汇总分页未切换，请使用完整补查。');
					seenPages.add(table.signature);
					if (!index) {
						pages = table.pages;
						size = table.size;
					}
					for (const id of table.finished) pending.delete(id);
				}
				for (const task of parsed.tasks) {
					if (options.currentTermOnly !== false && !courses.some((course) => course.key === task.course.key)) continue;
					const previous = pending.get(task.id);
					pending.set(task.id, previous?.tip ? { ...task, tip: previous.tip, url: previous.url } : task);
				}
				for (const warning of parsed.warnings) error(kind === 'work' ? '作业汇总' : '考试汇总', warning, base);
				report.pagesRead++;
				publish();
			}
		} catch (exception) {
			if (!signal?.aborted) error(kind === 'work' ? '作业汇总' : '考试汇总', exception, base);
		}
	}
	report.cancelled = Boolean(signal?.aborted);
	publish();
	return report;
}
