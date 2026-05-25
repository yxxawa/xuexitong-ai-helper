import { CommonProject } from '../projects/common';

export const $render = {
	/**
	 * 移动到边缘
	 */
	moveToEdge(x = 80, y = 100) {
		CommonProject.scripts.render.methods.minimize();
		CommonProject.scripts.render.methods.setPosition(x, y);
	}
};
