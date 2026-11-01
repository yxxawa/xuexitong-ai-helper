import type { TaskCourse, TaskSemester } from './pending-tasks';

export const TASK_COURSES_URL = 'https://mooc1-api.chaoxing.com/mycourse/backclazzdata?view=json&mcode=';

export interface SummaryCourse extends TaskCourse {
	courseId: string;
	classId: string;
	cpi: string;
	sectionId?: string;
}
export function parseSummaryCourses(text: string) {
	let data: any;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error('课程汇总没有返回有效数据，请确认已登录学习通。');
	}
	if (![true, 1].includes(data?.result) || !Array.isArray(data.channelList))
		throw new Error('课程汇总读取失败，请确认已登录学习通。');
	const courses: SummaryCourse[] = [];
	for (const item of data.channelList) {
		const content = item?.content;
		if (!Array.isArray(content?.course?.data) || (content.roletype !== undefined && Number(content.roletype) !== 3))
			continue;
		for (const course of content.course.data) {
			const courseId = String(course.id || ''),
				classId = String(content.id || ''),
				cpi = String(item.cpi || content.cpi || '');
			if (!/^\d+$/.test(courseId) || !/^\d+$/.test(classId) || !course.name) continue;
			const url = new URL('https://mooc1.chaoxing.com/visit/stucoursemiddle');
			for (const [key, value] of Object.entries({ courseid: courseId, clazzid: classId, cpi, ismooc2: '1' }))
				url.searchParams.set(key, value);
			courses.push({
				key: [courseId, classId, cpi].join(':'),
				name: String(course.name),
				url: url.href,
				closed: Number(content.state) === 1,
				courseId,
				classId,
				cpi,
				sectionId: String(course.sectionId || '')
			});
		}
	}
	return { courses, hasMore: data.hasMore === true };
}

/** An unassigned course is not evidence of a historical enrollment (electives commonly have no term). */
export function selectSemesterTaskCourses(courses: SummaryCourse[], semester: TaskSemester): SummaryCourse[] {
	return courses
		.filter(
			(course) => !course.closed && (!course.sectionId || course.sectionId === '0' || course.sectionId === semester.id)
		)
		.map((course) => ({ ...course, semesterUnassigned: !course.sectionId || course.sectionId === '0' }));
}

export function taskSemesterScopeNotice(semester: TaskSemester) {
	return semester.name + '课程及未设置学期的未结课课程（含选修）；排除明确属于往年或已结课的课程。';
}
