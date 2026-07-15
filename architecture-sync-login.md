# 系统架构设计 + 任务分解：登录与云端同步（增量）

> 作者：高见远（架构师）
> 日期：2025-07-14
> 关联：PRD `prd-sync-login.md`、现有交付物 `index.html`
> 已锁定决策（遵循，不质疑）：方案 A 单文件 + @supabase/supabase-js 浏览器版；邮箱+密码登录；IndexedDB 本地缓存 + 防抖自动推送 + 打开拉取；个人使用整篇 last-write-wins；Supabase 项目 `cfydrjhkwmlctsmitcav.supabase.co`；表 `profiles`/`projects`(JSONB)/`covers` 桶；RLS `owner_id = auth.uid()`。
> 原则：现有 ~2400 行编辑器逻辑 **零回归**（P0-11）；保持单文件优先；只做设计与任务分解，不含实现代码。

---

## 一、实现方案 + 框架选型

### 1.1 整体策略：适配层 + 零改写

不对现有 `index.html` 中任何已有函数体做改动，只在其 `<script>` **末尾追加一段新的「同步模块」代码**，并在 `<style>` 末尾追加少量同步相关 CSS。现有逻辑通过「调用点不变、新增包装函数」的方式被增量增强：

- 现有 `scheduleSave()`（500ms 防抖，只写 IndexedDB）**原样保留**。新增统一的 `markDirtyAndSync(project)` 包装：先调用 `scheduleSave()`（本地落盘），再启动一个独立的 2s 云同步防抖（`state.cloudTimer`）。所有原本触发 `scheduleSave()` 的编辑入口因此**自动获得云端推送**，无需逐个改。
- 现有 `openProject(id)`（从 IndexedDB 读）**原样保留**。在其后异步插入一步：`if(online) await sync.pullLatest(id)` 拉取云端最新并按 LWW 合并，再触发渲染。
- 现有 `renderHome()` / 编辑器头部：在其 header 内 `prepend` 一个 `#sync-bar` 状态条 DOM（仅登录后常驻）。卡片/楼层/消息等渲染逻辑不动。
- 现有 `idbGetAll` / `idbGet` / `idbPut` / `idbDelete`：继续作为**本地缓存层**。新增 `sync.readProject(id)` 优先本地、按需与云合并。

### 1.2 @supabase/supabase-js 引入方式（推荐）

**首选：ESM CDN 动态 `import()`（零构建、保持单文件）。**

在同步模块内提供单例懒加载：

```js
// 配置常量（新增）
const SUPABASE_URL = 'https://cfydrjhkwmlctsmitcav.supabase.co';
const SUPABASE_ANON_KEY = '***已拿到的 anon/publishable key***';
let __sb = null;
async function getSb(){
  if(__sb) return __sb;
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  __sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return __sb;
}
```

- 优点：零构建、单 HTML 文件形态不变；`import()` 是网络操作，离线时自然失败 → 被 `try/catch` 捕获 → 自动回退「离线模式」，不破坏现有无网可用能力；不触碰现有 2400 行。
- 代价：首次联网需从 esm.sh 拉取库（约几十 KB，带 HTTP 缓存）。

**备选（若要求「完全自包含、不依赖第三方 CDN」）：** 把 `supabase-js` 浏览器版下载为同目录的 `supabase-browser.min.js`，用 `<script src="supabase-browser.min.js"></script>` 暴露 `window.supabase`，再 `createClient(...)`。这**仅额外引入 1 个第三方库文件（非我们的业务代码）**，不破坏「业务代码单文件」原则，属于部署选择而非架构拆分。

> 结论：**业务代码保持单文件**（全部内联在 `index.html`）；唯一外部资源是 @supabase/supabase-js（CDN 动态导入，或可选本地 vendor）。不需要把我们的登录/同步逻辑拆成多个 `.js` 文件。

### 1.3 单文件内代码组织（追加段落，不动旧代码）

在现有 `<script>` 内按以下顺序追加（全部 new code）：

