// @ts-check

const { series } = require('gulp');
const del = require('del');
const util = require('util');
const { version } = require('../package.json');
const execOut = util.promisify(require('./utils').execOut);
const path = require('path');
const dotenv = require('dotenv');
const fs = require('fs');

dotenv.config();

const distPath = process.env.BUILD_PATH || '../dist';
process.env.VITE_BUILD_PATH = process.env.VITE_BUILD_PATH || '../../dist';
console.log('BUILD_PATH: ', distPath);
const distResolvedPath = path.resolve(__dirname, distPath);

function cleanOutput() {
	return del([distPath, '../lib'], { force: true });
}

async function buildPackages() {
	// @ts-ignore
	await execOut('tsc', { cwd: '../packages/utils' });
	// @ts-ignore
	await execOut('tsc', { cwd: '../packages/core' });
	// @ts-ignore
	await execOut('vite build', { cwd: '../packages/core' });
	// @ts-ignore
	await execOut('tsc', { cwd: '../packages/scripts' });
	// @ts-ignore
	await execOut('vite build', { cwd: '../packages/scripts' });
}

async function createUserJs() {
	const { createUserScript } = require('../packages/utils');

	/** 模拟浏览器环境 */
	require('browser-env')();

	// @ts-ignore
	globalThis.unsafeWindow = {};

	/** @type {import('../packages/scripts/src/index')} */
	// @ts-ignore
	const app = require(path.join(distPath, 'index.js'));

	/** @return {import('../packages/utils/src').CreateOptions} */
	const createOptions = () => {
		const { CXProject } = app;

		const matchDomains = [
			'chaoxing.com',
			'edu.cn',
			'org.cn',
			'xueyinonline.com',
			'hnsyu.net',
			'qutjxjy.cn',
			'ynny.cn',
			'hnvist.cn',
			'fjlecb.cn',
			'gdhkmooc.com',
			'cugbonline.cn',
			'zjelib.cn',
			'cqrspx.cn',
			'neauce.com',
			'zhihui-yun.com',
			'cqie.cn',
			'ccqmxx.com',
			'jxgmxy.com',
			'jnzyjsxy.cn',
			'sslibrary.com'
		];

		return {
			parseRequire: true,
			parseResource: true,
			resourceBuilder: (key, value) => `const ${key} = \`${value}\`;`,
			metaDataFormatter: {
				header: '==UserScript==',
				footer: '==/UserScript==',
				prefix: '// ',
				symbol: '@',
				gap: '\t'.repeat(4)
			},
			metadata: {
				name: '学习通AI辅助插件',
				version: version,
				description: '支持 AI 答题、模型列表、token 统计、章节学习和作业考试。',
				author: 'enncy / modified',
				license: 'MIT',
				namespace: 'https://github.com/yxxawa/xuexitong-ai-helper',
				homepage: 'https://github.com/yxxawa/xuexitong-ai-helper',
				source: 'https://github.com/yxxawa/xuexitong-ai-helper',
				icon: 'https://www.chaoxing.com/favicon.ico',
				connect: ['*'],
				match: matchDomains.map((domain) => `*://*.${domain}/*`),
				grant: [
					'GM_info',
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
				],
				require: [path.join(__dirname, distPath, 'index.js')],
				resource: [`STYLE ${path.join(__dirname, '../packages/scripts/assets/css/style.css')}`],
				'run-at': 'document-start'
			},
			entry: path.join(__dirname, '../packages/scripts/entry.js'),
			dist: path.join(__dirname, distPath, 'xuexitong-ai-helper.user.js')
		};
	};

	const officialOpts = createOptions();
	console.log('CreateUserScript: ', officialOpts.metadata.name, officialOpts.dist);
	await createUserScript(officialOpts);

	/** 创建调试脚本 */
	const devOpts = createOptions();
	devOpts.parseRequire = false;
	devOpts.parseResource = false;
	devOpts.metadata.name = devOpts.metadata.name + '(dev)';
	devOpts.metadata.require = ['file:///' + path.join(distResolvedPath, 'index.js')];
	devOpts.metadata.resource = [`STYLE file:///${path.join(__dirname, '../packages/scripts/assets/css/style.css')}`];
	devOpts.entry = path.join(__dirname, '../packages/scripts/entry.dev.js');
	devOpts.dist = path.join(distResolvedPath, 'xuexitong-ai-helper.dev.user.js');
	/** 导出样式文件 */
	fs.copyFileSync(
		path.join(__dirname, '../packages/scripts/assets/css/style.css'),
		path.join(distResolvedPath, 'style.css')
	);
	console.log('createUserScript: ', devOpts.metadata.name, devOpts.dist);
	await createUserScript(devOpts);

	/** 创建全Connect域名通用脚本 */
	const commonOpts = createOptions();
	const connect = Array.isArray(commonOpts.metadata.connect) ? commonOpts.metadata.connect : [];
	commonOpts.metadata.connect = connect;
	commonOpts.entry = path.join(__dirname, '../packages/scripts/entry.common.js');
	commonOpts.dist = path.join(distResolvedPath, 'xuexitong-ai-helper.common.user.js');

	console.log('createUserScript: ', commonOpts.metadata.name, commonOpts.dist);
	await createUserScript(commonOpts);
}

exports.default = series(cleanOutput, buildPackages, createUserJs);
