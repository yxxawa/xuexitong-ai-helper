const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
exports.loadTS = function loadTS(entry, mocks = {}) {
	const cache = new Map();
	function load(filename) {
		if (cache.has(filename)) return cache.get(filename).exports;
		const module = { exports: {} };
		cache.set(filename, module);
		const requireFromFile = createRequire(filename);
		const localRequire = (id) => {
			if (Object.hasOwn(mocks, id)) return mocks[id];
			let target;
			if (id.startsWith('.')) target = path.resolve(path.dirname(filename), id);
			else if (id.startsWith('@xuexitong-ai-helper/core/'))
				target = path.join(root, 'packages/core', id.slice('@xuexitong-ai-helper/core/'.length));
			if (target) {
				for (const candidate of [target + '.ts', path.join(target, 'index.ts')])
					if (fs.existsSync(candidate)) return load(candidate);
			}
			return requireFromFile(id);
		};
		const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
			compilerOptions: {
				target: ts.ScriptTarget.ES2020,
				module: ts.ModuleKind.CommonJS,
				esModuleInterop: true
			},
			fileName: filename
		}).outputText;
		new Function('require', 'module', 'exports', '__filename', '__dirname', code)(
			localRequire,
			module,
			module.exports,
			filename,
			path.dirname(filename)
		);
		return module.exports;
	}
	return load(path.resolve(root, entry));
};