1. `// ===== Sync: 配置 =====` — `SUPABASE_URL` / `SUPABASE_ANON_KEY` 常量
2. `// ===== Sync: 客户端懒加载 =====` — `getSb()` 单例
3. `// ===== Sync: 数据映射 =====` — `toCloudRow(p, userId)` / `fromCloudRow(row)`
4. `// ===== Sync: Auth 服务 =====` — `signUp/signIn/signOut/getSession/onAuthStateChange/resetPassword/getUserId`
5. `// ===== Sync: 离线队列 =====` — `OfflineQueue`（localStorage 持久化）
6. `// ===== Sync: 同步服务 =====` — `pushProject/pullLatest/pullAll/migrateLocal/deleteProject/subscribeRealtime`
7. `// ===== Sync: 封面 Storage =====` — `uploadCover/getCoverUrl/deleteCoverFolder`
8. `// ===== Sync: 状态条 UI =====` — `StatusManager`
9. `// ===== Sync: 登录 UI =====` — `LoginUI`
10. `// ===== Sync: 首次迁移 UI =====` — `MigrationUI`
11. `// ===== Sync: 启动钩子 =====` — `initSync()`，挂到现有 `DOMContentLoaded` 末尾

CSS：`</style>` 前追加 `.sync-bar` / `.sync-dot` / `.login-modal` 等少量类。

---

## 二、文件列表及相对路径

保持单文件优先，仅引入第三方库（可选本地化）。本增量**不新增任何业务 `.js` 文件**。

```
forum-novel-editor/
├── index.html                # 【修改】现有单文件：<style> 末尾加同步 CSS；<script> 末尾追加「同步模块」11 段；DOMContentLoaded 末尾挂 initSync()
├── supabase-browser.min.js  # 【可选新增】仅当选择「本地 vendor」替代 CDN 时存在；业务代码仍全在 index.html
└── sql/
    └── init-supabase.sql    # 【新增】建表 + RLS + 存储桶策略（T1 交付物，在 Supabase SQL Editor 执行）
```

> 说明：所有登录/同步逻辑内联于 `index.html`，符合「单文件优先」。唯一例外是 `@supabase/supabase-js` 库本身（CDN 或 vendor 文件），它不是我们的代码，不可内联（体积过大且需随库版本更新）。

---

## 三、数据结构与接口

### 3.1 数据库表（Postgres / Supabase）

**`profiles`**（与 `auth.users` 1:1）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | uuid | PK, `references auth.users(id)` | 同 auth.uid() |
| email | text | | 邮箱 |
| created_at | timestamptz | `default now()` | |
| updated_at | timestamptz | `default now()` | |

**`projects`**（每行一个项目，内容存 JSONB）

| 字段 | 类型 | 约束 | 说明 |
|------|------|------|------|
| id | text | PK | **沿用本地 `uid()` 生成的 UUID 字符串**，迁移时不改 id，避免引用错位 |
| owner_id | uuid | NOT NULL, `references auth.users(id)` | RLS 判定依据 |
| type | text | NOT NULL, `check(type in ('forum','pickup'))` | 论坛体 / 聊天体 |
| title | text | NOT NULL default '未命名小说' | |
| cover_image | jsonb | | 沿用现有结构：`{dataUrl, name}`；P1-1 双写后追加 `storagePath` |
| data | jsonb | NOT NULL | 整篇内容（forum: cover/floors/settings；pickup: chats/settings/coverImage） |
| created_at | timestamptz | NOT NULL default now() | |
| updated_at | timestamptz | NOT NULL default now() | LWW 判定依据（客户端写入） |

`projects` JSONB `data` 示例（forum）：
```json
{
  "cover": { "title":"", "body":"", "images":[], "author":"", "avatar":null },
  "coverImage": { "dataUrl":"data:image/png;base64,...", "name":"cover.png" },
  "floors": [ { "id":"..","author":"","content":"","time":"","images":[],"quote":null,"isOP":false } ],
  "settings": { "showTime":false, "pageRatio":"9:16", "pageHeightPx":null }
}
```

