// 問 AI 用的 MCP 伺服器（stdio）：claude -p 用 --mcp-config 開它。
// 自己不讀任何檔案：工具清單和每一次呼叫都轉給本機的特選紀錄伺服器（POST /api/ai/tool），
// 帶這一次回答專用的 token（伺服器只在那一次回答進行中、而且是本機來的才收）。
'use strict';
const BASE = String(process.env.TRACKER_URL || '').replace(/\/+$/, '');
const TOKEN = String(process.env.TRACKER_TOKEN || '');

async function call(body) {
  const r = await fetch(`${BASE}/api/ai/tool`, {method: 'POST', headers: {'content-type': 'application/json', 'x-client': '3', 'x-ai-token': TOKEN}, body: JSON.stringify(body)});
  let j = null;
  try { j = await r.json(); } catch { /* not json */ }
  if (!r.ok) throw new Error((j && j.error) || `HTTP ${r.status}`);
  return j;
}
const send = m => process.stdout.write(JSON.stringify(m) + '\n');
async function handle(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { send({jsonrpc: '2.0', id: null, error: {code: -32700, message: 'Parse error'}}); return; }
  const {id, method, params} = msg || {};
  if (id === undefined || id === null) return; // 通知（notifications/initialized…）不用回
  try {
    if (method === 'initialize') return send({jsonrpc: '2.0', id, result: {protocolVersion: (params && params.protocolVersion) || '2025-06-18', capabilities: {tools: {}}, serverInfo: {name: 'tracker', version: '1.0.0'}}});
    if (method === 'ping') return send({jsonrpc: '2.0', id, result: {}});
    if (method === 'tools/list') { const r = await call({op: 'list'}); return send({jsonrpc: '2.0', id, result: {tools: r.tools}}); }
    if (method === 'tools/call') {
      try {
        const r = await call({op: 'call', name: params && params.name, input: (params && params.arguments) || {}});
        return send({jsonrpc: '2.0', id, result: {content: [{type: 'text', text: String(r.text || '')}], isError: !!r.isError}});
      } catch (e) {
        return send({jsonrpc: '2.0', id, result: {content: [{type: 'text', text: `查詢失敗：${e.message}`}], isError: true}});
      }
    }
    send({jsonrpc: '2.0', id, error: {code: -32601, message: 'Method not found'}});
  } catch (e) {
    send({jsonrpc: '2.0', id, error: {code: -32603, message: e.message}});
  }
}
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) handle(line); }
});
process.stdin.on('end', () => process.exit(0));
