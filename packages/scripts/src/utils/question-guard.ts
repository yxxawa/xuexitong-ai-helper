import { cxQuestionTypeInput } from './cx-question';

/** Read partial answers too: a single checked box or one edited blank must be preserved. */
function answerState(root: HTMLElement) {
	const controls = Array.from(
		root.querySelectorAll<HTMLElement>(
			'input:not([type="hidden"]),textarea,select,[contenteditable="true"],iframe,input[name^="answer"],input[id^="answer"]'
		)
	)
		.filter(
			(element) =>
				!element.closest(
					'.edui-toolbar,.edui-editor-toolbarbox,.CodeMirror,.ace_editor,.monaco-editor,.xth-answer-review'
				) && !/answertype/i.test(element.id + (element.getAttribute('name') || ''))
		)
		.map((element) => {
			if (element.tagName === 'IFRAME') {
				try {
					return (element as HTMLIFrameElement).contentDocument?.body?.textContent || '';
				} catch {
					return '';
				}
			}
			if (element.matches('[contenteditable="true"]')) return element.textContent || '';
			const input = element as HTMLInputElement;
			return [
				input.id,
				input.name,
				input.value,
				input.type === 'checkbox' || input.type === 'radio' ? input.checked : undefined
			];
		});
	const nodes = Array.from(root.querySelectorAll('*'));
	const checked = nodes.flatMap((element, index) =>
		element.matches('[aria-checked="true"],[class*="check_answer"]') ? [index] : []
	);
	return JSON.stringify([controls, checked]);
}

/** Separate question identity from answer state so our own writes do not invalidate the question. */
export function createQuestionWriteGuard(root: HTMLElement, describe: () => unknown) {
	const identity = () => {
		const inputs = Array.from(root.querySelectorAll<HTMLInputElement>('input'));
		const typeInput = cxQuestionTypeInput(inputs);
		return JSON.stringify([
			root.id,
			root.getAttribute('data-questionid'),
			inputs
				.filter((input) => input === typeInput || /questionid|question_id/i.test(input.name + ' ' + input.id))
				.map((input) => [input.name, input.id, input.value]),
			describe()
		]);
	};
	const question = identity();
	const answer = answerState(root);
	const assertQuestion = () => {
		if (!root.isConnected || identity() !== question)
			throw new Error('题目、题型或选项已变化，未写入旧答案，请重新读取题目。');
	};
	return {
		assertQuestion,
		assertAnswerUnchanged() {
			assertQuestion();
			if (answerState(root) !== answer)
				throw new Error('等待答案期间页面作答已被手动修改，已保留当前答案，请重新读取题目。');
		}
	};
}
