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
console.log('BUILD_PATH: ', distPath);
const distResolvedPath = path.resolve(__dirname, distPath);
process.env.VITE_BUILD_PATH = distResolvedPath;

function cleanOutput() {
	return del([distResolvedPath], { force: true });
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

	/** @return {import('../packages/utils/src').CreateOptions} */
	const createOptions = () => {
		const matchDomains = ['chaoxing.com'];

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
				icon: 'https://raw.githubusercontent.com/yxxawa/xuexitong-ai-helper/main/docs/assets/icon.svg',
				connect: ['*'],
				match: [...matchDomains.map((domain) => `*://*.${domain}/*`), 'https://chat.deepseek.com/*'],
				grant: [
					'GM_info',
					'GM_openInTab',
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
}

/** Keep public update metadata in sync with the version embedded in the release artifact. */
function writeVersionMetadata(done) {
	fs.writeFileSync(
		path.resolve(__dirname, '../version.json'),
		JSON.stringify(
			{
				version,
				tag: `v${version}`,
				releaseUrl: 'https://github.com/yxxawa/xuexitong-ai-helper/releases/latest'
			},
			null,
			2
		) + '\n',
		'utf8'
	);
	done();
}

/** All runtime code and styles are embedded in the one installable userscript. */
async function removeIntermediateBundles() {
	for (const name of ['core.js', 'index.js']) {
		await fs.promises.unlink(path.join(distResolvedPath, name));
	}
}

exports.default = series(cleanOutput, buildPackages, createUserJs, removeIntermediateBundles, writeVersionMetadata);
