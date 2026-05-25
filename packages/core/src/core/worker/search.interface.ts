/** 题目答案 */
export interface Result {
	question: string;
	answer: string;
	extra_data?: object;
}

/** 搜题返回信息 */
export interface SearchInformation {
	results: Result[];
	name: string;
	url?: string;
	/** 主页 */
	homepage?: string;
	/** 请求响应内容 */
	response?: any;
	/** 请求发起内容 */
	data?: any;
	/** 错误数据 */
	error?: string;
}

