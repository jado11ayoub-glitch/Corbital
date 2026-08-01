-- ============================================================
-- Corbits database schema — run this once in the Supabase SQL Editor
-- (Dashboard → SQL Editor → New query → paste this whole file → Run)
--
-- Design notes:
--  - No Supabase Auth is used (keeps the "no email required" login).
--  - Every table has Row Level Security enabled with ZERO policies,
--    which means the anon/publishable key can never read or write
--    these tables directly — not even by accident. All access goes
--    through the SECURITY DEFINER functions below, each of which
--    checks its own rules before touching data.
--  - Passwords are hashed with bcrypt via Postgres's pgcrypto
--    extension, server-side. The app never sees or stores a raw
--    password hash — only pass/fail answers from these functions.
--  - Known limitation: because there's no real login session (no
--    Supabase Auth JWT), these functions trust the "acting username"
--    passed in from the app. That's fine for a friends-only trial —
--    it is not hardened against someone deliberately calling the API
--    with a different username via browser devtools. Upgrading to
--    real session-based auth is a separate, larger step.
-- ============================================================

create extension if not exists pgcrypto;

-- ---------- tables ----------
create table if not exists accounts (
  username text primary key,
  display_name text not null,
  avatar text not null default '🙂',
  password_hash text not null,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists friend_requests (
  from_user text not null references accounts(username) on delete cascade,
  to_user   text not null references accounts(username) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (from_user, to_user)
);

create table if not exists friendships (
  user_a text not null references accounts(username) on delete cascade,
  user_b text not null references accounts(username) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b)
);

create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  owner text not null references accounts(username) on delete cascade,
  day_index int not null,
  act text not null,
  color text not null,
  time_label text not null,
  note text not null default '',
  audience text not null default 'Everyone',
  is_range boolean not null default false,
  tags text[] not null default '{}',
  done boolean not null default false,
  created_at timestamptz not null default now()
);

alter table accounts enable row level security;
alter table friend_requests enable row level security;
alter table friendships enable row level security;
alter table plans enable row level security;
revoke all on accounts, friend_requests, friendships, plans from anon, authenticated;

-- safe public columns only, used for search results
create or replace view public_accounts as
  select username, display_name, avatar from accounts;
grant select on public_accounts to anon;

-- ---------- accounts ----------
create or replace function signup(p_username text, p_display_name text, p_password text, p_email text default null)
returns json language plpgsql security definer as $$
declare v_key text := lower(p_username);
begin
  if p_username !~ '^[A-Za-z0-9_]{3,20}$' then
    return json_build_object('ok', false, 'error', 'bad_username');
  end if;
  if length(p_password) <= 6 then
    return json_build_object('ok', false, 'error', 'weak_password');
  end if;
  if exists (select 1 from accounts where lower(username) = v_key) then
    return json_build_object('ok', false, 'error', 'taken');
  end if;
  insert into accounts(username, display_name, password_hash, email)
    values (p_username, p_display_name, crypt(p_password, gen_salt('bf')), nullif(trim(p_email), ''));
  return json_build_object('ok', true);
end $$;
grant execute on function signup(text,text,text,text) to anon;

create or replace function login(p_username text, p_password text)
returns json language plpgsql security definer as $$
declare r accounts;
begin
  select * into r from accounts where lower(username) = lower(p_username);
  if r is null or crypt(p_password, r.password_hash) <> r.password_hash then
    return json_build_object('ok', false);
  end if;
  return json_build_object('ok', true, 'username', r.username, 'display_name', r.display_name,
    'avatar', r.avatar, 'has_email', r.email is not null);
end $$;
grant execute on function login(text,text) to anon;

