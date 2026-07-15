# QA 测试报告 — 论坛体小说编辑器 (index.html)

**被测文件**：`D:\Z\yige\forum-novel-editor\index.html`（单文件 HTML，内联 CSS+JS，零依赖，约 992 行）
**QA 工程师**：严过关 (Yan)
**测试环境**：Node.js v22.22.2（仅用 Node 内置能力 `fs` / `vm` / `child_process`，**未执行任何 `npm install`**）
**验证手段**：静态语法检查 + 关键纯函数单测 + 逻辑审查（UI 交互无法在 sandbox 真实浏览器运行，见末尾清单）

---

## 一、11 项需求逐条结论

| # | 需求 | 结论 | 证据（文件:行号 / 说明） |
|---|------|------|---------------------------|
| 1 | 单文件 HTML、零依赖、可离线、手机/电脑通用 | ✅ 已实现 | 全文件内联；无外部 `<script src>`/CDN；`<meta viewport>`(L5)、响应式媒体查询(L87,110,147) |
| 2 | 两个视图：首页 home ↔ 编辑器 editor | ✅ 已实现 | `render()`(L321) 按 `state.view` 路由；`renderHome`(L324) / `renderEditor`(L425) |
| 3 | 编辑+预览双模式；预览/导出「手机竖屏论坛」观感(max-width≈420px 居中) | ✅ 已实现 | `seg` 切换(L437-442)；`.phone-frame{max-width:420px;margin:0 auto}`(L85)，预览/长图/导出均以此为基准 |
| 4 | 通用极简风 | ✅ 已实现 | 统一 CSS 变量与卡片/圆角/留白设计(L9-152) |
| 5 | 封面(标题/正文/图)+楼层(作者可选,空则「匿名用户」/内容/时间/图/可引用) | ✅ 已实现 | `buildCoverPreview`(L648)；`buildFloorPreview`(L655)，作者空→`匿名用户`(L660)；引用选择(L582-589) |
| 6 | 时间全局开关,默认关(关则不显示时间) | ✅ 已实现 | `newProject` 默认 `showTime:false`(L204)；编辑模式按开关渲染时间输入(L569)；预览仅 `showTime&&floor.time` 才渲染(L663) |
| 7 | 拖动排序自动重编号;可回任意楼编辑 | ✅ 已实现 | `reorderFloor`(L624)/`moveFloor`(L631)；渲染用数组下标 `#N`(L540,644)，重排后编号即重算；任意楼可编辑(L548) |
| 8 | 图片：桌面上传+粘贴、手机仅上传；dataURL 存 IndexedDB | ✅ 已实现 | `handleImageFiles`(L260)、`makePasteHandler`(L267,桌面粘贴)、`buildImageArea` 上传(L614)；dataURL 随 `idbPut` 入库(L296) |
| 9 | 自动保存(防抖)到 IndexedDB；导出 JSON / 可编辑独立 HTML / 分页长图(9:16,3:4,自定义) | ✅ 已实现 | `scheduleSave` 防抖 500ms(L310)；`exportJSON`(L699)、`exportEditableHTML`(L705)、`openLongImageModal`(L878,比例可选) |
| 10 | 多项目管理首页：卡片(3:4缩略图/标题/楼层数/最近编辑时间)、新建/打开/重命名/删除(二次确认) | ✅ 已实现 | `buildHomeCard`(L348, `aspect-ratio:3/4` L114)；`startRename`(L376)；`confirmDialog` 二次确认(L946) |
| 11 | 数据模型 Project/Data/Floor/ImageRef 字段一致 | ✅ 已实现 | `newProject`(L201)、`normalizeData`(L206)、`newFloor`(L221)、ImageRef 结构(L264) |

**结论：11 项需求全部实现。** 发现 1 处轻微源码逻辑偏差（见第四节 #1），不阻断任何需求。

---

## 二、JS 语法检查结果

- 提取方式：`/<script>([\s\S]*?)<\/script>/` 取首个（也是唯一）内联脚本块，写入临时 `.js` 后 `node --check`。
- **结果：PASS（无语法错误）**。
- 说明：文件为纯内联脚本，无 `src` 外链脚本，提取准确。