`projects` JSONB `data` 示例（pickup）：
```json
{
  "settings": { "showTime":true, "theme":"wechat", "pageRatio":"9:16", "pageHeightPx":null },
  "coverImage": { "dataUrl":"data:image/png;base64,...", "name":"cover.png" },
  "chats": [ { "id":"..","name":"","type":"single","order":0,
    "members":[{"id":"..","name":"我","avatar":null,"isMe":true,"blocked":false}],
    "messages":[{"id":"..","senderId":null,"type":"text","text":"","image":null,"voice":null,"quote":null,"withdrawn":false,"blocked":false,"isSystem":false,"pageBreak":false,"time":0}] } ]
}
```

**`covers` 存储桶**：路径约定 `{owner_id}/{project_id}/{file}`（`file` 用短随机名或 `cover.png`）。

### 3.2 RLS 策略 SQL（`sql/init-supabase.sql`）

```sql
-- 1) 开启 RLS
alter table profiles enable row level security;
alter table projects  enable row level security;

-- 2) profiles 策略（只能看/改自己的档案）
create policy "profiles_select_self" on profiles for select using (auth.uid() = id);
create policy "profiles_insert_self" on profiles for insert with check (auth.uid() = id);
create policy "profiles_update_self" on profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- 3) projects 策略（owner_id = auth.uid()）
create policy "projects_select_own" on projects for select using (owner_id = auth.uid());
create policy "projects_insert_own" on projects for insert with check (owner_id = auth.uid());
create policy "projects_update_own" on projects for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "projects_delete_own" on projects for delete using (owner_id = auth.uid());

-- 4) 自动维护 profiles（注册即建档）
create function public.handle_new_user() returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end; $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- 5) covers 存储桶策略（桶设为 public，见「待明确事项 Q6」）
insert into storage.buckets (id, name, public) values ('covers','covers', true)
  on conflict (id) do update set public = true;

create policy "covers_select" on storage.objects for select
  using (bucket_id = 'covers');
create policy "covers_insert_own" on storage.objects for insert
  with check (bucket_id = 'covers' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "covers_delete_own" on storage.objects for delete
  using (bucket_id = 'covers' and (storage.foldername(name))[1] = auth.uid()::text);
```

> 若最终选「私有读」，将 `covers_select` 改为 `using (bucket_id='covers' and (storage.foldername(name))[1] = auth.uid()::text)`，并把桶 `public` 设为 `false`，渲染时改用签名 URL（`supabase.storage.from('covers').createSignedUrl(path, 3600)`）。

### 3.3 Auth 流程

- 注册：`supabase.auth.signUp({email, password})` → Supabase 发验证邮件（可配置关闭确认）→ 触发 `handle_new_user` 建 `profiles`。
- 登录：`supabase.auth.signInWithPassword({email, password})` → 返回 session（含 access/refresh token，由 Supabase 持久化到 localStorage，刷新不掉线 = P0-4）。
- 会话恢复：`supabase.auth.getSession()`（同步快，用于路由守卫）；安全取用户用 `getUser()`。
- 登出：`supabase.auth.signOut()` → 清除本地 token；**不删 IndexedDB**（P0-3）。
- 状态订阅：`supabase.auth.onAuthStateChange(cb)` 用于 UI 联动。
- 忘记密码：`supabase.auth.resetPasswordForEmail(email)` → Supabase 默认重置邮件（P1-3）。

### 3.4 前端模块接口（签名级，非实现）

```
AuthService:
  signUp(email, password) -> Promise<Session>
  signIn(email, password) -> Promise<Session>
  signOut() -> Promise<void>
  getSession() -> Promise<Session|null>
  getUser() -> Promise<{id,email}|null>
  onAuthStateChange(cb) -> unsubscribe
  resetPassword(email) -> Promise<void>

SyncService:
  init()
  pushProject(p: LocalProject) -> Promise<void>          // upsert, LWW by updated_at
  pullLatest(id: string) -> Promise<LocalProject>        // 拉云端并按 LWW 合并本地
  pullAll() -> Promise<LocalProject[]>
  migrateLocal(list: LocalProject[]) -> Promise<void>     // 首次迁移, 逐条 upsert
  deleteProject(id: string) -> Promise<void>             // 删云行 + 清 covers 文件夹
  subscribeRealtime(userId: string) -> unsubscribe       // 可选, P2-1

CoverStorage:
  upload(ownerId, projectId, file) -> Promise<path>      // 返回 {owner_id}/{project_id}/{file}
  getUrl(path: string) -> string                         // public: 公开 URL; private: 签名 URL
  deleteFolder(ownerId, projectId) -> Promise<void>

StatusManager:
  setStatus(s: 'online'|'offline'|'syncing') -> void
  getStatus() -> string
  renderBar(host: HTMLElement) -> void

OfflineQueue:
  enqueue(op) -> void
  flush() -> Promise<void>
  pendingCount() -> number

MigrationUI:
  maybeShow(localList, cloudIds) -> void
  run(list) -> Promise<void>

LoginUI:
  render() -> void
  handleLogin() -> void
  handleRegister() -> void
  enterOffline() -> void
```

