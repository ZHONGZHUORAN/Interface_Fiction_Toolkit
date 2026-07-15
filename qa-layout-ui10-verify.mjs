// qa-layout-ui10-verify.mjs
// 独立复核脚本（与 qa-layout-ui10.mjs 逻辑解耦，使用不同正则写法，避免“同源测试”假通过）。
// 零依赖，仅用 Node 内置 fs。运行： node qa-layout-ui10-verify.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTML_PATH = join(__dirname, 'index.html');
const html = readFileSync(HTML_PATH, 'utf8');

let passed = 0;
let failed = 0;
const failures = [];

function assert(name, cond) {
  if (cond) { passed++; console.log(`  [PASS] ${name}`); }
  else { failed++; failures.push(name); console.log(`  [FAIL] ${name}`); }
}

// 提取一条 CSS 规则（从 选择器{ 到对应的 }，非贪婪）
function cssRule(sel) {
  // sel 形如 '.tcp-avatar'，需转义正则特殊字符
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(esc + '\\{([^}]*)\\}', 'g');
  let m, rules = [];
  while ((m = re.exec(html)) !== null) rules.push(m[1]);
  return rules;
}

const strip = s => s.replace(/\s+/g, ' ');

console.log('== UI10 独立复核（verify）：方形头像 + 群聊昵称 ==\n');

// --- A. 封面预览头像（tcp-*）必须为方形 4px，且无圆形 50% ---
const tcpAvatar = cssRule('.tcp-avatar');
const tcpAvatarImg = cssRule('.tcp-avatar-img');
const tcpAvatarPh = cssRule('.tcp-avatar-ph');

assert('CSS .tcp-avatar 规则存在', tcpAvatar.length > 0);
assert('CSS .tcp-avatar 含 border-radius:4px', tcpAvatar.some(r => /border-radius\s*:\s*4px/.test(r)));
assert('CSS .tcp-avatar 不含 border-radius:50%', !tcpAvatar.some(r => /border-radius\s*:\s*50%/.test(r)));

assert('CSS .tcp-avatar-img 规则存在', tcpAvatarImg.length > 0);
assert('CSS .tcp-avatar-img 含 border-radius:4px', tcpAvatarImg.some(r => /border-radius\s*:\s*4px/.test(r)));
assert('CSS .tcp-avatar-img 不含 border-radius:50%', !tcpAvatarImg.some(r => /border-radius\s*:\s*50%/.test(r)));

assert('CSS .tcp-avatar-ph 规则存在', tcpAvatarPh.length > 0);
assert('CSS .tcp-avatar-ph 含 border-radius:4px', tcpAvatarPh.some(r => /border-radius\s*:\s*4px/.test(r)));
assert('CSS .tcp-avatar-ph 不含 border-radius:50%', !tcpAvatarPh.some(r => /border-radius\s*:\s*50%/.test(r)));

// --- B. 其它圆形头像未被误改，仍保持 50% ---
const coverCircle = cssRule('.cover-circle');
const pvAvatar = cssRule('.pv-avatar');
const pvAvatarPh = cssRule('.pv-avatar-placeholder');

assert('CSS .cover-circle 仍含 border-radius:50%', coverCircle.some(r => /border-radius\s*:\s*50%/.test(r)));
assert('CSS .pv-avatar 仍含 border-radius:50%', pvAvatar.some(r => /border-radius\s*:\s*50%/.test(r)));
assert('CSS .pv-avatar-placeholder 仍含 border-radius:50%', pvAvatarPh.some(r => /border-radius\s*:\s*50%/.test(r)));

// --- C. buildThumbChatPreview 逻辑复核 ---
const fnRe = /function\s+buildThumbChatPreview\s*\(\s*chat\s*\)\s*\{([\s\S]*?)\n\}/;
const fnBodyRaw = (fnRe.exec(html) || [])[1] || '';
const fnBody = strip(fnBodyRaw);

assert('buildThumbChatPreview 函数存在', fnBody.length > 0);
assert("buildThumbChatPreview 含 chat.type==='group' 分支", fnBody.includes("chat.type==='group'"));
assert("buildThumbChatPreview 群聊分支插入 'tcp-name'", fnBody.includes("'tcp-name'"));
// 单聊 else 分支：包含 else 且不出现 tcp-name
assert('buildThumbChatPreview 单聊 else 分支不插入昵称',
  fnBody.includes('else') && !/else[^}]*tcp-name/.test(fnBody));
// 顶部 tcp-head 调用 chatDisplayName(chat)
assert('buildThumbChatPreview 顶部 tcp-head 调用 chatDisplayName(chat)',
  /tcp-head'\s*},\s*chatDisplayName\(chat\)/.test(fnBody) || fnBody.includes("'tcp-head'}, chatDisplayName(chat)"));

console.log(`\n== 独立复核结果：${passed} passed, ${failed} failed ==`);
if (failed > 0) {
  console.log('失败项：\n - ' + failures.join('\n - '));
  process.exit(1);
}
console.log('独立复核全部通过 ✅');
process.exit(0);
