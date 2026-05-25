import { createRenderScript } from 'easy-us';

export const RenderScript = createRenderScript({
	name: '窗口'
});

RenderScript.onstart = function () {
	if (this.cfg.visual === 'hidden') {
		this.cfg.visual = 'normal';
	}
};
