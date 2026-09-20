/** Process the current page first (even when there is no Next button), and never process an unchanged page twice. */
export async function runQuestionPages(options: {
	closed(): boolean;
	identity(): string;
	answer(): Promise<void>;
	next(): HTMLElement | null;
	wait(ms: number): Promise<unknown>;
	transitionTimeout?: number;
}) {
	const seen = new Set<string>();
	while (!options.closed()) {
		const before = options.identity();
		if (!before || seen.has(before)) throw new Error('题目未加载或翻页未成功，已停止以避免重复请求。');
		seen.add(before);
		await options.answer();
		if (options.closed()) return;
		const next = options.next();
		if (!next || next.matches(':disabled,[disabled],[aria-disabled="true"],.disabled') || next.hidden) return;
		next.click();
		const deadline = Date.now() + (options.transitionTimeout ?? 15000);
		let changed = false;
		while (!options.closed() && Date.now() < deadline) {
			await options.wait(200);
			const current = options.identity();
			if (current && current !== before) {
				// A brief stability check avoids reading half-replaced asynchronous question DOM.
				await options.wait(350);
				if (current === options.identity()) {
					changed = true;
					break;
				}
			}
		}
		if (!changed && !options.closed()) throw new Error('翻页后题目没有变化，已停止；请检查页面后手动继续。');
	}
}