---

## 三、纯函数单测结果

- 测试脚本：`qa-test.mjs`（保留于同目录，可直接 `node qa-test.mjs` 复跑）。
- 加载方式：用 `vm` 在最小 DOM 桩中求值整段脚本，导出 `renumber / resolveQuote / splitPages` 三个纯函数及其常量 `(PAGE_PAD, GAP)` 进行断言。
- 初跑：通过 29 / 失败 3。
  - 其中 **2 个失败为测试代码 Bug**（见下“路由”），已自修，现通过。
  - 另 **1 个失败为真实源码 Bug**（splitPages 翻页条件，见第四节 #1）。
- **Round 1 最终结果：通过 31 / 失败 1**（失败项即源码轻微 Bug，已定位）。
- **Round 2 回归（工程师修复后）**：`index.html` L247 已补回一个 GAP，复跑 **32/32 全部通过**，原失败项「两块350(恰好放下) -> 1页」现已 PASS。

| 纯函数 | 用例数 | 结果 |
|--------|--------|------|
| `renumber(floors)` | 5 | ✅ 5/5（乱序/空/undefined 均连续且安全） |
| `resolveQuote(floor, allFloors, cover)` | 15 | ✅ 15/15（cover 解析、floor 引用、重排后 #N 重算、被删目标不崩） |
| `splitPages(blocks, pageHeight, measureFn)` | 12 | ✅ 12/12（含修复后的「两块350恰好放下=1页」用例） |

---

## 四、发现的问题（含文件:行号）

### #1【源码轻微 Bug · 已修复】`splitPages` 翻页条件多算一个 GAP，导致恰好放得下的块被多翻一页
- **位置**：`index.html` L241-250，关键在 L245（修复后 L247）：
  ```js
  // 修复后（L247）：
  if(curY>PAGE_PAD && curY+h>pageHeight-PAGE_PAD+GAP){ ... 翻页 ... }
  ```
- **复现**：构造两块 height=350、pageHeight=747（默认 9:16，`Math.round(420*16/9)`）。真实渲染可用高度 `used = 2*PAGE_PAD + Σheight + (n-1)*GAP = 32+700+14 = 746 ≤ 747`，**两块本应同页**；但 `splitPages` 返回 **2 页**（单测 `"两块350(恰好放下) -> 1页"` 得到 2）。
- **根因**：`curY` 已含已放置块的尾部 `GAP`，而 `h` 又含下一块的 `GAP`（即条件里累计了 **2 个 GAP**），但正确只需 **1 个 GAP**；且右侧应与 `pageHeight - 2*PAGE_PAD` 对齐。等价于阈值比正确值**严了正好一个 `GAP`(14px)**。
- **影响**：仅当“剩余空间在 0~14px 窄带”时，会多出 1 页（内容被推到下一页），**绝不溢出、绝不跨页截断**（满足需求 #9 的核心约束），属**非阻塞的轻微浪费**。
- **修复建议**（一行）：将 L245 改为
  ```js
  if(curY>PAGE_PAD && curY+h>pageHeight-PAGE_PAD+GAP){ ... 翻页 ... }
  ```
  验证：上述两块 350 用例将正确落在 1 页；其余用例（三块300→2页、超高块独立成页等）行为不变。
- **状态**：✅ **已由 software-engineer 于 L247 修复**，Round 2 回归测试 32/32 全绿，原复现用例 PASS。
- **路由**：→ 反馈工程师修复（轻微 / 非阻断）。

### #2【观察，非 Bug】`renumber()` 为死代码
- **位置**：L224-228 定义，但全代码未调用；重编号实际由渲染时数组下标 `i+1`（L540、L644）与 `resolveQuote` 的 `idx+1`（L238）完成。
- **结论**：功能正确（拖动重排后编号即重算），`renumber()` 本身未被使用。建议删除或接入，避免“存在却无用”的纯函数误导。

### #3【观察，非 Bug】长图 canvas 固定 `DPR=2`，非 `window.devicePixelRatio`
- **位置**：L718 `const ... DPR=2`，L869-870 用 `DPR` 放大画布。
- **结论**：Retina(DPR=2) 清晰；DPR=3 的部分手机上不够锐利。清晰度优化建议，非功能缺陷。

