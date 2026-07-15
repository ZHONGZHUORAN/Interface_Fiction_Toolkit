-- =============================================================================
-- 文件：sql/init-supabase.sql
-- 任务：T1 建表 + RLS + 存储桶策略 + Realtime 发布配置（首批 P0 交付）
-- 项目：论坛/聊天体小说编辑器 — 登录与云端同步（增量）
-- 适用：Supabase 控制台 → SQL Editor 粘贴执行（一次即可，可重复执行）
-- -----------------------------------------------------------------------------
-- 重要安全提醒（请务必阅读）：
--   1. 本文件所有 DDL / RLS / 存储桶策略均为【幂等】写法（create or replace、
--      if not exists、drop policy if exists、on conflict do nothing），可反复
--      粘贴执行而不会报错或重复创建。
--   2. RLS 已强制开启（P0-10 硬约束），projects / profiles / covers 桶均按
--      owner_id = auth.uid() / auth.uid() = id 隔离，杜绝裸奔。
--   3. 前端【只允许使用 anon / publishable key】，绝对、永远不要把
--      service_role key 写进 index.html 或任何前端代码（service_role 会绕过
--      RLS，等于把整库公开）。
--   4. 执行后建议用「非本人账号」做一次越权读取冒烟测试，应返回空结果。
-- =============================================================================

begin;

-- =============================================================================
-- 0. 扩展：pgcrypto（提供 gen_random_uuid，虽然 projects.id 沿用本地 uuid 字符串，
--    但保留扩展以备他用；create extension 幂等）
-- =============================================================================
create extension if not exists pgcrypto;

