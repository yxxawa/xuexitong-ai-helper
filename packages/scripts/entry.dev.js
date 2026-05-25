/* eslint-disable no-undef */
/// <reference path="./global.d.ts" />

// 环境检测
if (
	[
		'GM_getTab',
		'GM_saveTab',
		'GM_setValue',
		'GM_getValue',
		'unsafeWindow',
		'GM_listValues',
		'GM_deleteValue',
		'GM_notification',
		'GM_xmlhttpRequest',
		'GM_getResourceText',
		'GM_addValueChangeListener',
		'GM_removeValueChangeListener'
	].some((api) => typeof Reflect.get(globalThis, api) === 'undefined')
) {
	const open = confirm(
		`当前脚本不支持当前的脚本管理器（${GM_info.scriptHandler}）。` +
			'请安装或切换到支持完整 GM_* API 的脚本管理器，例如 “Scriptcat 脚本猫” 或者 “Tampermonkey 油猴”。'
	);

	if (open) {
		window.open('https://www.tampermonkey.net/', '_blank');
	}
	return;
}

const { start, definedProjects, CommonProject, RenderScript } = XuexitongAIHelper;

const infos = GM_info;

(function () {
	'use strict';

	const projects = definedProjects();

	// 运行脚本
	start({
		projects: projects,
		renderConfig: {
			renderScript: RenderScript,
			styles: [GM_getResourceText('STYLE')],
			defaultPanelName: CommonProject.scripts.guide.namespace,
			title: `学习通AI辅助插件 DEV-${infos.script.version}`
		}
	});
})();
