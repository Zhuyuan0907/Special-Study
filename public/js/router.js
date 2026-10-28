// 畫面切換：本週 / 學校 / 備審 / 行事曆 / 找科系。網址列的 # 會跟著變，重新整理會回到同一個畫面。
const handlers = new Set();
export const VIEWS = ['week', 'schools', 'docs', 'calendar', 'finder'];
export const route = {view: 'week', params: {}};
export function onView(fn) { handlers.add(fn); }
export function go(view, params = {}) {
  if (!VIEWS.includes(view)) view = 'week';
  route.view = view;
  route.params = params;
  const hash = '#' + view + (params.id ? '/' + encodeURIComponent(params.id) : '') + (params.q ? '?q=' + encodeURIComponent(params.q) : '');
  if (location.hash !== hash) history.replaceState(null, '', hash);
  for (const fn of handlers) fn(view, params);
}
export function fromHash() {
  const m = /^#(\w+)(?:\/([^?]+))?(?:\?q=(.*))?$/.exec(location.hash || '');
  if (!m || !VIEWS.includes(m[1])) return {view: 'week', params: {}};
  const params = {};
  if (m[2]) params.id = decodeURIComponent(m[2]);
  if (m[3]) params.q = decodeURIComponent(m[3]);
  return {view: m[1], params};
}