create or replace function change_password(p_username text, p_old text, p_new text)
returns json language plpgsql security definer as $$
declare r accounts;
begin
  select * into r from accounts where lower(username) = lower(p_username);
  if r is null or crypt(p_old, r.password_hash) <> r.password_hash then
    return json_build_object('ok', false, 'error', 'bad_password');
  end if;
  if length(p_new) <= 6 then
    return json_build_object('ok', false, 'error', 'weak_password');
  end if;
  update accounts set password_hash = crypt(p_new, gen_salt('bf')) where username = r.username;
  return json_build_object('ok', true);
end $$;
grant execute on function change_password(text,text,text) to anon;

-- p_email: pass '__unchanged__' to leave the stored email untouched (used
-- when the client only ever sees a masked version and re-saves the form),
-- '' to clear it, or a real address to set/replace it.
create or replace function update_profile(p_username text, p_display_name text, p_avatar text, p_email text)
returns json language plpgsql security definer as $$
begin
  update accounts set
    display_name = p_display_name,
    avatar = p_avatar,
    email = case
      when p_email = '__unchanged__' then email
      when trim(p_email) = '' then null
      else lower(trim(p_email))
    end
    where lower(username) = lower(p_username);
  return json_build_object('ok', true);
end $$;
grant execute on function update_profile(text,text,text,text) to anon;

-- masked email only — the raw address never has to leave the database
create or replace function get_masked_email(p_username text)
returns json language sql security definer as $$
  select case when email is null then json_build_object('has_email', false)
    else json_build_object('has_email', true,
      'masked', substr(split_part(email,'@',1),1,1) || '•••@' || split_part(email,'@',2))
    end
  from accounts where lower(username) = lower(p_username);
$$;
grant execute on function get_masked_email(text) to anon;

-- forgot-password (email lookup + reset). The 6-digit code is still
-- verified client-side for now — see chat notes on real email sending.
create or replace function find_account_by_email(p_email text)
returns json language sql security definer as $$
  select case when exists (select 1 from accounts where email = lower(trim(p_email)))
    then json_build_object('ok', true, 'username', (select username from accounts where email = lower(trim(p_email)) limit 1))
    else json_build_object('ok', false) end;
$$;
grant execute on function find_account_by_email(text) to anon;

create or replace function reset_password(p_username text, p_new text)
returns json language plpgsql security definer as $$
begin
  if length(p_new) <= 6 then
    return json_build_object('ok', false, 'error', 'weak_password');
  end if;
  update accounts set password_hash = crypt(p_new, gen_salt('bf')) where lower(username) = lower(p_username);
  return json_build_object('ok', true);
end $$;
grant execute on function reset_password(text,text) to anon;

-- ---------- friends ----------
create or replace function search_accounts(p_query text, p_exclude text)
returns setof public_accounts language sql security definer as $$
  select username, display_name, avatar from accounts
   where lower(username) <> lower(p_exclude)
     and (lower(username) like '%' || lower(p_query) || '%' or lower(display_name) like '%' || lower(p_query) || '%')
   limit 8;
$$;
grant execute on function search_accounts(text,text) to anon;

create or replace function send_friend_request(p_from text, p_to text)
returns json language plpgsql security definer as $$
begin
  if lower(p_from) = lower(p_to) then
    return json_build_object('ok', false, 'error', 'self');
  end if;
  if exists (select 1 from friendships where (user_a=p_from and user_b=p_to) or (user_a=p_to and user_b=p_from)) then
    return json_build_object('ok', false, 'error', 'already_friends');
  end if;
  insert into friend_requests(from_user, to_user) values (p_from, p_to) on conflict do nothing;
  if exists (select 1 from friend_requests where from_user = p_to and to_user = p_from) then
    insert into friendships(user_a, user_b) values (p_from, p_to) on conflict do nothing;
    delete from friend_requests where (from_user=p_from and to_user=p_to) or (from_user=p_to and to_user=p_from);
    return json_build_object('ok', true, 'status', 'friends');
  end if;
  return json_build_object('ok', true, 'status', 'requested');
end $$;
grant execute on function send_friend_request(text,text) to anon;