### 3.5 类图（Mermaid）

见同目录 `class-diagram.mermaid`。

---

## 四、程序调用流程（Mermaid 时序图）

见同目录 `sequence-diagram.mermaid`（含注册/登录、首次迁移、日常防抖同步、打开拉取、Realtime 可选、冲突 LWW、登出 7 张图）。要点文字版：

1. **注册/登录**：LoginUI → AuthService → Supabase Auth；成功则 `onAuthStateChange` 持久化、状态条转「在线」、进入首页；失败内联提示（密码错/用户不存在/网络）。
2. **首次迁移**：登录后 `init()` → 读 IndexedDB 全部 + 查云端已有 id 集合 → 若有差异弹「发现 N 个本地作品」→ 用户确认后 `migrateLocal` 逐条 `upsert`（LWW by `updated_at`）并显示进度。
3. **日常防抖同步**：编辑 → `scheduleSave()`（500ms 本地落盘，保持原样）→ `markDirtyAndSync()`（2s 云防抖）→ 在线则 `pushProject` upsert；离线则 `OfflineQueue.enqueue` 并标记「N 条待同步」。
4. **打开拉取**：`openProject(id)` → 先读本地 → 在线则 `pullLatest(id)`，按 `updated_at` 做 LWW：云端更新则覆盖本地并重渲染；本地有未推送改动则保留本地并后台推送。离线直接读本地。
5. **Realtime（可选 P2-1）**：`subscribeRealtime(userId)` 订阅 `postgres_changes`；其他设备 upsert 触发事件 → LWW 比较 → 提示「另一设备已更新」并自动拉取。
6. **冲突 LWW**：同 id 不同设备，`compare(local.updated_at, cloud.updated_at)`；本地较新则推送覆盖云端，云端较新则拉取覆盖本地（若本地有未推送改动先提示）。
7. **登出**：`signOut()` 清 token → **保留 IndexedDB** → 状态条转「离线/未登录」→ 回到登录界面（仍可「进入离线模式」）。

---

## 五、任务列表（有序、含依赖、按实现顺序）

> 优先级：P0 首批必做，P1 首版尽量，P2 可选。依赖指「需先完成」的任务 ID。

| ID | 任务名 | 优先级 | 依赖 | 产出/涉及文件 |
|----|--------|--------|------|---------------|
| T1 | 建表 + RLS + 存储桶策略 SQL | P0 | 无 | `sql/init-supabase.sql`；Supabase 控制台执行 |
| T2 | Supabase 客户端封装 + 配置常量 + 懒加载单例 | P0 | 无（T1 表可后置执行，封装不依赖表存在） | `index.html` 同步模块段 1–2 |
| T3 | 登录 UI + 离线模式入口 | P0 | T2 | `index.html` 段 9；`<style>` 登录样式 |
| T4 | 会话保持 / 路由守卫（刷新不掉线） | P0 | T2 | `index.html` 段 4（`onAuthStateChange`/`getSession` 接线） |
| T5 | 数据层适配（读改走云端 + 本地缓存，含云删除 + covers 清理接线） | P0 | T1, T2 | `index.html` 段 3、5、6；`openProject`/`idb*` 包装 |
| T6 | 防抖自动同步 + 手动「立即同步」 | P0 | T5 | `index.html` 段 5、6；`markDirtyAndSync` + 首页/编辑器「立即同步」按钮 |
| T7 | 首次本地数据迁移上云 | P0 | T5, T6 | `index.html` 段 10（`MigrationUI`）+ 段 6 `migrateLocal` |
| T8 | 在线/离线/同步中状态条 | P0 | T2 | `index.html` 段 8（`StatusManager`）+ `<style>` |
| T9 | Realtime 实时多端更新（可选） | P2 | T5 | `index.html` 段 6 `subscribeRealtime` |
| T10 | 封面图 Storage 双写同步 | P1 | T5, T1 | `index.html` 段 7（`CoverStorage`）；`cover_image` 增 `storagePath` |
| T11 | 登出（保留本地数据） | P0 | T2, T4 | `index.html` 段 4 `signOut` 接线 |
| T12 | 忘记密码流程 | P1 | T2 | `index.html` 段 9 + 段 4 `resetPassword` |

