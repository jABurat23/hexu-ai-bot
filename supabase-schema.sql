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
