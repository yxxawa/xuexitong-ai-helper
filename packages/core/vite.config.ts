import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';
import banner from 'vite-plugin-banner';
import { author, description, homepage, license, name } from '../../package.json';
import dotenv from 'dotenv';
import path from 'path';

const bannerContent = `
/*!
 * ${name} ( ${homepage} )
 * ${description}
 * copyright ${author}
 * license ${license}
 */
`;

dotenv.config();

const easyUsPath = path.resolve(__dirname, '../../node_modules/easy-us').replace(/\\/g, '/');

// https://vitejs.dev/config/
export default defineConfig({
	resolve: {
		alias: [
			{ find: /^easy-us$/, replacement: `${easyUsPath}/lib/index.js` },
			{ find: /^easy-us\/(.+)$/, replacement: `${easyUsPath}/$1` }
		],
		dedupe: ['easy-us']
	},
	esbuild: {
		keepNames: true
	},
	build: {
		/** 取消css代码分离 */
		cssCodeSplit: false,
		/** 输出路径 */
		outDir: process.env.VITE_BUILD_PATH,
		/** 清空输出路径 */
		emptyOutDir: false,
		/** 是否压缩代码 */
		minify: true,
		/** 打包库， 全局名字为 XuexitongAIHelper */
		lib: {
			entry: './src/index.ts',
			name: 'XuexitongAIHelper',
			fileName: () => 'core.js',
			formats: ['umd']
		}
	},

	plugins: [visualizer(), banner(bannerContent)]
});