注：
- **P0-7 手动同步**并入 T6/T8（按钮 + 状态条）。
- **P0-11 现有功能 100% 保留**：所有 T 均为「追加/包装」，不修改现有函数体。
- **云端删除一致性（PRD Q7）**：在 T5 的 `deleteProject` 中一并实现「删云行 + 清 `covers/{owner_id}/{project_id}/`」（T10 落地 Storage 清理细节）。
- 推荐实现顺序：T1 → T2 → T3/T4 → T5 → T6 → T7 → T8 → T11（首批 P0 闭环）；随后 T10、T12（P1）；T9（P2）视确认。

---

## 六、依赖包列表

```
@supabase/supabase-js@^2     # Supabase 浏览器客户端（Auth + PostgREST + Storage + Realtime）
  - 引入方式（首选）：ESM CDN 动态 import —— await import('https://esm.sh/@supabase/supabase-js@2')
  - 引入方式（备选）：本地 vendor 为 supabase-browser.min.js，用 <script src> 暴露 window.supabase
  - 注意：仅此第三方库为外部资源；业务代码全部内联于 index.html，零构建、离线可回退
```

无其他依赖（现有编辑器为零依赖 vanilla ES2020+，保持）。

---

## 七、共享知识（跨模块/文件约定）

- **取用户 id**：安全用 `const { data:{ user } } = await supabase.auth.getUser(); return user?.id ?? null;`；路由守卫等高频处可用 `getSession()` 取 `session.user.id`（更省）。
- **标记 dirty / 同步状态**：在现有 `state` 上追加字段 `syncStatus`（`'idle'|'syncing'|'dirty'`）、`pendingSync`（待同步条数）、`isOnline`。每次 `markDirtyAndSync` 置 `syncStatus='dirty'`；`pushProject` 完成置 `'idle'` 并 `pendingSync=0`。
- **防抖时长**：本地 `scheduleSave` 保持现有 **500ms**；新增云端推送防抖 **2000ms**（PRD 建议 1.5–3s，取中值），使用独立定时器 `state.cloudTimer`，避免与本地保存耦合。
- **离线队列机制**：`OfflineQueue` 以 `localStorage['__sync_queue__']` 持久化为 JSON 数组（仅存 `{op:'push'|'delete', id}` 轻量指令；项目数据本体仍在 IndexedDB）。恢复网络（`window 'online'` 事件 + `onAuthStateChange`）触发 `flush()`：逐条重放 `pushProject`/`deleteProject`，完成后清空并显示「已同步」。
- **updated_at 来源**：沿用现有 `scheduleSave` 中 `state.currentProject.updatedAt = Date.now()`（毫秒）。推送时作为 `timestamptz` 写入云 `updated_at`，作为 LWW 唯一判定依据。已知风险：跨设备系统时钟漂移；缓解——`pullLatest` 比较时若差 < 2s 视为「同时」，优先保留本地未推送改动并后台推送，避免误覆盖。
- **数据映射约定**：`toCloudRow(p, userId)` = `{ id:p.id, owner_id:userId, type:p.type, title:p.title, cover_image:p.data.coverImage, data:p.data, updated_at:new Date(p.updatedAt) }`；`fromCloudRow(row)` 反向还原为 `LocalProject`（`createdAt/updatedAt` 由 `Date.parse` 转回毫秒）。
- **错误处理统一**：所有 Supabase 调用 `try/catch`；网络/超时错误归类为「离线」→ 转离线队列；约束/RLS 错误（如 401/42501）归类为「鉴权失效」→ 触发重新登录提示。
- **API 响应形态**：本项目为直连 Supabase（非自研后端），无 `{code,data,message}` 包装；统一以 Supabase 返回的 `{data, error}` 二值判断，UI 层再翻译为中文提示。

