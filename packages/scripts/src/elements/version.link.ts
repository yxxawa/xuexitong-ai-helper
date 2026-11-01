import { checkLatestVersion, installedVersion, LATEST_RELEASE_URL, versionLinkText } from '../utils/update-check';

export function createVersionLink() {
	const link = document.createElement('a');
	const current = installedVersion();
	link.className = 'home-version-link';
	link.href = LATEST_RELEASE_URL;
	link.target = '_blank';
	link.rel = 'noopener noreferrer';
	link.textContent = versionLinkText(current);
	link.title = '打开最新 Release';
	void checkLatestVersion()
		.then((latest) => {
			if (!link.isConnected) return;
			link.textContent = versionLinkText(current, latest);
			link.classList.toggle('has-update', link.textContent.includes('→'));
		})
		.catch(() => {
			/* Update checking must never interrupt normal use. */
		});
	return link;
}
