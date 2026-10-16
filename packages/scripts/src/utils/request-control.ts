/** Functions stay in the owning frame; only the paused flag crosses the web mailbox. */
export interface AIRequestControl {
	retryEmptyContent?: boolean;
	isCancelled?: () => boolean;
	isPaused?: () => boolean;
	waitUntilReady?: () => Promise<void>;
}
export async function waitForAI(control: AIRequestControl = {}) {
	await control.waitUntilReady?.();
	while (control.isPaused?.() && !control.isCancelled?.()) await new Promise((resolve) => setTimeout(resolve, 100));
	if (control.isCancelled?.()) throw new Error('请求已取消。');
}