-- =============================================================================
-- 1. profiles 表（与 auth.users 1:1）
--    id 同 auth.uid()；display_name 为可选展示名，默认空。
-- =============================================================================
create table if not exists public.profiles (
  id           uuid        primary key references auth.users (id) on delete cascade,
  email        text,
  display_name text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is '用户档案，与 Supabase Auth 用户 1:1 对应';
comment on column public.profiles.id is '同 auth.users.id（= auth.uid()）';
comment on column public.profiles.display_name is '可选展示名，默认空';

-- =============================================================================
-- 2. projects 表（每行一个项目，整篇内容存 JSONB）
--    id 沿用本地 IndexedDB 的 uuid 字符串（迁移不改 id，避免引用错位），
--    故使用 text 主键，而非 gen_random_uuid()。
-- =============================================================================
create table if not exists public.projects (
  id          text        primary key,  -- 本地 uid() 生成的 UUID 字符串
  owner_id    uuid        not null references auth.users (id) on delete cascade,
  type        text        not null check (type in ('forum', 'pickup')),
  title       text        not null default '未命名小说',
  cover_image jsonb,                   -- 首版内联 {dataUrl, name}；T10 后再追加 storagePath
  data        jsonb       not null,    -- 整篇内容：论坛体 floors / 聊天体 chats
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()  -- LWW 冲突判定依据
);

comment on table public.projects is '云端项目表，每行一个小说项目（论坛体/聊天体）';
comment on column public.projects.id is '沿用本地 IndexedDB 的 uuid 字符串，迁移不改 id';
comment on column public.projects.owner_id is 'RLS 判定依据，指向 auth.users.id';
comment on column public.projects.cover_image is '首版内联 {dataUrl,name}；P1-1 双写后追加 storagePath';
comment on column public.projects.data is '整篇内容 JSONB（forum: cover/floors/settings；pickup: chats/settings/coverImage）';
comment on column public.projects.updated_at is 'last-write-wins 唯一判定依据，由客户端写入';

-- =============================================================================
-- 3. 自动建档触发器：auth.users 新增即向 profiles 写入一行
--    使用 security definer 函数，避免权限问题；已存在则 on conflict do nothing。
-- =============================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

comment on function public.handle_new_user() is '注册新用户时自动建立 profiles 档案';

-- =============================================================================
-- 4. updated_at 自动维护：在 profiles 与 projects 上建 before update 触发器
-- =============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is '更新行时自动刷新 updated_at 为当前时间';

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists set_projects_updated_at on public.projects;
create trigger set_projects_updated_at
  before update on public.projects
  for each row execute function public.set_updated_at();

-- =============================================================================
-- 5. RLS：开启行级安全（P0-10 硬约束）
-- =============================================================================
alter table public.profiles enable row level security;
alter table public.projects  enable row level security;

-- 5.1 profiles 策略：只能看/改自己的档案
drop policy if exists "profiles_select_self" on public.profiles;
create policy "profiles_select_self"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles_insert_self" on public.profiles;
create policy "profiles_insert_self"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "profiles_update_self" on public.profiles;
create policy "profiles_update_self"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 5.2 projects 策略：owner_id = auth.uid()
drop policy if exists "projects_select_own" on public.projects;
create policy "projects_select_own"
  on public.projects for select
  using (owner_id = auth.uid());

drop policy if exists "projects_insert_own" on public.projects;
create policy "projects_insert_own"
  on public.projects for insert
  with check (owner_id = auth.uid());

drop policy if exists "projects_update_own" on public.projects;
create policy "projects_update_own"
  on public.projects for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "projects_delete_own" on public.projects;
create policy "projects_delete_own"
  on public.projects for delete
  using (owner_id = auth.uid());

-- =============================================================================
-- 6. covers 存储桶（public=true，采用架构推荐决策）
--    公开读可让渲染 / 导出长图免签名 URL，路径以 owner_id 命名空间 + 随机文件名，
--    不可枚举，泄露风险极低。如需切私有，见本段末尾注释。
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('covers', 'covers', true)
on conflict (id) do nothing;

-- 6.1 covers 桶策略（公开读；写入/删除仅限本人命名空间）
drop policy if exists "covers_select" on storage.objects;
create policy "covers_select"
  on storage.objects for select
  using (bucket_id = 'covers');  -- 公开读，所有人可读

drop policy if exists "covers_insert_own" on storage.objects;
create policy "covers_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'covers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "covers_delete_own" on storage.objects;
create policy "covers_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'covers'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- -----------------------------------------------------------------------------
-- 若后续需要【私有读】covers 桶，请改为以下配置（并重新执行本段）：
--   insert into storage.buckets (id, name, public)
--     values ('covers','covers', false) on conflict (id) do update set public = false;
--   covers_select 改为：
--     using (bucket_id = 'covers' and (storage.foldername(name))[1] = auth.uid()::text);
--   前端渲染改用签名 URL：supabase.storage.from('covers').createSignedUrl(path, 3600)
-- -----------------------------------------------------------------------------

commit;

-- =============================================================================
-- 7. Realtime：将 public.projects 加入发布（首批即做，支持多端实时订阅）
--    使用 do block 判断，避免重复加入时报错；若 publication 不存在则先创建。
--    开启后前端可用：
--      supabase.channel('...').on('postgres_changes',
--        { event: '*', schema: 'public', table: 'projects' }, cb)
--    订阅项目变更，实现多设备实时更新（对应 P2-1，本期提前落地）。
-- =============================================================================
do $$
begin
  -- 确保 publication 存在（Supabase 默认名为 supabase_realtime）
  if not exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    create publication supabase_realtime;
  end if;

  -- 仅当 projects 尚未加入时才加入，避免重复加入报错
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'projects'
  ) then
    alter publication supabase_realtime add table public.projects;
  end if;
end $$;

-- =============================================================================
-- 执行完成。请在 Supabase 控制台验证：
--   1) Table Editor 可见 profiles / projects 两表；
--   2) Storage → Buckets 可见 covers（public）；
--   3) Database → Publications 中 supabase_realtime 包含 public.projects；
--   4) 用非本人账号冒烟测试越权读取，应返回空（验证 RLS 生效）。
-- =============================================================================
