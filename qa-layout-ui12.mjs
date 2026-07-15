/**
 * qa-layout-ui12.mjs
 * 论坛体/捡手机文学单文件 HTML 编辑器 —— UI12 布局修复静态断言
 *
 * 依赖：Node.js 内置模块（fs, path），零第三方依赖。
 * 运行：node qa-layout-ui12.mjs
 *
 * 覆盖三个问题：
 *  - 问题1: 聊天体切换身份弹窗选中人改为绿色（#95EC69 / #e6f7e6）
 *  - 问题2: 设置窗口挂在设置按钮下方（.settings 不再 position:fixed，改为 absolute；buildSettings/buildPickupSettings 挂到 bar）
 *  - 问题3: 项目封面图设置行横向一行显示（.set-row > span 不换行；.set-row > div 横向 flex 靠右）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index.html');
const html = fs.readFileSync(FILE, 'utf-8');

// 去掉 <script> 中的内容，避免 JS 字符串误命中 CSS（仅校验 CSS 与 DOM 结构文本即可）
const cssBlock = (() => {
  const m = html.match(/<style>([\s\S]*?)<\/style>/i);
  return m ? m[1] : '';
})();

const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass, detail });
  const tag = pass ? 'PASS' : 'FAIL';
  console.log(`[${tag}] ${name}${detail ? ' — ' + detail : ''}`);
}

/* ---------- 问题1：选中人绿色 ---------- */
(() => {
  const rule = cssBlock.match(/\.wx-member-row\.active\s*\{[^}]*\}/);
  if (!rule) { check('问题1: .wx-member-row.active 存在', false, '未找到规则'); return; }
  const body = rule[0];
  const hasBorder = /border-color\s*:\s*#95EC69/i.test(body);
  const hasBg = /background\s*:\s*#e6f7e6/i.test(body);
  check('问题1a: .wx-member-row.active border-color 为绿色 #95EC69', hasBorder, body.trim());
  check('问题1b: .wx-member-row.active background 为绿色 #e6f7e6', hasBg, body.trim());
})();

/* ---------- 问题2：设置窗口不再 fixed，改为 absolute ---------- */
(() => {
  const rule = cssBlock.match(/\.settings\s*\{[^}]*\}/);
  if (!rule) { check('问题2: .settings 规则存在', false, '未找到规则'); return; }
  const body = rule[0];
  const noFixed = !/position\s*:\s*fixed/.test(body);
  const isAbsolute = /position\s*:\s*absolute/.test(body);
  check('问题2a: .settings 不再使用 position:fixed', noFixed, body.trim());
  check('问题2b: .settings 使用 position:absolute', isAbsolute, body.trim());
})();

/* ---------- 问题2：.topbar 含定位上下文 ---------- */
(() => {
  const rule = cssBlock.match(/\.topbar\s*\{[^}]*\}/);
  if (!rule) { check('问题2c: .topbar 规则存在', false, '未找到规则'); return; }
  const body = rule[0];
  const positioned = /position\s*:\s*(relative|absolute|fixed|sticky)/.test(body);
  check('问题2c: .topbar 含定位上下文 (relative/absolute/fixed/sticky)', positioned, body.trim());
})();

/* ---------- 问题2：DOM 结构 —— settings 挂到 bar，而非 app ---------- */
(() => {
  const hasBarBuild = /bar\.appendChild\(buildSettings\(\)\)/.test(html);
  const hasBarPickup = /bar\.appendChild\(buildPickupSettings\(\)\)/.test(html);
  const noAppBuild = !/app\.appendChild\(buildSettings\(\)\)/.test(html);
  const noAppPickup = !/app\.appendChild\(buildPickupSettings\(\)\)/.test(html);
  check('问题2d: 论坛体 renderEditor 中 buildSettings 挂到 bar', hasBarBuild);
  check('问题2e: 捡手机体 renderPickup 中 buildPickupSettings 挂到 bar', hasBarPickup);
  check('问题2f: 不存在 app.appendChild(buildSettings())', noAppBuild);
  check('问题2g: 不存在 app.appendChild(buildPickupSettings())', noAppPickup);
})();

/* ---------- 问题3：封面图行横向 ---------- */
(() => {
  const spanRule = cssBlock.match(/\.set-row\s*>\s*span\s*\{[^}]*\}/);
  const divRule = cssBlock.match(/\.set-row\s*>\s*div\s*\{[^}]*\}/);

  const spanOk = !!spanRule && /white-space\s*:\s*nowrap/.test(spanRule[0]) && /flex-shrink\s*:\s*0/.test(spanRule[0]);
  check('问题3a: .set-row > span 含 white-space:nowrap 和 flex-shrink:0',
    spanOk, spanRule ? spanRule[0].trim() : '规则缺失');

  const divOk = !!divRule && /display\s*:\s*flex/.test(divRule[0]) && /justify-content\s*:\s*flex-end/.test(divRule[0]);
  check('问题3b: .set-row > div 含 display:flex 和 justify-content:flex-end',
    divOk, divRule ? divRule[0].trim() : '规则缺失');
})();

/* ---------- 汇总 ---------- */
const failed = results.filter(r => !r.pass);
console.log('\n=====================================');
console.log(`总计: ${results.length} 项，通过: ${results.length - failed.length}，失败: ${failed.length}`);
if (failed.length) {
  console.log('失败项:');
  failed.forEach(f => console.log('  - ' + f.name + (f.detail ? ' :: ' + f.detail : '')));
  console.log('\nIS_PASS: NO');
  process.exit(1);
} else {
  console.log('\nIS_PASS: YES');
  process.exit(0);
}