create or replace function accept_friend_request(p_me text, p_from text)
returns json language plpgsql security definer as $$
begin
  delete from friend_requests where from_user = p_from and to_user = p_me;
  insert into friendships(user_a, user_b) values (p_from, p_me) on conflict do nothing;
  return json_build_object('ok', true);
end $$;
grant execute on function accept_friend_request(text,text) to anon;

-- cancel a request you sent that hasn't been accepted yet
create or replace function cancel_friend_request(p_me text, p_to text)
returns json language plpgsql security definer as $$
begin
  delete from friend_requests where from_user = p_me and to_user = p_to;
  return json_build_object('ok', true);
end $$;
grant execute on function cancel_friend_request(text,text) to anon;

-- decline a request someone sent you
create or replace function decline_friend_request(p_me text, p_from text)
returns json language plpgsql security definer as $$
begin
  delete from friend_requests where from_user = p_from and to_user = p_me;
  return json_build_object('ok', true);
end $$;
grant execute on function decline_friend_request(text,text) to anon;

-- remove an existing friend ("unadd")
create or replace function remove_friend(p_me text, p_other text)
returns json language plpgsql security definer as $$
begin
  delete from friendships where (user_a = p_me and user_b = p_other) or (user_a = p_other and user_b = p_me);
  return json_build_object('ok', true);
end $$;
grant execute on function remove_friend(text,text) to anon;

create or replace function list_friends(p_me text)
returns setof public_accounts language sql security definer as $$
  select a.username, a.display_name, a.avatar from accounts a
  join friendships f on (f.user_a = a.username and f.user_b = p_me) or (f.user_b = a.username and f.user_a = p_me);
$$;
grant execute on function list_friends(text) to anon;

create or replace function list_incoming_requests(p_me text)
returns setof public_accounts language sql security definer as $$
  select a.username, a.display_name, a.avatar from accounts a
  join friend_requests r on r.from_user = a.username
  where r.to_user = p_me;
$$;
grant execute on function list_incoming_requests(text) to anon;

create or replace function list_outgoing_requests(p_me text)
returns setof public_accounts language sql security definer as $$
  select a.username, a.display_name, a.avatar from accounts a
  join friend_requests r on r.to_user = a.username
  where r.from_user = p_me;
$$;
grant execute on function list_outgoing_requests(text) to anon;

-- ---------- scheduled workouts (SCHD), shared with friends ----------
-- "Only me" plans are visible only to the owner; anything else is
-- visible to the owner and to their accepted friends. Cancelled plans
-- stay in the table (soft delete) so friends who saw the original post
-- see "Event cancelled" instead of it silently disappearing, and can
-- no longer join it.
alter table plans add column if not exists cancelled boolean not null default false;

create table if not exists plan_joins (
  plan_id uuid not null references plans(id) on delete cascade,
  requester text not null references accounts(username) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (plan_id, requester)
);
alter table plan_joins enable row level security;
revoke all on plan_joins from anon, authenticated;

alter table plans add column if not exists edited boolean not null default false;

drop function if exists list_plans(text, text);
create function list_plans(p_me text, p_owner text)
returns table (
  id uuid, owner text, day_index int, act text, color text, time_label text, note text,
  audience text, is_range boolean, tags text[], done boolean, cancelled boolean, edited boolean,
  created_at timestamptz, join_count bigint, joined_by_me boolean
) language sql security definer as $$
  select p.id, p.owner, p.day_index, p.act, p.color, p.time_label, p.note,
    p.audience, p.is_range, p.tags, p.done, p.cancelled, p.edited, p.created_at,
    (select count(*) from plan_joins j where j.plan_id = p.id) as join_count,
    exists(select 1 from plan_joins j where j.plan_id = p.id and j.requester = p_me) as joined_by_me
  from plans p
  where p.owner = p_owner
    and (
      p_owner = p_me
      or (p.audience <> 'Only me' and exists (
        select 1 from friendships f where (f.user_a = p_owner and f.user_b = p_me) or (f.user_b = p_owner and f.user_a = p_me)
      ))
    );
