import { $ } from '../../utils/common';

function httpError(status: number, body: any) {
	const text = typeof body === 'string' ? body : JSON.stringify(body);
	const error = new Error('HTTP ' + status + ': ' + (text || '请求失败'));
	return Object.assign(error, { status, response: body });
}

/** Shared transport: reject HTTP errors and always bound network waits. */
export async function request<T extends 'json' | 'text'>(
	url: string,
	opts: {
		type: 'fetch' | 'GM_xmlhttpRequest';
		method?: 'get' | 'post' | 'head';
		responseType?: T;
		headers?: Record<string, string>;
		data?: Record<string, any>;
		timeout?: number;
	}
): Promise<T extends 'json' ? any : string> {
	const { responseType = 'json', method = 'get', type = 'fetch', data = {}, headers = {}, timeout = 60000 } = opts;
	const contentType = headers['Content-Type'] || headers['content-type'];
	const body =
		contentType === 'application/x-www-form-urlencoded'
			? new URLSearchParams(data).toString()
			: Object.keys(data).length
			? JSON.stringify(data)
			: undefined;
	if (type === 'GM_xmlhttpRequest' && $.isInBrowser()) {
		return new Promise((resolve, reject) => {
			if (typeof GM_xmlhttpRequest === 'undefined') {
				reject(new Error('GM_xmlhttpRequest is not defined'));
				return;
			}
			GM_xmlhttpRequest({
				url,
				method: method.toUpperCase() as 'GET' | 'HEAD' | 'POST',
				data: method === 'post' ? body : undefined,
				headers,
				responseType: responseType === 'json' ? 'json' : undefined,
				timeout,
				onload: (response) => {
					if (response.status < 200 || response.status >= 300) {
						reject(httpError(response.status, response.response ?? response.responseText));
						return;
					}
					try {
						resolve(
							responseType === 'json'
								? response.response && typeof response.response === 'object'
									? response.response
									: JSON.parse(response.responseText || 'null')
								: response.responseText || ''
						);
					} catch {
						reject(new Error('接口没有返回有效的 JSON，请检查接口地址。'));
					}
				},
				onerror: () => reject(new Error('网络请求失败，请检查网络、接口地址及脚本管理器的连接权限。')),
				ontimeout: () => reject(new Error('请求超时，请重试或调整 AI 超时时间。')),
				onabort: () => reject(new Error('请求已取消。'))
			});
		});
	}
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeout);
	try {
		const fetcher: typeof fetch = $.isInBrowser() ? fetch : require('node-fetch');
		const response = await fetcher(url, {
			body: method === 'post' ? body : undefined,
			method: method.toUpperCase(),
			headers,
			signal: controller.signal
		});
		const text = await response.text();
		if (!response.ok) throw httpError(response.status, text);
		return responseType === 'json' ? JSON.parse(text || 'null') : text;
	} finally {
		clearTimeout(timer);
	}
}
