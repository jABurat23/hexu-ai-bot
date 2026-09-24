-- Run this in the Supabase SQL Editor for your project.
-- If you're reusing the Classboard project, these are new tables and won't
-- touch anything Classboard already has.

create table if not exists users (
  psid text primary key,
  access_role text not null default 'USER',
  created_at timestamptz not null default now()
);

create table if not exists messages (
  id bigint generated always as identity primary key,
  psid text not null references users(psid) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists messages_psid_created_at_idx
  on messages (psid, created_at desc);

-- Migration: tags rows saved via the !ai command so they can be queried
-- separately from the generic message log. Existing rows get NULL, which
-- is treated as "not an AI message" — no backfill needed.
alter table messages add column if not exists source text;
create index if not exists messages_psid_source_created_at_idx
  on messages (psid, source, created_at desc);

create table if not exists processed_messages (
  message_id text primary key,
  psid text not null references users(psid) on delete cascade,
  received_at timestamptz not null default now()
);

create index if not exists processed_messages_received_at_idx
  on processed_messages (received_at);

create table if not exists blocked_users (
  psid text primary key references users(psid) on delete cascade,
  reason text not null default 'No reason provided',
  blocked_by text not null references users(psid),
  blocked_at timestamptz not null default now()
);

create table if not exists user_warnings (
  id bigint generated always as identity primary key,
  psid text not null references users(psid) on delete cascade,
  reason text not null,
  warned_by text not null references users(psid),
  created_at timestamptz not null default now()
);

create index if not exists user_warnings_psid_created_at_idx
  on user_warnings (psid, created_at desc);

create table if not exists moderation_audit (
  id bigint generated always as identity primary key,
  action text not null,
  target_psid text not null,
  actor_psid text not null references users(psid),
  details text,
  created_at timestamptz not null default now()
);

create index if not exists moderation_audit_target_created_at_idx
  on moderation_audit (target_psid, created_at desc);