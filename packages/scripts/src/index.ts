import { Project } from 'easy-us';
import { CommonProject } from './projects/common';
import { CXProject } from './projects/cx';

/** 导出启动函数，以及全局对象 */
export { start, $elements, $store } from 'easy-us';
export { CommonProject } from './projects/common';
export { CXProject } from './projects/cx';
export { RenderScript } from './render';

export function definedProjects(): Project[] {
	return [CXProject, CommonProject];
}