---

## 八、待明确事项（架构侧推荐）

针对 PRD「五、待确认问题」给出推荐方案：

- **Q1 静态托管选哪家？** 推荐 **Netlify 或 CloudStudio**（拖拽部署 `index.html`、免构建、支持自定义域名、自带 HTTPS，最契合单文件零构建形态）；GitHub Pages 亦可（需提交到仓库）。**需用户拍板具体哪家 + 是否要自定义域名**（影响后续发布说明，不影响本期架构）。
- **Q2 Realtime 是否首批？** 推荐 **否，放 P2（T9）**。先跑通「防抖自动同步 + 手动同步 + 打开拉取」闭环，Realtime 的 channel 订阅与 LWW 拉取存在交互复杂度，个人单用户场景收益有限，可第二批再加。
- **Q3 忘记密码邮件？** 推荐 **先用 Supabase 默认重置邮件模板**（零成本、开箱即用，对应 T12）。后续若需品牌化文案再自接邮件服务。
- **Q4 封面图存储策略？** 推荐 **P0 首版继续内联 `dataUrl` 进 JSONB**（完全沿用现状，零 Storage 复杂度，不阻塞 P0）；**P1-1（T10）再做 covers 桶双写**：上传到 `covers/{owner_id}/{project_id}/`，`cover_image` 增加 `storagePath`，IndexedDB 仍缓存 `dataUrl` 供离线渲染。这样 P0 与 Storage 解耦、可独立交付。
- **Q5 首次迁移冲突/重复？** 推荐 **沿用本地 `uid()` 生成的 id 作为云 PK，迁移 = upsert，冲突按 `updated_at` LWW 覆盖；默认不创建「设备后缀副本」**，保证每个 id 一份权威副本。仅当同 id 在云已存在且云端 `updated_at` 更新时以云为准；否则以本地覆盖。多设备各自有本地项目 → 因 UUID 几乎不碰撞，自然各存各的，无需后缀。
- **Q6 covers 桶公开/私有读？** 推荐 **公开读（public）**。理由：① 渲染与导出长图（P0-11 长图导出）免签名 URL，逻辑最简；② 对象路径以 `owner_id` 命名空间 + 随机文件名，不可枚举，泄露风险极低；③ 个人小说封面敏感度低。代价：拿到精确 URL 的任何人可查看——对个人可接受。**若后续要放敏感内容，再切私有 + 签名 URL**（SQL 中已留切换注释）。
- **Q7 数据删除一致性？** 推荐 **云端删除项目时同步删除 `covers/{owner_id}/{project_id}/` 下全部对象**（Storage `list` + `remove`），在 T5 `deleteProject` 中落地，T10 补全 Storage 清理实现。IndexedDB 本地副本按现有「删除即删」或保留（P2-4 提供「清除本地缓存」选项）另行处理。

### 需用户/团队最终拍板的点
1. 静态托管具体哪家（Q1）。
2. 是否接受本期「封面先内联、Storage 双写后置」的拆分（Q4）。
3. 是否确认 covers 桶采用公开读（Q6）——涉及分享/导出时的隐私权衡。
4. Realtime 是否真的放到第二批（Q2，默认是）。

---

## 九、风险与回退

- **CDN 不可达/离线**：`getSb()` 的 `import()` 失败 → 全局 `try/catch` 进入离线模式，现有编辑器完全不受影响（P0-11、用户故事 4/5 的离线分支）。
- **RLS 未开**：T1 必须在任何写入前于 Supabase 控制台执行并验证；上线前用非本人账号做越权读取冒烟测试（确保返回空）。
- **单文件体积**：同步模块追加约 300–500 行（设计估算，非实现），内联后 `index.html` 仍可控；若未来膨胀，再考虑把同步模块拆为独立 `sync.js` 用 `<script type="module">` 引入（届时现有编辑器 script 不变）。