$$;
grant execute on function list_plans(text,text) to anon;

-- every plan any of your friends have posted to you, newest first —
-- what actually powers the FRIENDS feed
drop function if exists list_friends_feed(text);
create function list_friends_feed(p_me text)
returns table (
  id uuid, owner text, owner_display text, owner_avatar text, day_index int, act text, color text,
  time_label text, note text, audience text, is_range boolean, tags text[], cancelled boolean, edited boolean,
  created_at timestamptz, join_count bigint, joined_by_me boolean
) language sql security definer as $$
  select p.id, p.owner, a.display_name, a.avatar, p.day_index, p.act, p.color, p.time_label, p.note,
    p.audience, p.is_range, p.tags, p.cancelled, p.edited, p.created_at,
    (select count(*) from plan_joins j where j.plan_id = p.id) as join_count,
    exists(select 1 from plan_joins j where j.plan_id = p.id and j.requester = p_me) as joined_by_me
  from plans p
  join accounts a on a.username = p.owner
  where p.owner <> p_me
    and p.audience <> 'Only me'
    and exists (
      select 1 from friendships f where (f.user_a = p.owner and f.user_b = p_me) or (f.user_b = p.owner and f.user_a = p_me)
    )
  order by p.created_at desc
  limit 30;
$$;
grant execute on function list_friends_feed(text) to anon;

-- request to join a friend's posted plan (blocked once it's cancelled)
create or replace function request_join_plan(p_me text, p_plan_id uuid)
returns json language plpgsql security definer as $$
declare v_owner text; v_cancelled boolean;
begin
  select owner, cancelled into v_owner, v_cancelled from plans where id = p_plan_id;
  if v_owner is null then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if v_cancelled then return json_build_object('ok', false, 'error', 'cancelled'); end if;
  if v_owner = p_me then return json_build_object('ok', false, 'error', 'own_plan'); end if;
  insert into plan_joins(plan_id, requester) values (p_plan_id, p_me) on conflict do nothing;
  return json_build_object('ok', true);
end $$;
grant execute on function request_join_plan(text,uuid) to anon;

-- cancel a posted plan (soft delete) — it stays visible, marked
-- "Cancelled", on your own calendar and on friends' feeds/schedules who
-- already saw it, and can no longer be requested to join. Reports ok:false
-- if nothing was actually updated (wrong id / not the owner) instead of
-- silently claiming success.
create or replace function cancel_plan(p_me text, p_id uuid)
returns json language plpgsql security definer as $$
declare v_rows int;
begin
  update plans set cancelled = true where id = p_id and owner = p_me;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return json_build_object('ok', false, 'error', 'not_found'); end if;
  return json_build_object('ok', true);
end $$;
grant execute on function cancel_plan(text,uuid) to anon;

-- editing an existing plan (p_id not null) flags it "edited" so viewers
-- see "(edited)" next to it; brand-new plans (p_id null) start unedited.
create or replace function upsert_plan(
  p_me text, p_id uuid, p_day int, p_act text, p_color text, p_time text,
  p_note text, p_audience text, p_range boolean, p_tags text[])
returns plans language plpgsql security definer as $$
declare r plans;
begin
  if p_id is null then
    insert into plans(owner, day_index, act, color, time_label, note, audience, is_range, tags)
      values (p_me, p_day, p_act, p_color, p_time, p_note, p_audience, p_range, p_tags)
      returning * into r;
  else
    update plans set day_index=p_day, act=p_act, color=p_color, time_label=p_time, note=p_note,
      audience=p_audience, is_range=p_range, tags=p_tags, edited=true
      where id = p_id and owner = p_me
      returning * into r;
  end if;
  return r;
end $$;
grant execute on function upsert_plan(text,uuid,int,text,text,text,text,text,boolean,text[]) to anon;

