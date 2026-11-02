// 問 AI 的回答：很小的 Markdown（段落、列點、粗體、程式碼、連結）。先跳脫 HTML，連結只收 https、簡章 PDF 頁和站內學校頁。
// 純函式（沒有 DOM），test/ai.test.mjs 直接測。
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const SAFE_LINK = /^(https?:\/\/[^\s"'<>]+|\/data\/brochures\/pdf\/[\w-]+\.pdf(#page=\d+)?|#schools\/[\w.~:@+-]+)$/;
// 粗體只套在一般文字上（連結的網址裡有 ** 也不會被改）
const bold = h => h.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
function inline(s) {
  const out = [];
  // 先切出 `程式碼`，其餘的再處理連結、粗體
  for (const [i, part] of s.split(/(`[^`\n]+`)/).entries()) {
    if (i % 2) { out.push(`<code>${esc(part.slice(1, -1))}</code>`); continue; }
    let last = 0;
    const re = /\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)|(https?:\/\/[^\s<>()（）「」，。]+)/g;
    for (let m; (m = re.exec(part));) {
      out.push(bold(esc(part.slice(last, m.index))));
      const label = m[1] !== undefined ? m[1] : m[3], url = m[1] !== undefined ? m[2] : m[3];
      if (SAFE_LINK.test(url)) {
        const ext = !url.startsWith('#');
        out.push(`<a class="link${ext ? ' ext' : ''}" href="${esc(url)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${bold(esc(label))}</a>`);
      } else out.push(bold(esc(m[0])));
      last = m.index + m[0].length;
    }
    out.push(bold(esc(part.slice(last))));
  }
  return out.join('');
}
export function renderMd(src) {
  const lines = String(src || '').replace(/\r/g, '').split('\n');
  let html = '', para = [], items = null, ordered = false, code = null;
  const flushP = () => { if (para.length) { html += `<p>${para.map(inline).join('<br>')}</p>`; para = []; } };
  const flushL = () => { if (items) { html += `<${ordered ? 'ol' : 'ul'}>${items.map(x => `<li>${inline(x)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`; items = null; } };
  for (const line of lines) {
    if (code !== null) { if (/^\s*```/.test(line)) { html += `<pre>${esc(code.join('\n'))}</pre>`; code = null; } else code.push(line); continue; }
    if (/^\s*```/.test(line)) { flushP(); flushL(); code = []; continue; }
    const li = /^\s*(?:[-*•]|(\d+)[.)、])\s+(.*)$/.exec(line);
    if (li) {
      flushP();
      const ol = li[1] !== undefined;
      if (items && ol !== ordered) flushL();
      if (!items) { items = []; ordered = ol; }
      items.push(li[2]);
      continue;
    }
    if (!line.trim()) { flushP(); flushL(); continue; }
    const h = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (h) { flushP(); flushL(); html += `<p><strong>${inline(h[1])}</strong></p>`; continue; }
    if (items && /^\s{2,}\S/.test(line)) { items[items.length - 1] += ' ' + line.trim(); continue; }
    flushL();
    para.push(line.replace(/^\s*>\s?/, ''));
  }
  if (code !== null) html += `<pre>${esc(code.join('\n'))}</pre>`;
  flushP(); flushL();
  return html;
}

