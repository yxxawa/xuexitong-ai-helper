import type { PendingTask, TaskScanReport } from './pending-tasks';

const CACHE_PREFIX = 'xth.pending-tasks.v1:';
const memory = new Map<string, TaskScanReport>();

/** Share a user's cache across Chaoxing pages, keeping different signed-in users separate. */
export function pendingTaskCacheScope() {
	const user = document.cookie.match(/(?:^|;\s*)_uid=([^;]+)/)?.[1];
	return user ? 'user:' + user : 'origin:' + location.origin;
}

function validTask(value: any): value is PendingTask {
	return (
		value &&
		typeof value.id === 'string' &&
		['work', 'exam', 'review'].includes(value.kind) &&
		['pending', 'upcoming', 'expired'].includes(value.state) &&
		['title', 'status', 'url', 'timeText', 'tip'].every((key) => typeof value[key] === 'string') &&
		Number.isFinite(value.fetchedAt) &&
		(value.deadline === undefined || Number.isFinite(value.deadline)) &&
		(value.remainingUntil === undefined || Number.isFinite(value.remainingUntil)) &&
		(value.desktopWorkId === undefined || typeof value.desktopWorkId === 'string') &&
		value.course &&
		['key', 'name', 'url'].every((key) => typeof value.course[key] === 'string') &&
		typeof value.course.closed === 'boolean'
	);
}

export function completeTaskReport(report: TaskScanReport) {
	return !report.cancelled && !report.errors.length && !report.verificationUrl;
}

export function readPendingTaskCache(scope: string): TaskScanReport | undefined {
	try {
		const key = CACHE_PREFIX + scope;
		const value: any =
			typeof GM_getValue === 'function'
				? GM_getValue(key)
				: JSON.parse(window.localStorage.getItem(key) || 'null');
		const report = value?.version === 1 ? value.report : undefined;
		if (
			report &&
			Array.isArray(report.tasks) &&
			report.tasks.every(validTask) &&
			Array.isArray(report.errors) &&
			['courseCount', 'completedCourses', 'pagesRead', 'fetchedAt'].every((key) => Number.isFinite(report[key])) &&
			report.cancelled === false &&
			(report.source === undefined || ['summary', 'courses'].includes(report.source)) &&
			(!report.semester || ['id', 'number', 'name'].every((key) => typeof report.semester[key] === 'string')) &&
			completeTaskReport(report)
		) {
			memory.set(scope, report);
			return report;
		}
	} catch {
		// Storage may be disabled or contain an older cache; the live view still works.
	}
	return memory.get(scope);
}

export function writePendingTaskCache(scope: string, report: TaskScanReport) {
	if (!completeTaskReport(report)) return;
	memory.set(scope, report);
	try {
		const key = CACHE_PREFIX + scope;
		const value = { version: 1, report };
		if (typeof GM_setValue === 'function') GM_setValue(key, value);
		else window.localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Keep the in-memory snapshot when persistent storage is unavailable.
	}
}

/** Fetch timestamps, response order and minute-rounded countdown text are not task changes. */
export function samePendingTask(a: PendingTask, b: PendingTask) {
	const fields = (task: PendingTask) => [
		task.id,
		task.kind,
		task.state,
		task.title,
		task.status,
		task.url,
		task.desktopWorkId,
		task.tip,
		task.course.key,
		task.course.name,
		task.course.url,
		task.course.closed,
		Boolean(task.course.semesterUnassigned),
		task.deadline,
		task.deadline === undefined && task.remainingUntil === undefined ? task.timeText : undefined
	];
	if (JSON.stringify(fields(a)) !== JSON.stringify(fields(b))) return false;
	if (a.deadline !== undefined) return true;
	if (a.remainingUntil === undefined || b.remainingUntil === undefined) return a.remainingUntil === b.remainingUntil;
	return Math.abs(a.remainingUntil - b.remainingUntil) < 60000;
}

export function sameTaskReport(a: TaskScanReport, b: TaskScanReport) {
	const metadata = (report: TaskScanReport) => [
		report.source,
		report.courseCount,
		report.completedCourses,
		report.pagesRead,
		report.cancelled,
		report.verificationUrl,
		report.coverageNotice,
		report.semester?.id,
		report.semester?.number,
		report.semester?.name,
		report.errors
	];
	if (a.tasks.length !== b.tasks.length || JSON.stringify(metadata(a)) !== JSON.stringify(metadata(b))) return false;
	const previous = new Map(a.tasks.map((task) => [task.id, task]));
	return b.tasks.every((task) => {
		const cached = previous.get(task.id);
		return cached !== undefined && samePendingTask(cached, task);
	});
}