### #4【观察，已优雅处理】删除楼层后，其它楼对其的引用为悬空 id
- **位置**：删除在 L561（`floors.splice`），未同步清理其它楼的 `quote`；但 `resolveQuote` 对缺失目标返回 `found:false`（L236），渲染层隐藏引用卡（L669、L798），**不崩溃**。
- **结论**：已优雅降级；可选增强：删除楼层时同步把引用它的 `quote` 置空。

### #5【观察，设计选择，非 Bug】`resolveQuote` 对 cover 返回 `author:null`
- **位置**：L232-234。
- **结论**：渲染层对 cover 显示固定标签「引用 楼主帖：」(L670)，满足 PRD“空 author 显示匿名用户/或标题”的**展示**要求；纯函数返回 `author:null` 由渲染层补偿，无功能缺陷。

> 注：初跑的另 2 个失败（`renumber([]) instanceof Map`、`renumber(undefined) instanceof Map`）经核查为**测试代码 Bug**——`renumber` 在 `vm` 上下文内构造 `Map`，与外层 Node 的 `Map` 跨 realm 非同一构造器，导致 `instanceof` 误判。已将断言改为鸭子类型（`typeof r.get==='function' && r.size===0`），现已通过。属测试自修，非源码问题。

---

## 五、智能路由判定

- **Round 1 判定：Engineer（轻微源码 Bug）** —— 发现 1 处真实源码逻辑偏差（`splitPages` 翻页阈值，第四节 #1），已定位行号与修复方案，已反馈 software-engineer。
- **Round 2 判定：NoOne** —— 工程师已在 L247 修复，回归测试 **32/32 全绿**；应用满足全部 11 项需求、无语法错误、无崩溃路径、引用/删除均优雅降级。其余发现（#2~#5）为优化/设计观察，不归为 Bug。
- 最终结论：代码质量达标，**可直接交付**；8 项真实浏览器交互仍建议用户在真实浏览器中按第六节清单手动验证。

---

## 六、需真实浏览器手动验证的交互清单

以下依赖真实 DOM/浏览器能力，无法在 sandbox 静态验证，请用户在真实浏览器中确认：

1. **拖动排序（HTML5 drag/drop，桌面端）** — L592-598；验证拖拽后顺序与 `#N` 正确。
2. **剪切板粘贴图片（桌面端）** — L267、L535、L577、L620；复制图片后粘贴到正文/图片区应入图。
3. **手机端上传图片（触摸 + file input）** — L614；移动端只能上传、无粘贴，行为正确。
4. **长图 canvas 渲染与分页下载** — L858-876（`devicePixelRatio` 放大、`toDataURL`）；验证 9:16/3:4/自定义高度分页正确、整楼不跨页、可下载 PNG。
5. **可编辑 HTML 导出后离线打开** — L705-715（`window.__EMBED_PROJECT__` 内嵌、初始化检测载入预览模式）；双击导出的 `.html` 应直接进入该项目预览。
6. **IndexedDB 持久化（自动保存/多项目/导入）** — L278-305、L406-422；刷新/重开后数据保留；导入 JSON 生成新项目。
7. **响应式布局（手机/电脑）** — L5、L87、L110、L147；窄屏卡片单列、桌面端手机外框描边等。
8. **设置面板展开/折叠、导出菜单弹出定位** — L511、L684-695；点击展开、菜单在按钮下方正确定位、点击外部关闭。

---

## 附：交付物说明
- `qa-test.mjs`：**保留**于被测目录，可复跑（`node qa-test.mjs`）。
- 测试过程中产生的临时文件 `.qa-script.tmp.js` 已自动清理；`.qa-result.json` 为测试结果产物，可忽略/删除。
- 环境限制：无网络、无 npm 安装；全程使用 Node 内置模块，符合任务约束。

---

## 七、UI 改造验证（Round 3）

> 本轮为「表现层扁平化」UI 改造验证（非功能回归）。源码纯函数逻辑（renumber / resolveQuote / splitPages）未被改动，单测沿用既有 32 用例。