create or replace function delete_plan(p_me text, p_id uuid)
returns json language plpgsql security definer as $$
begin
  delete from plans where id = p_id and owner = p_me;
  return json_build_object('ok', true);
end $$;
grant execute on function delete_plan(text,uuid) to anon;

create or replace function set_plan_done(p_me text, p_id uuid, p_done boolean)
returns json language plpgsql security definer as $$
begin
  update plans set done = p_done where id = p_id and owner = p_me;
  return json_build_object('ok', true);
end $$;
grant execute on function set_plan_done(text,uuid,boolean) to anon;

-- ---------- real verification emails ----------
-- Codes are generated and checked entirely server-side now (never sent
-- to or compared in the browser). Sending goes through SendGrid via
-- pg_net, an HTTP client built into Postgres — no Edge Function or CLI
-- needed. The API key and verified sender address are read from
-- Supabase Vault, NOT from this file, so nothing secret ever gets
-- committed to the repo. See the chat for the one-time Vault setup.
create extension if not exists pg_net;

create table if not exists verification_codes (
  username text primary key references accounts(username) on delete cascade,
  code text not null,
  expires_at timestamptz not null
);
alter table verification_codes enable row level security;
revoke all on verification_codes from anon, authenticated;

create or replace function send_verification_email(p_username text)
returns json language plpgsql security definer as $$
declare
  v_email text;
  v_code text;
  v_api_key text;
  v_sender text;
begin
  select email into v_email from accounts where lower(username) = lower(p_username);
  if v_email is null then
    return json_build_object('ok', false, 'error', 'no_email');
  end if;

  select decrypted_secret into v_api_key from vault.decrypted_secrets where name = 'sendgrid_api_key';
  select decrypted_secret into v_sender from vault.decrypted_secrets where name = 'sendgrid_sender_email';
  if v_api_key is null or v_sender is null then
    return json_build_object('ok', false, 'error', 'email_not_configured');
  end if;

  v_code := lpad(floor(random() * 1000000)::text, 6, '0');
  insert into verification_codes(username, code, expires_at)
    values (p_username, v_code, now() + interval '10 minutes')
    on conflict (username) do update set code = excluded.code, expires_at = excluded.expires_at;

  perform net.http_post(
    url := 'https://api.sendgrid.com/v3/mail/send',
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_api_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'personalizations', jsonb_build_array(jsonb_build_object('to', jsonb_build_array(jsonb_build_object('email', v_email)))),
      'from', jsonb_build_object('email', v_sender, 'name', 'Corbitals'),
      'subject', 'Your Corbitals verification code',
      'content', jsonb_build_array(jsonb_build_object(
        'type', 'text/plain',
        'value', 'Your Corbitals verification code is: ' || v_code || E'\n\nThis code expires in 10 minutes. If you didn''t request this, you can ignore it.'
      ))
    )
  );
  return json_build_object('ok', true);
end $$;
grant execute on function send_verification_email(text) to anon;

create or replace function verify_code(p_username text, p_code text)
returns json language plpgsql security definer as $$
declare r verification_codes;
begin
  select * into r from verification_codes where username = p_username;
  if r is null or r.code <> p_code or r.expires_at < now() then
    return json_build_object('ok', false);
  end if;
  delete from verification_codes where username = p_username;
  return json_build_object('ok', true);
end $$;
grant execute on function verify_code(text,text) to anon;

-- ---------- demo accounts (password: friends1) ----------
insert into accounts(username, display_name, avatar, password_hash) values
  ('maya','Maya 🏋️','🐆', crypt('friends1', gen_salt('bf'))),
  ('sam','Sam ⚡','⚡', crypt('friends1', gen_salt('bf'))),
  ('dev','Dev 📚','🎧', crypt('friends1', gen_salt('bf'))),
  ('lena','Lena 🏃','🌊', crypt('friends1', gen_salt('bf')))
on conflict (username) do nothing;
