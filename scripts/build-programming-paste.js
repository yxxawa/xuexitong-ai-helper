const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { version } = require('../package.json');

/** Build a small, self-contained paste helper from the same source as the full userscript. */
module.exports = function buildProgrammingPaste(outDir = path.resolve(__dirname, '../dist')) {
	const source = path.resolve(__dirname, '../packages/scripts/src/utils/programming.ts');
	const code = ts.transpileModule(fs.readFileSync(source, 'utf8'), {
		fileName: source,
		compilerOptions: {
			target: ts.ScriptTarget.ES2018,
			module: ts.ModuleKind.CommonJS,
			removeComments: false
		}
	}).outputText;
	const header = [
		'// ==UserScript==',
		'// @name 学习通程序题粘贴助手',
		'// @namespace xuexitong-ai-helper/programming-paste',
		'// @version ' + version,
		'// @description 为 CodeMirror 程序题保留缩进地粘贴代码，不需要读取剪贴板权限。',
		'// @match *://*.chaoxing.com/*',
		'// @grant unsafeWindow',
		'// @run-at document-idle',
		'// ==/UserScript=='
	].join('\n');
	const output =
		header +
		'\n(() => {\nconst exports = {};\n' +
		code +
		'\nexports.watchProgrammingPaste(document, typeof unsafeWindow === "undefined" ? window : unsafeWindow);\n})();\n';
	fs.mkdirSync(outDir, { recursive: true });
	const target = path.join(outDir, 'chaoxing-programming-paste.user.js');
	fs.writeFileSync(target, output, 'utf8');
	console.log('Created programming paste helper: ' + target);
	return target;
};
if (require.main === module) module.exports();