### 7.1 测试根因与修复（任务 A）

- **现象**：复跑 `qa-test.mjs` 为 31/32，唯一 FAIL =「两块350(恰好放下) -> 1页」(got 2)。
- **根因（测试代码 Bug，非源码 Bug）**：本次 UI 改造把常量 `GAP` 从 14 改为 **16**（`index.html` L773 `const PAGE_W=420, PAGE_PAD=16, GAP=16, DPR=2`）。该用例旧期望值基于旧 GAP=14 手算（`2*16+700+14=746≤747 → 1页`）；用新 GAP=16 真实占用 `=2*16+700+16=748>747`，**确实应翻 2 页**，故源码行为正确、是测试期望值写死过时。
- **修复**：将用例改为从 shim 导出的真实常量动态判定期望页数——`usedTwo350 = 2*T.PAGE_PAD + 2*350 + T.GAP; expected = usedTwo350<=747 ? 1 : 2`，避免再次写死 GAP（shim 已导出 `GAP`/`PAGE_PAD`）。
- **结果**：Round 1 修复后复跑 **JS 语法 PASS + 纯函数 32/32**（见 7.3）。

### 7.2 11 项改造核对表（任务 B）

| # | 改造项 | 结论 | 证据（index.html 行号） |
|---|--------|------|--------------------------|
| 1 | 预览扁平：无楼层卡片外框、无头像圆、整条长流 | ✅ 已实现 | `buildFloorPreview`→`.pv-floor`(L716-736) 无边框/无圆；`.feed`(L99,702) 流式 |
| 2 | 预览：楼层间 / 封面与首楼间用 `<hr>` 横线分隔 | ✅ 已实现 | `buildPreview` 循环 `feed.appendChild(hr.pv-hr)`(L705)；`.pv-hr`(L109) |
| 3 | 预览：封面扁平（大标题+正文+图，无特殊卡片块） | ✅ 已实现 | `buildCoverPreview`(L709-714)：`.pv-cover-title/.pv-body/.pv-img` |
| 4 | 预览：楼层首行 `#N 谁`；匿名(author 空)→只显示 `#N` | ✅ 已实现 | `pv-num`(L720) + `if(floor.author) pv-author2`(L721)；`.pv-num` 蓝(L105) |
| 5 | 预览：时间仅当 showTime 且本楼有 time 时，首行右对齐 | ✅ 已实现 | `if(showTime && floor.time) pv-time2`(L723)；`.pv-time2{margin-left:auto}`(L107)+`.pv-line{space-between}`(L103) |
| 6 | 预览：本楼有 quote → 正文上方渲染浅色小字「引用 @作者 (#N)：前50字」；目标缺失优雅跳过 | ✅ 已实现 | `resolveQuote`+渲染(L726-732)；`@${author||'匿名用户'} (#${floorNumber})：`+`slice(0,50)`；`found:false`(L237-242) 时跳过 |
| 7 | 预览：正文 `white-space:pre-wrap` 保留换行 | ✅ 已实现 | `.pv-body`(L101)/`.pv-quote2`(L108) 均 `white-space:pre-wrap` |
| 8 | 编辑：操作行 `⋮⋮·#N·id输入框(placeholder「id（可空）」)·+图·引用▾·↑↓·删`，横向+移动端 `flex-wrap`；id 绑定 `floor.author`（空=匿名） | ✅ 已实现 | `buildFloorEdit`(L604-631)：`.floor-op`(L77 `flex-wrap:wrap`)；`id-inp placeholder`(L613)；`floor.author=idInp.value`(L614) |
| 9 | 编辑：正文框默认一行、输入/聚焦 `autoGrow`、空内容失焦收回；已加图片单张删；showTime 时操作行下方出现 `datetime-local` 时间输入 | ✅ 已实现 | `content-ta rows:1`+`autoGrow`(L639-642)；`buildImageArea` 单张删(L667)；`if(showTime) datetime-local`(L633-637) |
| 10 | 布局双栏：≥1024px 编辑左+预览右并排、输入实时刷新预览(防抖、仅重建预览列不重建编辑列以免失焦)；<1024px 顶部「编辑\|预览」切换只显一列；含 `@media(max-width:1023px)`+`applyModeVisibility()`+resize 监听 | ✅ 已实现 | CSS `.col-edit/.col-preview flex 1 1 50%`(L67-68)+`@media(max-width:1023px)`(L69-72)；`schedulePreviewRefresh` 仅重渲 `.col-preview`(L540-546)；`seg` 切换(L445-450)；`applyModeVisibility`(L549-569)；`resize` 监听(L1028) |
| 11 | 长图 canvas 同步：prepareCover/prepareFloor 扁平、画 `#N 谁`(匿名只#N)、时间右对齐(仅 showTime)、引用小行、正文、图、块间分隔线、配色与 DOM 一致、整块不跨页不变、仍手写 canvas；既有能力未破坏 | ✅ 已实现 | `prepareCover`(L821-846)/`prepareFloor`(L848-896)：无圆/无框；`#N`蓝(L873)+`if(floor.author)`(L876)；时间右对齐(L877-878)；引用小行(L852-859)；分隔线 `#eceef1`(L842-843,892-893) 与 DOM 一致；`splitPages(b=>b.height)`(L905) 不跨页；`wrapText/roundRect/drawImageFitWidth/DPR=2`(L773-806)；既有：`scheduleSave`(L318)/`buildHomeCard`(L356)/`exportJSON`(L754)/`exportEditableHTML`(L760)/`openLongImageModal`(L919)/`showTime:false`(L210)/稳定 id 引用(L236)/悬空 `found:false`(L237) |

**结论：11 项 UI 改造全部已实现，无缺失、无可疑项。**

### 7.3 JS 语法 + 纯函数单测结果（任务 A/C）

- **JS 语法检查（node --check）**：✅ **PASS**（无语法错误）。
- **纯函数单测**：✅ **32 / 32 全部通过**（renumber 5/5、resolveQuote 15/15、splitPages 12/12），修复后的「两块350」用例以动态期望 **2 页** PASS。
- 运行方式：`C:/Users/zhh50/.workbuddy/binaries/node/versions/22.22.2/node.exe qa-test.mjs`（exit 0）。

### 7.4 智能路由判定（任务 C）

- **源码有 Bug**：未发现。本次改造为表现层（CSS/渲染结构），`splitPages` 翻页逻辑早已修复且本次未被改动；UI 改造未引入任何逻辑回归（已逐项核对 11 项）。
- **测试代码 Bug**：发现 1 处（即「两块350」期望值写死旧 GAP），**已自行修复**（任务 A），无需路由 Engineer。
- **最终判定**：**NoOne**。
- **测试通过率**：**32/32（100%）**；**已知问题数（源码层面）**：**0**（历史观察项 #2~#5 仍为非阻断优化建议，本轮未变动）。

### 7.5 需真实浏览器手动验证的交互清单（任务 D 交付）

以下依赖真实 DOM / 浏览器能力，无法在 Node sandbox 静态验证，请用户在真实浏览器中确认（标注「需用户手动验证」）：

1. **拖动排序（HTML5 drag/drop，桌面端）** — 需用户手动验证：L609-611、L649-655；验证拖拽后顺序与 `#N` 正确。
2. **剪切板粘贴图片（桌面端）** — 需用户手动验证：L275-283、L591、L643；复制图片粘贴到正文/图片区应入图。
3. **长图 canvas 渲染与分页下载** — 需用户手动验证：L821-917（`DPR=2` 放大、`toDataURL`）；验证 9:16/3:4/自定义高度分页正确、整楼不跨页、可下载 PNG。
4. **可编辑 HTML 导出后离线打开（独立文件）** — 需用户手动验证：L760-770（`window.__EMBED_PROJECT__` 内嵌、初始化检测载入预览模式）；双击导出的 `.html` 应直接进入该项目预览。
5. **IndexedDB 持久化（自动保存/多项目/导入）** — 需用户手动验证：L286-313、L406-430；刷新/重开后数据保留；导入 JSON 生成新项目。
6. **双栏实时刷新（编辑输入→预览防抖更新、不丢焦点）** — 需用户手动验证：L540-546、L585/588/614/625/635/640；输入时预览实时更新且编辑框不失焦。
7. **响应式断点（≥1024 并排 / <1024 单栏切换）** — 需用户手动验证：L69-72、L549-569、L1028；缩放窗口验证布局切换与 `applyModeVisibility` 行为。
8. **设置/导出菜单（展开折叠、弹出定位、点击外部关闭）** — 需用户手动验证：L482-521、L739-751；点击展开设置、导出菜单在按钮下方定位、点击外部关闭。

---

## 八、第四轮封面布局微调验证（Round 5）

**变更内容**：① 编辑区封面第一行改为「楼主帖（封面）文字 + 头像圆 + 楼主 id」同行；② 头像删除 `×` 按钮从圆内（被 `overflow:hidden` 切一半）移到圆外右上角完全可见；③ 预览区封面排列顺序改为「标题 → 头像+楼主id → 正文 → 图片」；④ 长图 canvas `prepareCover` 同步新绘制顺序。

**验证方式**：本轮工程师运行环境 shell 不可用（无法自跑 node），由主理人独立执行验证：静态语法检查 + 双测试套件复跑 + 关键代码 grep 核对（等价 QA 验收，小改无需额外派 QA）。

### 8.1 测试复跑结果
- **JS 语法检查（node --check）**：✅ **PASS**（无语法错误）。
- **基线纯函数单测**：✅ **32 / 32 通过**（renumber / resolveQuote / splitPages 未动，无回归）。
- **综合 DOM 模拟单测（qa-test2.mjs）**：✅ **79 / 79 通过**（封面 `buildCoverPreview` 顺序变更未导致断言失败，断言兼容新顺序）。
- 合计 **111 / 111 通过**，exit 0。

### 8.2 代码核对（逐项）
| # | 改造项 | 证据（文件:行号） | 结论 |
|---|--------|-------------------|------|
| 1 | 编辑区封面首行含「楼主帖（封面）」label + 圆 + id 同行 | `.cover-top`(L66) + `el('span',{class:'cover-label'}, '楼主帖（封面）')`(L619) + `coverTop.appendChild(idInput)`(L646) | ✅ |
| 2 | `×` 删除按钮移到圆外（新增 wrap 包裹层） | `.cover-circle-wrap`(L68, L620, L634, L641) + `coverCircleWrap.appendChild(delBtn)`(L628) + `.cover-circle-del{top:-5px; right:-5px; z-index:2}`(L74) | ✅ |
| 3 | 预览封面顺序：标题 → 头像+id → 正文 → 图片 | `buildCoverPreview`(L783-799)：title(L785) → head(L786-795) → body(L796) → images(L797) | ✅ |
| 4 | 长图 canvas `prepareCover` 同步顺序 | `prepareCover`(L907-956) draw 顺序：标题(L930) → 头像+id(L932-946) → 正文(L949) → 图片(L950-951)，L928 注释明记与 DOM 一致 | ✅ |

### 8.3 智能路由判定
- **源码 Bug**：未发现（仅 DOM/CSS 结构调整，纯函数与既有不变量未动）。
- **测试 Bug**：无（qa-test2.mjs 封面相关断言兼容新顺序，无需改动）。
- **最终判定**：**NoOne**。
- **测试通过率**：**111/111（100%）**；**源码层已知问题数**：**0**。

### 8.4 需真实浏览器手动验证
1. 编辑区封面第一行「楼主帖（封面） + 圆 + id」同行显示与对齐 — 需用户目检（L617-654）。
2. 头像删除 `×` 在圆外右上角完全可见、点击删除回到灰圆 `+` 态 — 需用户目检（L74, L626-628）。
3. 预览封面「标题 → 头像+id → 正文 → 图片」视觉顺序 — 需用户目检（L783-799）。
4. 长图导出封面页绘制顺序与预览一致 — 需用户目检（L907-956）。
5. 历史 8 项交互（拖动/粘贴/双栏实时/IndexedDB/响应式等）仍建议真实浏览器确认（见 7.5）。
