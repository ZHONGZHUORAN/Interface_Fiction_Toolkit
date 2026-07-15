// qa-layout-ui10.mjs
// 静态断言测试：论坛体/捡手机文学单文件 HTML 编辑器 —— 头像方形修正 + 群聊昵称逻辑校验
// 零依赖，仅使用 Node.js 内置模块（fs）。
//
// 运行： node qa-layout-ui10.mjs

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
  if (cond) {
    passed++;
    console.log(`  [PASS] ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  [FAIL] ${name}`);
  }
}

console.log('== UI10 布局静态断言 ==\n');

// 1) 头像为方形（border-radius:4px），且无圆形（border-radius:50%）残留
//    仅针对 .tcp-avatar / .tcp-avatar-img / .tcp-avatar-ph 三条规则。
const avatarRule = /\.tcp-avatar\{[^}]*\}/.exec(html)?.[0] ?? '';
const avatarImgRule = /\.tcp-avatar-img\{[^}]*\}/.exec(html)?.[0] ?? '';
const avatarPhRule = /\.tcp-avatar-ph\{[^}]*\}/.exec(html)?.[0] ?? '';

assert('CSS .tcp-avatar 含 border-radius:4px', avatarRule.includes('border-radius:4px;'));
assert('CSS .tcp-avatar-img 含 border-radius:4px', avatarImgRule.includes('border-radius:4px;'));
assert('CSS .tcp-avatar-ph 含 border-radius:4px', avatarPhRule.includes('border-radius:4px;'));

assert('CSS .tcp-avatar 不含 border-radius:50%', !avatarRule.includes('border-radius:50%'));
assert('CSS .tcp-avatar-img 不含 border-radius:50%', !avatarImgRule.includes('border-radius:50%'));
assert('CSS .tcp-avatar-ph 不含 border-radius:50%', !avatarPhRule.includes('border-radius:50%'));

// 2) buildThumbChatPreview 含群聊分支且插入 .tcp-name
const fnMatch = /function buildThumbChatPreview\(chat\)\{([\s\S]*?)\n\}/.exec(html);
const fnBody = fnMatch ? fnMatch[1] : '';

assert('buildThumbChatPreview 存在', fnBody.length > 0);
assert('buildThumbChatPreview 含 chat.type===\'group\' 分支', fnBody.includes("chat.type==='group'"));
assert('buildThumbChatPreview 群聊分支插入 .tcp-name', fnBody.includes("'tcp-name'"));
assert('buildThumbChatPreview 单聊 else 分支不插入昵称',
  fnBody.includes('else') && !/else\s*\{[^}]*tcp-name/.test(fnBody));

// 3) 顶部 tcp-head 仍调用 chatDisplayName(chat)
assert('buildThumbChatPreview 顶部 tcp-head 调用 chatDisplayName(chat)',
  /tcp-head'\}?,\s*chatDisplayName\(chat\)/.test(fnBody) || fnBody.includes("'tcp-head'}, chatDisplayName(chat)"));

console.log(`\n== 结果：${passed} passed, ${failed} failed ==`);
if (failed > 0) {
  console.log('失败项：\n - ' + failures.join('\n - '));
  process.exit(1);
} else {
  console.log('全部通过 ✅');
  process.exit(0);
}
