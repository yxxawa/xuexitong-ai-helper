import { StudyControl } from './study';

/** Native controls also work when the panel lives in another frame. */
export function createStudyControls(control: StudyControl, restart: () => void, doc: Document = document) {
	const root = doc.createElement('div');
	root.className = 'study-controls';
	const status = doc.createElement('div');
	status.setAttribute('role', 'status');
	status.style.cssText = 'margin-bottom:8px;white-space:pre-wrap';
	const pause = doc.createElement('button');
	const stop = doc.createElement('button');
	const retry = doc.createElement('button');
	pause.type = stop.type = retry.type = 'button';
	stop.textContent = '停止学习'; retry.textContent = '重试当前页面';
	const history = doc.createElement('details'), summary = doc.createElement('summary'), log = doc.createElement('pre');
	summary.textContent = '最近运行记录';
	log.style.cssText = 'max-height:180px;overflow:auto;white-space:pre-wrap;font-size:12px';
	history.append(summary, log);
	root.append(status, pause, stop, retry, history);
	for (const button of [pause, stop, retry]) button.style.cssText = 'margin:0 6px 8px 0;cursor:pointer';
	pause.onclick = () => control.paused ? control.resume() : control.pause();
	stop.onclick = () => control.stop();
	retry.onclick = () => { retry.disabled = true; root.remove(); restart(); };
	const render = () => {
		root.dataset.phase = control.phase;
		const terminal = ['done', 'error', 'stopped'].includes(control.phase);
		status.textContent = control.paused && !terminal ? '学习已暂停，点击继续后恢复' : control.detail;
		pause.textContent = control.paused ? '继续学习' : '暂停学习';
		pause.disabled = stop.disabled = terminal;
		retry.hidden = control.phase !== 'error' && control.phase !== 'stopped';
		log.textContent = control.history.join('\n');
	};
	control.subscribe(render); render();
	return root;
}

/** Keep event handlers in the owning frame; message forwarding serializes away callbacks. */
export function mountStudyControls(control: StudyControl, restart: () => void) {
	let owner = document;
	try { owner = window.top?.document || document; } catch { /* Use the task frame if its parent is cross-origin. */ }
	for (const old of Array.from(owner.querySelectorAll('.study-controls[data-study-session]'))) {
		if (['done', 'error', 'stopped'].includes((old as HTMLElement).dataset.phase || '')) old.remove();
	}
	const root = createStudyControls(control, restart, owner);
	root.dataset.studySession = 'true';
	root.setAttribute('aria-label', '课程学习控制');
	root.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483646;box-sizing:border-box;width:340px;max-width:calc(100vw - 40px);max-height:50vh;overflow:auto;padding:14px;border:1px solid #d4d4d4;border-radius:10px;background:#fff;color:#222;box-shadow:0 4px 20px #0002;font:14px/1.5 sans-serif';
	(owner.body || owner.documentElement).append(root);
	window.addEventListener('pagehide', () => root.remove(), { once: true });
	return root;
}
