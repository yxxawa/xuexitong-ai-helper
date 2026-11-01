import { valid, gt, prerelease } from 'semver';
import { request } from '@xuexitong-ai-helper/core/src/core/utils/request';

export const LATEST_RELEASE_URL = 'https://github.com/yxxawa/xuexitong-ai-helper/releases/latest';
export const VERSION_SOURCES = [
	'https://cdn.jsdelivr.net/gh/yxxawa/xuexitong-ai-helper@main/version.json',
	'https://raw.githubusercontent.com/yxxawa/xuexitong-ai-helper/main/version.json',
	'https://api.github.com/repos/yxxawa/xuexitong-ai-helper/releases/latest'
];
const STORE_KEY = 'xth.release-check.v1';
const CACHE_AGE = 30 * 60 * 1000;
const FAILURE_AGE = 5 * 60 * 1000;
interface VersionRecord {
	version?: string;
	checkedAt: number;
	success: boolean;
}
let memory: VersionRecord | undefined;
let pending: Promise<string | undefined> | undefined;

export function installedVersion() {
	try {
		return valid(typeof GM_info === 'undefined' ? '' : GM_info.script.version) || undefined;
	} catch {
		return undefined;
	}
}
export function releaseVersion(value: any): string | undefined {
	if (!value || typeof value !== 'object' || value.draft || value.prerelease) return;
	const version = valid(value.version || value.tag_name || '');
	return version && !prerelease(version) ? version : undefined;
}
function storedVersion(): VersionRecord | undefined {
	try {
		const value: any = typeof GM_getValue === 'function' ? GM_getValue(STORE_KEY) : memory;
		if (
			value &&
			Number.isFinite(value.checkedAt) &&
			typeof value.success === 'boolean' &&
			(!value.version || releaseVersion({ version: value.version }))
		)
			return value;
	} catch {
		/* Keep a memory fallback if script storage is unavailable. */
	}
	return memory;
}
/** Public version metadata only; never attach course details, API keys or GitHub credentials. */
export function checkLatestVersion(): Promise<string | undefined> {
	const cached = storedVersion(),
		now = Date.now(),
		current = installedVersion();
	const age = cached ? now - cached.checkedAt : Infinity;
	if (
		cached &&
		age >= 0 &&
		age < (cached.success ? CACHE_AGE : FAILURE_AGE) &&
		(!cached.success || !current || !cached.version || !gt(current, cached.version))
	)
		return Promise.resolve(cached.version);
	if (pending) return pending;
	const task = (async () => {
		const results = await Promise.allSettled(
			VERSION_SOURCES.map(async (url) => {
				const value = await request(url, {
					type: 'GM_xmlhttpRequest',
					method: 'get',
					responseType: 'json',
					timeout: 5000
				});
				const version = releaseVersion(value);
				if (!version) throw new Error('Invalid release metadata');
				return version;
			})
		);
		let latest = cached?.version,
			success = false;
		for (const result of results)
			if (result.status === 'fulfilled') {
				success = true;
				if (!latest || gt(result.value, latest)) latest = result.value;
			}
		memory = { version: latest, checkedAt: Date.now(), success };
		try {
			if (typeof GM_setValue === 'function') GM_setValue(STORE_KEY, memory);
		} catch {
			/* Optional cache. */
		}
		return latest;
	})();
	pending = task;
	void task.finally(() => {
		if (pending === task) pending = undefined;
	});
	return task;
}
export function versionLinkText(current: string | undefined, latest?: string) {
	if (!current) return '版本未知';
	return latest && gt(latest, current) ? `v${current} → v${latest}` : `v${current}`;
}
