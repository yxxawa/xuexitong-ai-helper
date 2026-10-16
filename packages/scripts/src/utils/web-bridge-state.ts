/** Background Chromium tabs may run timers only once a minute. One delayed tick is not a disconnect. */
export const WEB_BRIDGE_MAX_AGE = 3 * 60 * 1000;
export const WEB_BRIDGE_STATE = 'xth.web.bridge.v1';
export const WEB_BRIDGE_WAKE = 'xth.web.wake.v1';
/** Extra waiting budget for explicit rate limits; requests without rate limits retain their configured timeout. */
export const WEB_RATE_LIMIT_MAX_WAIT = 10 * 60 * 1000;

export function wakeWebBridge(): void {
	GM_setValue(WEB_BRIDGE_WAKE, Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
}
