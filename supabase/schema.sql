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

-- simple optional poll on a regular SCHD "Plan" post — deliberately
-- minimal compared to PLANNIT's poll: the poster sets the options once
-- (at post time), nobody can add more, and a vote can be changed but
-- that's it — no lock-in, no separate title.
create table if not exists plan_poll_options (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id) on delete cascade,
  label text not null,
  created_at timestamptz not null default now()
);
alter table plan_poll_options enable row level security;
revoke all on plan_poll_options from anon, authenticated;

create table if not exists plan_poll_votes (
  plan_id uuid not null references plans(id) on delete cascade,
  member text not null references accounts(username) on delete cascade,
  option_id uuid not null references plan_poll_options(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (plan_id, member)
);
alter table plan_poll_votes enable row level security;
revoke all on plan_poll_votes from anon, authenticated;

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

-- ---------- circles: one reusable, persistent audience-group concept ----------
-- used everywhere an audience/recipient list is picked (composer "Who
-- can see", Privacy circles, PLANNIT send-to) instead of privacy
-- circles / send-groups / search groups being three separate ideas.
create table if not exists circles (
  id uuid primary key default gen_random_uuid(),
  owner text not null references accounts(username) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (owner, name)
);
alter table circles enable row level security;
revoke all on circles from anon, authenticated;

create table if not exists circle_members (
  circle_id uuid not null references circles(id) on delete cascade,
  member text not null references accounts(username) on delete cascade,
  primary key (circle_id, member)
);
alter table circle_members enable row level security;
revoke all on circle_members from anon, authenticated;

create or replace function create_circle(p_me text, p_name text)
returns json language plpgsql security definer as $$
declare v_id uuid;
begin
  if length(trim(coalesce(p_name,''))) = 0 then return json_build_object('ok', false, 'error', 'empty'); end if;
  insert into circles(owner, name) values (p_me, trim(p_name))
    on conflict (owner, name) do nothing
    returning id into v_id;
  if v_id is null then return json_build_object('ok', false, 'error', 'taken'); end if;
  return json_build_object('ok', true, 'id', v_id);
end $$;
grant execute on function create_circle(text,text) to anon;

create or replace function delete_circle(p_me text, p_id uuid)
returns json language plpgsql security definer as $$
begin
  delete from circles where id = p_id and owner = p_me;
  return json_build_object('ok', true);
end $$;
grant execute on function delete_circle(text,uuid) to anon;

create or replace function set_circle_member(p_me text, p_id uuid, p_member text, p_in boolean)
returns json language plpgsql security definer as $$
begin
  if not exists (select 1 from circles where id = p_id and owner = p_me) then
    return json_build_object('ok', false, 'error', 'not_found');
  end if;
  if not exists (
    select 1 from friendships where (user_a = p_me and user_b = p_member) or (user_a = p_member and user_b = p_me)
  ) then
    return json_build_object('ok', false, 'error', 'not_friends');
  end if;
  if p_in then
    insert into circle_members(circle_id, member) values (p_id, p_member) on conflict do nothing;
  else
    delete from circle_members where circle_id = p_id and member = p_member;
  end if;
  return json_build_object('ok', true);
end $$;
grant execute on function set_circle_member(text,uuid,text,boolean) to anon;

create or replace function list_my_circles(p_me text)
returns table (id uuid, name text, members text[])
language sql security definer as $$
  select c.id, c.name,
    coalesce(array_agg(cm.member order by cm.member) filter (where cm.member is not null), '{}')
  from circles c
  left join circle_members cm on cm.circle_id = c.id
  where c.owner = p_me
  group by c.id, c.name
  order by c.created_at;
$$;
grant execute on function list_my_circles(text) to anon;

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

-- one-time migration: day_index used to be counted relative to a fixed
-- prototype anchor date (Mon Jul 27 2026), so "today" only worked by
-- coincidence on the day this was built. It's now counted as real
-- calendar days since 1970-01-01, so it's always live. Old-style values
-- are small (well under 10000); shift them once to the new scheme. Safe
-- to re-run — once shifted, values are ~20000+ and this no-ops forever after.
do $$
begin
  if exists (select 1 from plans where day_index < 10000) then
    update plans set day_index = day_index + (date '2026-07-27' - date '1970-01-01')
      where day_index < 10000;
  end if;
end $$;

-- join requests now need the owner's approval instead of joining instantly —
-- 'pending' until the owner answers via the message with Yes/No buttons.
alter table plan_joins add column if not exists status text not null default 'pending' check (status in ('pending','accepted'));
-- has_left, not "left" — "left" collides visually with the LEFT JOIN keyword
alter table plan_joins add column if not exists has_left boolean not null default false;

drop function if exists list_plans(text, text);
drop function if exists list_plans(text,text);
create function list_plans(p_me text, p_owner text)
returns table (
  id uuid, owner text, day_index int, act text, color text, time_label text, note text,
  audience text, is_range boolean, tags text[], done boolean, cancelled boolean, edited boolean,
  created_at timestamptz, join_count bigint, my_join_status text, poll_count bigint
) language sql security definer as $$
  select p.id, p.owner, p.day_index, p.act, p.color, p.time_label, p.note,
    p.audience, p.is_range, p.tags, p.done, p.cancelled, p.edited, p.created_at,
    (select count(*) from plan_joins j where j.plan_id = p.id and j.status = 'accepted' and j.has_left = false) as join_count,
    (select j.status from plan_joins j where j.plan_id = p.id and j.requester = p_me and j.has_left = false) as my_join_status,
    (select count(*) from plan_poll_options o where o.plan_id = p.id) as poll_count
  from plans p
  where p.owner = p_owner
    and (
      p_owner = p_me
      or (
        p.audience <> 'Only me'
        and exists (
          select 1 from friendships f where (f.user_a = p_owner and f.user_b = p_me) or (f.user_b = p_owner and f.user_a = p_me)
        )
        and (
          -- audience isn't one of the owner's real circles (e.g. "Everyone") -> visible to all their friends
          not exists (select 1 from circles c where c.owner = p_owner and c.name = p.audience)
          -- audience IS a real circle -> only that circle's members can see it
          or exists (
            select 1 from circles c join circle_members cm on cm.circle_id = c.id
            where c.owner = p_owner and c.name = p.audience and cm.member = p_me
          )
        )
      )
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
  created_at timestamptz, join_count bigint, my_join_status text, poll_count bigint
) language sql security definer as $$
  select p.id, p.owner, a.display_name, a.avatar, p.day_index, p.act, p.color, p.time_label, p.note,
    p.audience, p.is_range, p.tags, p.cancelled, p.edited, p.created_at,
    (select count(*) from plan_joins j where j.plan_id = p.id and j.status = 'accepted' and j.has_left = false) as join_count,
    (select j.status from plan_joins j where j.plan_id = p.id and j.requester = p_me and j.has_left = false) as my_join_status,
    (select count(*) from plan_poll_options o where o.plan_id = p.id) as poll_count
  from plans p
  join accounts a on a.username = p.owner
  where p.owner <> p_me
    and p.audience <> 'Only me'
    and exists (
      select 1 from friendships f where (f.user_a = p.owner and f.user_b = p_me) or (f.user_b = p.owner and f.user_a = p_me)
    )
    and (
      not exists (select 1 from circles c where c.owner = p.owner and c.name = p.audience)
      or exists (
        select 1 from circles c join circle_members cm on cm.circle_id = c.id
        where c.owner = p.owner and c.name = p.audience and cm.member = p_me
      )
    )
  order by p.created_at desc
  limit 30;
$$;
grant execute on function list_friends_feed(text) to anon;

-- ---------- blocking ----------
create table if not exists blocks (
  blocker text not null references accounts(username) on delete cascade,
  blocked text not null references accounts(username) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker, blocked)
);
alter table blocks enable row level security;
revoke all on blocks from anon, authenticated;

create or replace function block_user(p_me text, p_target text)
returns json language plpgsql security definer as $$
begin
  if p_target = p_me then return json_build_object('ok', false, 'error', 'self'); end if;
  insert into blocks(blocker, blocked) values (p_me, p_target) on conflict do nothing;
  return json_build_object('ok', true);
end $$;
grant execute on function block_user(text,text) to anon;

create or replace function unblock_user(p_me text, p_target text)
returns json language plpgsql security definer as $$
begin
  delete from blocks where blocker = p_me and blocked = p_target;
  return json_build_object('ok', true);
end $$;
grant execute on function unblock_user(text,text) to anon;

-- ---------- messaging: direct messages + join requests ----------
-- a join request is just a special dm_messages row (kind='join_request')
-- from the requester to the event owner, rendered with Yes/No buttons
-- until answered.
create table if not exists dm_messages (
  id uuid primary key default gen_random_uuid(),
  sender text not null references accounts(username) on delete cascade,
  recipient text not null references accounts(username) on delete cascade,
  body text not null,
  kind text not null default 'text' check (kind in ('text','join_request')),
  plan_id uuid references plans(id) on delete cascade,
  request_status text check (request_status in ('pending','accepted','declined')),
  created_at timestamptz not null default now()
);
alter table dm_messages enable row level security;
revoke all on dm_messages from anon, authenticated;
create index if not exists dm_messages_thread_idx on dm_messages (least(sender,recipient), greatest(sender,recipient), created_at);

-- a PLANNIT invite is just another special dm_messages row, same pattern
-- as a join_request — rendered with Yes/No until answered.
alter table dm_messages drop constraint if exists dm_messages_kind_check;
alter table dm_messages add constraint dm_messages_kind_check check (kind in ('text','join_request','plannit_invite'));
alter table dm_messages add column if not exists plannit_event_id uuid;

-- ---------- messaging: per-event group chats ----------
-- membership is derived, not stored: the plan's owner, plus anyone with
-- an accepted (and not left) plan_joins row.
create table if not exists event_messages (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references plans(id) on delete cascade,
  sender text not null references accounts(username) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
alter table event_messages enable row level security;
revoke all on event_messages from anon, authenticated;

create table if not exists message_reads (
  username text primary key references accounts(username) on delete cascade,
  last_read_at timestamptz not null default '1970-01-01'
);
alter table message_reads enable row level security;
revoke all on message_reads from anon, authenticated;

-- internal helper — not exposed to anon directly, only called from
-- inside other security definer functions below.
create or replace function is_event_member(p_plan_id uuid, p_me text)
returns boolean language sql security definer as $$
  select exists(select 1 from plans p where p.id = p_plan_id and p.owner = p_me)
    or exists(
      select 1 from plan_joins j
      where j.plan_id = p_plan_id and j.requester = p_me and j.status = 'accepted' and j.has_left = false
    );
$$;

-- ---------- simple optional poll on a regular SCHD "Plan" post ----------
-- (tables defined earlier, right after `plans`, so list_plans/
-- list_friends_feed above can reference plan_poll_options)
-- shared visibility check (mirrors list_plans/list_friends_feed/request_join_plan's
-- rule): the owner always sees their own plan; a friend sees it unless the
-- audience is "Only me" or a real circle they're not a member of.
create or replace function can_see_plan(p_plan_id uuid, p_viewer text)
returns boolean language sql security definer as $$
  select exists (
    select 1 from plans p
    where p.id = p_plan_id
      and (
        p.owner = p_viewer
        or (
          p.audience <> 'Only me'
          and exists (select 1 from friendships f where (f.user_a = p.owner and f.user_b = p_viewer) or (f.user_b = p.owner and f.user_a = p_viewer))
          and (
            not exists (select 1 from circles c where c.owner = p.owner and c.name = p.audience)
            or exists (select 1 from circles c join circle_members cm on cm.circle_id = c.id where c.owner = p.owner and c.name = p.audience and cm.member = p_viewer)
          )
        )
      )
  );
$$;

-- owner-only, replaces the whole option set (used right when posting) —
-- passing an empty array clears the poll entirely.
create or replace function set_plan_poll_options(p_me text, p_plan_id uuid, p_labels text[])
returns json language plpgsql security definer as $$
declare v_rows int; v_label text;
begin
  if not exists (select 1 from plans where id = p_plan_id and owner = p_me) then
    return json_build_object('ok', false, 'error', 'not_found');
  end if;
  delete from plan_poll_options where plan_id = p_plan_id;
  foreach v_label in array coalesce(p_labels, '{}') loop
    if length(trim(v_label)) = 0 then continue; end if;
    insert into plan_poll_options(plan_id, label) values (p_plan_id, trim(v_label));
  end loop;
  return json_build_object('ok', true);
end $$;
grant execute on function set_plan_poll_options(text,uuid,text[]) to anon;

-- p_option_id = null clears the caller's own vote
create or replace function vote_plan_poll(p_me text, p_plan_id uuid, p_option_id uuid)
returns json language plpgsql security definer as $$
begin
  if not can_see_plan(p_plan_id, p_me) then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if p_option_id is null then
    delete from plan_poll_votes where plan_id = p_plan_id and member = p_me;
    return json_build_object('ok', true);
  end if;
  if not exists (select 1 from plan_poll_options where id = p_option_id and plan_id = p_plan_id) then
    return json_build_object('ok', false, 'error', 'not_found');
  end if;
  insert into plan_poll_votes(plan_id, member, option_id) values (p_plan_id, p_me, p_option_id)
    on conflict (plan_id, member) do update set option_id = excluded.option_id, created_at = now();
  return json_build_object('ok', true);
end $$;
grant execute on function vote_plan_poll(text,uuid,uuid) to anon;

create or replace function list_plan_poll(p_me text, p_plan_id uuid)
returns table (option_id uuid, label text, vote_count bigint, my_vote boolean)
language plpgsql security definer as $$
begin
  if not can_see_plan(p_plan_id, p_me) then return; end if;
  return query
    select o.id, o.label,
      (select count(*) from plan_poll_votes v where v.option_id = o.id) as vote_count,
      exists(select 1 from plan_poll_votes v where v.option_id = o.id and v.member = p_me) as my_vote
    from plan_poll_options o
    where o.plan_id = p_plan_id
    order by o.created_at asc;
end $$;
grant execute on function list_plan_poll(text,uuid) to anon;

-- request to join a friend's posted plan (blocked once it's cancelled) —
-- creates a 'pending' join row AND sends the owner a join_request message
-- with Yes/No buttons; nothing is confirmed until they answer.
create or replace function request_join_plan(p_me text, p_plan_id uuid)
returns json language plpgsql security definer as $$
declare v_owner text; v_cancelled boolean; v_act text; v_audience text; v_existing text;
begin
  select owner, cancelled, act, audience into v_owner, v_cancelled, v_act, v_audience from plans where id = p_plan_id;
  if v_owner is null then return json_build_object('ok', false, 'error', 'not_found'); end if;
  if v_cancelled then return json_build_object('ok', false, 'error', 'cancelled'); end if;
  if v_owner = p_me then return json_build_object('ok', false, 'error', 'own_plan'); end if;
  if exists(select 1 from blocks where (blocker = p_me and blocked = v_owner) or (blocker = v_owner and blocked = p_me)) then
    return json_build_object('ok', false, 'error', 'blocked');
  end if;
  -- mirror list_plans/list_friends_feed's visibility rule: must be friends,
  -- and if the audience is a real circle you must actually be in it —
  -- otherwise you could request to join a plan you were never shown.
  if v_audience = 'Only me' or not exists (
    select 1 from friendships f where (f.user_a = v_owner and f.user_b = p_me) or (f.user_b = v_owner and f.user_a = p_me)
  ) then
    return json_build_object('ok', false, 'error', 'not_found');
  end if;
  if exists (select 1 from circles c where c.owner = v_owner and c.name = v_audience)
     and not exists (
       select 1 from circles c join circle_members cm on cm.circle_id = c.id
       where c.owner = v_owner and c.name = v_audience and cm.member = p_me
     ) then
    return json_build_object('ok', false, 'error', 'not_found');
  end if;

  select status into v_existing from plan_joins where plan_id = p_plan_id and requester = p_me and has_left = false;
  if v_existing = 'accepted' then return json_build_object('ok', false, 'error', 'already_joined'); end if;
  if v_existing = 'pending' then return json_build_object('ok', false, 'error', 'already_requested'); end if;

  insert into plan_joins(plan_id, requester, status, has_left) values (p_plan_id, p_me, 'pending', false)
    on conflict (plan_id, requester) do update set status = 'pending', has_left = false;
  insert into dm_messages(sender, recipient, body, kind, plan_id, request_status)
    values (p_me, v_owner, 'Can I join "' || v_act || '"?', 'join_request', p_plan_id, 'pending');
  return json_build_object('ok', true);
end $$;
grant execute on function request_join_plan(text,uuid) to anon;

-- owner answers a join request from their message inbox
create or replace function respond_join_request(p_me text, p_message_id uuid, p_accept boolean)
returns json language plpgsql security definer as $$
declare m dm_messages;
begin
  select * into m from dm_messages where id = p_message_id;
  if m is null or m.recipient <> p_me or m.kind <> 'join_request' then
    return json_build_object('ok', false, 'error', 'not_found');
  end if;
  if m.request_status <> 'pending' then
    return json_build_object('ok', false, 'error', 'already_answered');
  end if;

  update dm_messages set request_status = (case when p_accept then 'accepted' else 'declined' end)
    where id = p_message_id;

  if p_accept then
    update plan_joins set status = 'accepted' where plan_id = m.plan_id and requester = m.sender;
    insert into dm_messages(sender, recipient, body, kind) values (p_me, m.sender, 'Accepted you into the event ✓', 'text');
  else
    delete from plan_joins where plan_id = m.plan_id and requester = m.sender;
    insert into dm_messages(sender, recipient, body, kind) values (p_me, m.sender, 'Declined your join request', 'text');
  end if;
  return json_build_object('ok', true);
end $$;
grant execute on function respond_join_request(text,uuid,boolean) to anon;

-- direct message a friend (blocked users can't reach each other either direction)
create or replace function send_dm(p_me text, p_to text, p_body text)
returns json language plpgsql security definer as $$
begin
  if p_to = p_me then return json_build_object('ok', false, 'error', 'self'); end if;
  if length(trim(coalesce(p_body,''))) = 0 then return json_build_object('ok', false, 'error', 'empty'); end if;
  if not exists(select 1 from friendships where (user_a = p_me and user_b = p_to) or (user_a = p_to and user_b = p_me)) then
    return json_build_object('ok', false, 'error', 'not_friends');
  end if;
  if exists(select 1 from blocks where (blocker = p_me and blocked = p_to) or (blocker = p_to and blocked = p_me)) then
    return json_build_object('ok', false, 'error', 'blocked');
  end if;
  insert into dm_messages(sender, recipient, body) values (p_me, p_to, trim(p_body));
  return json_build_object('ok', true);
end $$;
grant execute on function send_dm(text,text,text) to anon;

-- one row per conversation, most recent message first — powers the
-- "Direct" list in the Messages sheet. Messages from anyone p_me has
-- blocked are hidden entirely (soft block, not deleted).
create or replace function list_dm_threads(p_me text)
returns table (
  other text, other_display text, other_avatar text,
  last_body text, last_kind text, last_request_status text, last_sender text,
  last_message_id uuid, last_at timestamptz
) language sql security definer as $$
  with mine as (
    select (case when sender = p_me then recipient else sender end) as other,
      id, body, kind, request_status, created_at, sender
    from dm_messages
    where (sender = p_me or recipient = p_me)
      and (case when sender = p_me then recipient else sender end) not in (select blocked from blocks where blocker = p_me)
  ),
  latest as (
    select distinct on (other) other, id, body, kind, request_status, created_at, sender
    from mine
    order by other, created_at desc
  )
  select l.other, a.display_name, a.avatar, l.body, l.kind, l.request_status, l.sender, l.id, l.created_at
  from latest l join accounts a on a.username = l.other
  order by l.created_at desc;
$$;
grant execute on function list_dm_threads(text) to anon;

create or replace function list_dm_messages(p_me text, p_other text)
returns table (
  id uuid, sender text, recipient text, body text, kind text,
  plan_id uuid, request_status text, created_at timestamptz
) language sql security definer as $$
  select id, sender, recipient, body, kind, plan_id, request_status, created_at
  from dm_messages
  where ((sender = p_me and recipient = p_other) or (sender = p_other and recipient = p_me))
    and sender not in (select blocked from blocks where blocker = p_me)
  order by created_at asc;
$$;
grant execute on function list_dm_messages(text,text) to anon;

-- post a message into an event's group chat (owner + accepted, not-left joiners only)
create or replace function send_event_message(p_me text, p_plan_id uuid, p_body text)
returns json language plpgsql security definer as $$
begin
  if length(trim(coalesce(p_body,''))) = 0 then return json_build_object('ok', false, 'error', 'empty'); end if;
  if not is_event_member(p_plan_id, p_me) then return json_build_object('ok', false, 'error', 'not_member'); end if;
  insert into event_messages(plan_id, sender, body) values (p_plan_id, p_me, trim(p_body));
  return json_build_object('ok', true);
end $$;
grant execute on function send_event_message(text,uuid,text) to anon;

create or replace function list_event_messages(p_me text, p_plan_id uuid)
returns table (id uuid, sender text, sender_display text, sender_avatar text, body text, created_at timestamptz)
language plpgsql security definer as $$
begin
  if not is_event_member(p_plan_id, p_me) then return; end if;
  return query
    select m.id, m.sender, a.display_name, a.avatar, m.body, m.created_at
    from event_messages m join accounts a on a.username = m.sender
    where m.plan_id = p_plan_id
      and m.sender not in (select blocked from blocks where blocker = p_me)
    order by m.created_at asc;
end $$;
grant execute on function list_event_messages(text,uuid) to anon;

create or replace function list_event_members(p_me text, p_plan_id uuid)
returns table (username text, display_name text, avatar text, is_owner boolean, blocked_by_me boolean)
language plpgsql security definer as $$
begin
  if not is_event_member(p_plan_id, p_me) then return; end if;
  return query
    select a.username, a.display_name, a.avatar, true as is_owner,
      exists(select 1 from blocks b where b.blocker = p_me and b.blocked = a.username) as blocked_by_me
    from plans p join accounts a on a.username = p.owner
    where p.id = p_plan_id
    union
    select a.username, a.display_name, a.avatar, false,
      exists(select 1 from blocks b where b.blocker = p_me and b.blocked = a.username)
    from plan_joins j join accounts a on a.username = j.requester
    where j.plan_id = p_plan_id and j.status = 'accepted' and j.has_left = false;
end $$;
grant execute on function list_event_members(text,uuid) to anon;

-- every event chat p_me belongs to (owner, or accepted & not-left joiner),
-- newest activity first — powers the "Events" list in the Messages sheet.
create or replace function list_my_event_chats(p_me text)
returns table (plan_id uuid, title text, owner text, cancelled boolean, last_body text, last_at timestamptz)
language sql security definer as $$
  with mine as (
    select p.id as plan_id, p.act, p.owner, p.cancelled, p.day_index from plans p where p.owner = p_me
    union
    select p.id, p.act, p.owner, p.cancelled, p.day_index
    from plan_joins j join plans p on p.id = j.plan_id
    where j.requester = p_me and j.status = 'accepted' and j.has_left = false
  )
  select t.* from (
    select m.plan_id,
      m.act || ' · ' || to_char(date '1970-01-01' + m.day_index, 'Dy') as title,
      m.owner, m.cancelled,
      (select body from event_messages em where em.plan_id = m.plan_id order by em.created_at desc limit 1) as last_body,
      (select em.created_at from event_messages em where em.plan_id = m.plan_id order by em.created_at desc limit 1) as last_at
    from mine m
  ) t
  order by coalesce(t.last_at, '1970-01-01'::timestamptz) desc;
$$;
grant execute on function list_my_event_chats(text) to anon;

-- leave an event's group chat — also revokes your join, so the event
-- stops counting you toward its join_count and you'd need to re-request.
create or replace function leave_event_chat(p_me text, p_plan_id uuid)
returns json language plpgsql security definer as $$
declare v_rows int;
begin
  update plan_joins set has_left = true
    where plan_id = p_plan_id and requester = p_me and status = 'accepted' and has_left = false;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return json_build_object('ok', false, 'error', 'not_member'); end if;
  return json_build_object('ok', true);
end $$;
grant execute on function leave_event_chat(text,uuid) to anon;

-- ---------- PLANNIT: group plans with a shared availability grid ----------
-- start_day is a real, stable calendar day (epoch days, same scheme as
-- plans.day_index) — the day the plan's range starts from. range_type says
-- how long that range runs and (client-side) what grid granularity to use:
-- 'today' = just start_day (2-hour slots), 'week' = 7 days (2-hour slots),
-- 'twoweek' = 14 days (whole-day cells), 'month' = start_day + 1 calendar
-- month (whole-day cells), 'year' = start_day + 1 year (2-week-block cells),
-- 'poll' = no date grid at all — just a vote on what the event should be
-- (start_day is stored but unused/undisplayed for this type).
-- is_tbd = true adds a poll (vote on what the activity is) alongside a
-- dated event's grid; poll_closed freezes a poll once the owner locks in
-- a winning option (which then becomes the event's name).
create table if not exists plannit_events (
  id uuid primary key default gen_random_uuid(),
  owner text not null references accounts(username) on delete cascade,
  name text not null,
  start_day int not null,
  created_at timestamptz not null default now(),
  cancelled boolean not null default false
);
-- migrate older installs that only ever had a single-week grid
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'plannit_events' and column_name = 'week_start_day')
     and not exists (select 1 from information_schema.columns where table_name = 'plannit_events' and column_name = 'start_day') then
    alter table plannit_events rename column week_start_day to start_day;
  end if;
end $$;
alter table plannit_events add column if not exists range_type text not null default 'week';
alter table plannit_events add column if not exists is_tbd boolean not null default false;
alter table plannit_events add column if not exists poll_closed boolean not null default false;
alter table plannit_events drop constraint if exists plannit_events_range_type_check;
alter table plannit_events add constraint plannit_events_range_type_check
  check (range_type in ('today','week','twoweek','month','year','poll'));
alter table plannit_events enable row level security;
revoke all on plannit_events from anon, authenticated;
alter table dm_messages drop constraint if exists dm_messages_plannit_event_id_fkey;
alter table dm_messages add constraint dm_messages_plannit_event_id_fkey
  foreign key (plannit_event_id) references plannit_events(id) on delete cascade;

-- notified=false means the invitee has a row here but hasn't been sent the
-- plannit_invite message yet — lets an owner fill in their own availability
-- (or add poll options) before anyone else is notified the plan exists;
-- see create_plannit_event / send_plannit_invites below.
create table if not exists plannit_invites (
  event_id uuid not null references plannit_events(id) on delete cascade,
  invitee text not null references accounts(username) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted','declined')),
  primary key (event_id, invitee)
);
alter table plannit_invites add column if not exists notified boolean;
update plannit_invites set notified = true where notified is null; -- pre-existing rows were always sent immediately under the old flow
alter table plannit_invites alter column notified set not null;
alter table plannit_invites alter column notified set default false;
alter table plannit_invites enable row level security;
revoke all on plannit_invites from anon, authenticated;

-- one cell per member per unit (a day, a 2-hour slot, or a 2-week block,
-- depending on the event's range_type — see plannit_events above);
-- deleting a row = "no answer yet". day_offset is the unit index (0-based
-- from start_day); slot_index is the sub-slot within that unit (always 0
-- except for 'today'/'week' events, which use it for the 7 two-hour slots).
create table if not exists plannit_answers (
  event_id uuid not null references plannit_events(id) on delete cascade,
  member text not null references accounts(username) on delete cascade,
  day_offset int not null check (day_offset between 0 and 400),
  slot_index int not null check (slot_index between 0 and 6),
  answer text not null check (answer in ('yes','no','maybe','depends')),
  primary key (event_id, member, day_offset, slot_index)
);
alter table plannit_answers enable row level security;
revoke all on plannit_answers from anon, authenticated;
alter table plannit_answers drop constraint if exists plannit_answers_day_offset_check;
alter table plannit_answers add constraint plannit_answers_day_offset_check check (day_offset between 0 and 400);

create table if not exists plannit_messages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references plannit_events(id) on delete cascade,
  sender text not null references accounts(username) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);
alter table plannit_messages enable row level security;
revoke all on plannit_messages from anon, authenticated;

-- options any member can propose (see is_tbd/range_type='poll' above)
create table if not exists plannit_poll_options (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references plannit_events(id) on delete cascade,
  label text not null,
  added_by text not null references accounts(username) on delete cascade,
  created_at timestamptz not null default now()
);
alter table plannit_poll_options enable row level security;
revoke all on plannit_poll_options from anon, authenticated;

-- one vote per member per event; changing your mind just moves the row
create table if not exists plannit_poll_votes (
  event_id uuid not null references plannit_events(id) on delete cascade,
  member text not null references accounts(username) on delete cascade,
  option_id uuid not null references plannit_poll_options(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (event_id, member)
);
alter table plannit_poll_votes enable row level security;
revoke all on plannit_poll_votes from anon, authenticated;

-- internal helper, not exposed to anon directly
create or replace function is_plannit_member(p_event_id uuid, p_me text)
returns boolean language sql security definer as $$
  select exists(select 1 from plannit_events e where e.id = p_event_id and e.owner = p_me)
    or exists(select 1 from plannit_invites i where i.event_id = p_event_id and i.invitee = p_me and i.status = 'accepted');
$$;

-- creates the event and sends each invitee a plannit_invite message (with
-- Yes/No) — non-friends passed in p_invitees are silently skipped rather
-- than failing the whole thing.
-- creates the event and records who to invite, but does NOT notify them
-- yet — this lets the owner fill in their own availability (or seed poll
-- options) first. Call send_plannit_invites once ready to actually notify.
create or replace function create_plannit_event(p_me text, p_name text, p_start_day int, p_range_type text, p_is_tbd boolean, p_invitees text[])
returns json language plpgsql security definer as $$
declare v_id uuid; v_invitee text;
begin
  if length(trim(coalesce(p_name,''))) = 0 then return json_build_object('ok', false, 'error', 'empty'); end if;
  if p_range_type not in ('today','week','twoweek','month','year','poll') then return json_build_object('ok', false, 'error', 'bad_range'); end if;
  insert into plannit_events(owner, name, start_day, range_type, is_tbd) values (p_me, trim(p_name), p_start_day, p_range_type, coalesce(p_is_tbd, false)) returning id into v_id;
  foreach v_invitee in array coalesce(p_invitees, '{}') loop
    if v_invitee = p_me then continue; end if;
    if not exists (select 1 from friendships where (user_a=p_me and user_b=v_invitee) or (user_a=v_invitee and user_b=p_me)) then
      continue;
    end if;
    insert into plannit_invites(event_id, invitee, status, notified) values (v_id, v_invitee, 'pending', false)
      on conflict (event_id, invitee) do nothing;
  end loop;
  return json_build_object('ok', true, 'id', v_id);
end $$;
drop function if exists create_plannit_event(text,text,int,text[]);
drop function if exists create_plannit_event(text,text,int,text,text[]);
grant execute on function create_plannit_event(text,text,int,text,boolean,text[]) to anon;

-- owner-only: actually notifies everyone still waiting on this event's
-- initial invite (created via create_plannit_event but not yet sent) —
-- the "send to your group" step after the owner's filled in the grid/poll.
create or replace function send_plannit_invites(p_me text, p_event_id uuid)
returns json language plpgsql security definer as $$
declare v_name text; v_invitee text; v_sent int := 0;
begin
  select name into v_name from plannit_events where id = p_event_id and owner = p_me;
  if v_name is null then return json_build_object('ok', false, 'error', 'not_found'); end if;
  for v_invitee in select invitee from plannit_invites where event_id = p_event_id and notified = false loop
    insert into dm_messages(sender, recipient, body, kind, plannit_event_id, request_status)
      values (p_me, v_invitee, 'Want to help plan "' || v_name || '"?', 'plannit_invite', p_event_id, 'pending');
    update plannit_invites set notified = true where event_id = p_event_id and invitee = v_invitee;
    v_sent := v_sent + 1;
  end loop;
  return json_build_object('ok', true, 'sent_count', v_sent);
end $$;
grant execute on function send_plannit_invites(text,uuid) to anon;

-- invite more people to an already-created event (owner only)
create or replace function invite_to_plannit_event(p_me text, p_event_id uuid, p_invitees text[])
returns json language plpgsql security definer as $$
declare v_name text; v_invitee text;
begin
  select name into v_name from plannit_events where id = p_event_id and owner = p_me;
  if v_name is null then return json_build_object('ok', false, 'error', 'not_found'); end if;
  foreach v_invitee in array coalesce(p_invitees, '{}') loop
    if v_invitee = p_me then continue; end if;
    if not exists (select 1 from friendships where (user_a=p_me and user_b=v_invitee) or (user_a=v_invitee and user_b=p_me)) then
      continue;
    end if;
    if exists (select 1 from plannit_invites where event_id = p_event_id and invitee = v_invitee) then continue; end if;
    insert into plannit_invites(event_id, invitee, status, notified) values (p_event_id, v_invitee, 'pending', true);
    insert into dm_messages(sender, recipient, body, kind, plannit_event_id, request_status)
      values (p_me, v_invitee, 'Want to help plan "' || v_name || '"?', 'plannit_invite', p_event_id, 'pending');
  end loop;
  return json_build_object('ok', true);
end $$;
grant execute on function invite_to_plannit_event(text,uuid,text[]) to anon;

create or replace function respond_plannit_invite(p_me text, p_message_id uuid, p_accept boolean)
returns json language plpgsql security definer as $$
declare m dm_messages;
begin
  select * into m from dm_messages where id = p_message_id;
  if m is null or m.recipient <> p_me or m.kind <> 'plannit_invite' then
    return json_build_object('ok', false, 'error', 'not_found');
  end if;
  if m.request_status <> 'pending' then
    return json_build_object('ok', false, 'error', 'already_answered');
  end if;
  update dm_messages set request_status = (case when p_accept then 'accepted' else 'declined' end) where id = p_message_id;
  update plannit_invites set status = (case when p_accept then 'accepted' else 'declined' end)
    where event_id = m.plannit_event_id and invitee = p_me;
  if p_accept then
    insert into dm_messages(sender, recipient, body, kind) values (p_me, m.sender, 'Joined the planning ✓', 'text');
  else
    insert into dm_messages(sender, recipient, body, kind) values (p_me, m.sender, 'Can''t help plan this one', 'text');
  end if;
  return json_build_object('ok', true);
end $$;
grant execute on function respond_plannit_invite(text,uuid,boolean) to anon;

-- the PLANNIT feed: events you own, or ones you've accepted an invite to
-- (a pending invite lives only in Messages until answered, same as a
-- join request).
drop function if exists list_my_plannit_events(text);
create or replace function list_my_plannit_events(p_me text)
returns table (id uuid, name text, owner text, owner_display text, start_day int, range_type text, cancelled boolean,
  is_tbd boolean, poll_closed boolean,
  member_count bigint, created_at timestamptz, last_body text, last_at timestamptz)
language sql security definer as $$
  with mine as (
    select e.id from plannit_events e where e.owner = p_me
    union
    select i.event_id from plannit_invites i where i.invitee = p_me and i.status = 'accepted'
  )
  select e.id, e.name, e.owner, a.display_name, e.start_day, e.range_type, e.cancelled, e.is_tbd, e.poll_closed,
    1 + (select count(*) from plannit_invites i2 where i2.event_id = e.id and i2.status = 'accepted') as member_count,
    e.created_at,
    (select body from plannit_messages pm where pm.event_id = e.id order by pm.created_at desc limit 1) as last_body,
    (select pm.created_at from plannit_messages pm where pm.event_id = e.id order by pm.created_at desc limit 1) as last_at
  from plannit_events e
  join accounts a on a.username = e.owner
  where e.id in (select id from mine)
  order by coalesce(
    (select pm.created_at from plannit_messages pm where pm.event_id = e.id order by pm.created_at desc limit 1),
    e.created_at
  ) desc;
$$;
grant execute on function list_my_plannit_events(text) to anon;

drop function if exists list_plannit_members(text,uuid);
create or replace function list_plannit_members(p_me text, p_event_id uuid)
returns table (username text, display_name text, avatar text, is_owner boolean, status text, notified boolean)
language plpgsql security definer as $$
begin
  if not is_plannit_member(p_event_id, p_me) then return; end if;
  return query
    select a.username, a.display_name, a.avatar, true, 'accepted'::text, true
    from plannit_events e join accounts a on a.username = e.owner where e.id = p_event_id
    union
    select a.username, a.display_name, a.avatar, false, i.status, i.notified
    from plannit_invites i join accounts a on a.username = i.invitee
    where i.event_id = p_event_id;
end $$;
grant execute on function list_plannit_members(text,uuid) to anon;

-- p_answer = 'none' clears the cell (deletes the row) instead of storing it
create or replace function set_plannit_answer(p_me text, p_event_id uuid, p_day_offset int, p_slot_index int, p_answer text)
returns json language plpgsql security definer as $$
begin
  if not is_plannit_member(p_event_id, p_me) then return json_build_object('ok', false, 'error', 'not_member'); end if;
  if p_answer = 'none' then
    delete from plannit_answers where event_id = p_event_id and member = p_me and day_offset = p_day_offset and slot_index = p_slot_index;
  else
    insert into plannit_answers(event_id, member, day_offset, slot_index, answer)
      values (p_event_id, p_me, p_day_offset, p_slot_index, p_answer)
      on conflict (event_id, member, day_offset, slot_index) do update set answer = excluded.answer;
  end if;
  return json_build_object('ok', true);
end $$;
grant execute on function set_plannit_answer(text,uuid,int,int,text) to anon;

-- every member's answers for the grid, so the client can render overlap
-- (how many said yes per cell) — no auto "best slot" pick yet, you eyeball it.
create or replace function list_plannit_grid(p_me text, p_event_id uuid)
returns table (member text, member_display text, day_offset int, slot_index int, answer text)
language plpgsql security definer as $$
begin
  if not is_plannit_member(p_event_id, p_me) then return; end if;
  return query
    select pa.member, a.display_name, pa.day_offset, pa.slot_index, pa.answer
    from plannit_answers pa join accounts a on a.username = pa.member
    where pa.event_id = p_event_id;
end $$;
grant execute on function list_plannit_grid(text,uuid) to anon;

create or replace function send_plannit_message(p_me text, p_event_id uuid, p_body text)
returns json language plpgsql security definer as $$
begin
  if length(trim(coalesce(p_body,''))) = 0 then return json_build_object('ok', false, 'error', 'empty'); end if;
  if not is_plannit_member(p_event_id, p_me) then return json_build_object('ok', false, 'error', 'not_member'); end if;
  insert into plannit_messages(event_id, sender, body) values (p_event_id, p_me, trim(p_body));
  return json_build_object('ok', true);
end $$;
grant execute on function send_plannit_message(text,uuid,text) to anon;

create or replace function list_plannit_messages(p_me text, p_event_id uuid)
returns table (id uuid, sender text, sender_display text, sender_avatar text, body text, created_at timestamptz)
language plpgsql security definer as $$
begin
  if not is_plannit_member(p_event_id, p_me) then return; end if;
  return query
    select m.id, m.sender, a.display_name, a.avatar, m.body, m.created_at
    from plannit_messages m join accounts a on a.username = m.sender
    where m.event_id = p_event_id
      and m.sender not in (select blocked from blocks where blocker = p_me)
    order by m.created_at asc;
end $$;
grant execute on function list_plannit_messages(text,uuid) to anon;

create or replace function cancel_plannit_event(p_me text, p_event_id uuid)
returns json language plpgsql security definer as $$
declare v_rows int;
begin
  update plannit_events set cancelled = true where id = p_event_id and owner = p_me;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return json_build_object('ok', false, 'error', 'not_found'); end if;
  return json_build_object('ok', true);
end $$;
grant execute on function cancel_plannit_event(text,uuid) to anon;

-- owner-only: turns a plain dated plan into one with a poll attached (or
-- back), for when the owner decides after creating it that the group
-- should vote on what to actually do. Blocked once the poll's locked in.
create or replace function set_plannit_tbd(p_me text, p_event_id uuid, p_is_tbd boolean)
returns json language plpgsql security definer as $$
declare v_rows int;
begin
  update plannit_events set is_tbd = coalesce(p_is_tbd, false)
    where id = p_event_id and owner = p_me and cancelled = false and poll_closed = false;
  get diagnostics v_rows = row_count;
  if v_rows = 0 then return json_build_object('ok', false, 'error', 'not_found'); end if;
  return json_build_object('ok', true);
end $$;
grant execute on function set_plannit_tbd(text,uuid,boolean) to anon;

-- ---------- PLANNIT: vote on what the event is (is_tbd events, or
-- range_type='poll' standalone polls) — any member can propose an
-- option, one vote per member, owner can lock in the leading option
-- which then becomes the event's name and freezes the poll. ----------
create or replace function add_plannit_poll_option(p_me text, p_event_id uuid, p_label text)
returns json language plpgsql security definer as $$
declare v_id uuid; v_closed boolean; v_cancelled boolean;
begin
  if length(trim(coalesce(p_label,''))) = 0 then return json_build_object('ok', false, 'error', 'empty'); end if;
  if not is_plannit_member(p_event_id, p_me) then return json_build_object('ok', false, 'error', 'not_member'); end if;
  select poll_closed, cancelled into v_closed, v_cancelled from plannit_events where id = p_event_id;
  if v_closed then return json_build_object('ok', false, 'error', 'poll_closed'); end if;
  if v_cancelled then return json_build_object('ok', false, 'error', 'cancelled'); end if;
  insert into plannit_poll_options(event_id, label, added_by) values (p_event_id, trim(p_label), p_me) returning id into v_id;
  return json_build_object('ok', true, 'id', v_id);
end $$;
grant execute on function add_plannit_poll_option(text,uuid,text) to anon;

-- p_option_id = null clears the caller's own vote
create or replace function vote_plannit_poll(p_me text, p_event_id uuid, p_option_id uuid)
returns json language plpgsql security definer as $$
declare v_closed boolean; v_cancelled boolean;
begin
  if not is_plannit_member(p_event_id, p_me) then return json_build_object('ok', false, 'error', 'not_member'); end if;
  select poll_closed, cancelled into v_closed, v_cancelled from plannit_events where id = p_event_id;
  if v_closed then return json_build_object('ok', false, 'error', 'poll_closed'); end if;
  if v_cancelled then return json_build_object('ok', false, 'error', 'cancelled'); end if;
  if p_option_id is null then
    delete from plannit_poll_votes where event_id = p_event_id and member = p_me;
    return json_build_object('ok', true);
  end if;
  if not exists (select 1 from plannit_poll_options where id = p_option_id and event_id = p_event_id) then
    return json_build_object('ok', false, 'error', 'not_found');
  end if;
  insert into plannit_poll_votes(event_id, member, option_id) values (p_event_id, p_me, p_option_id)
    on conflict (event_id, member) do update set option_id = excluded.option_id, created_at = now();
  return json_build_object('ok', true);
end $$;
grant execute on function vote_plannit_poll(text,uuid,uuid) to anon;

create or replace function list_plannit_poll(p_me text, p_event_id uuid)
returns table (option_id uuid, label text, added_by text, added_by_display text, vote_count bigint, my_vote boolean)
language plpgsql security definer as $$
begin
  if not is_plannit_member(p_event_id, p_me) then return; end if;
  return query
    select o.id, o.label, o.added_by, a.display_name,
      (select count(*) from plannit_poll_votes v where v.option_id = o.id) as vote_count,
      exists(select 1 from plannit_poll_votes v where v.option_id = o.id and v.member = p_me) as my_vote
    from plannit_poll_options o
    join accounts a on a.username = o.added_by
    where o.event_id = p_event_id
    order by o.created_at asc;
end $$;
grant execute on function list_plannit_poll(text,uuid) to anon;

-- owner-only: renames the event to the option with the most votes (ties
-- broken by whichever option was proposed first) and freezes the poll
create or replace function lock_plannit_poll_winner(p_me text, p_event_id uuid)
returns json language plpgsql security definer as $$
declare v_owner text; v_winner record;
begin
  select owner into v_owner from plannit_events where id = p_event_id;
  if v_owner is null or v_owner <> p_me then return json_build_object('ok', false, 'error', 'not_found'); end if;
  select o.id, o.label, count(v.member) as votes into v_winner
    from plannit_poll_options o
    left join plannit_poll_votes v on v.option_id = o.id
    where o.event_id = p_event_id
    group by o.id, o.label
    order by votes desc, o.created_at asc
    limit 1;
  if v_winner.id is null then return json_build_object('ok', false, 'error', 'no_options'); end if;
  update plannit_events set name = v_winner.label, poll_closed = true where id = p_event_id;
  return json_build_object('ok', true, 'name', v_winner.label);
end $$;
grant execute on function lock_plannit_poll_winner(text,uuid) to anon;

-- red-circle badge on the Messages icon: pending join requests always
-- count (they need action); text messages count once until last_read_at
-- is bumped by mark_messages_read.
create or replace function count_unread_messages(p_me text)
returns int language plpgsql security definer as $$
declare v_last timestamptz; v_count int;
begin
  select last_read_at into v_last from message_reads where username = p_me;
  if v_last is null then v_last := '1970-01-01'; end if;

  select
    (select count(*) from dm_messages
       where recipient = p_me and kind in ('join_request','plannit_invite') and request_status = 'pending'
         and sender not in (select blocked from blocks where blocker = p_me))
    +
    (select count(*) from dm_messages
       where recipient = p_me and kind = 'text' and created_at > v_last
         and sender not in (select blocked from blocks where blocker = p_me))
    +
    (select count(*) from event_messages em
       where em.sender <> p_me and em.created_at > v_last
         and is_event_member(em.plan_id, p_me)
         and em.sender not in (select blocked from blocks where blocker = p_me))
    +
    (select count(*) from plannit_messages pm
       where pm.sender <> p_me and pm.created_at > v_last
         and is_plannit_member(pm.event_id, p_me)
         and pm.sender not in (select blocked from blocks where blocker = p_me))
  into v_count;
  return coalesce(v_count, 0);
end $$;
grant execute on function count_unread_messages(text) to anon;

-- used when the "Notifications" privacy toggle is set to "Only join
-- requests" instead of "Everything" — badge only counts what actually
-- needs your action (a Yes/No), not every text message.
create or replace function count_pending_join_requests(p_me text)
returns int language plpgsql security definer as $$
declare v_count int;
begin
  select count(*) into v_count from dm_messages
    where recipient = p_me and kind in ('join_request','plannit_invite') and request_status = 'pending'
      and sender not in (select blocked from blocks where blocker = p_me);
  return coalesce(v_count, 0);
end $$;
grant execute on function count_pending_join_requests(text) to anon;

create or replace function mark_messages_read(p_me text)
returns json language plpgsql security definer as $$
begin
  insert into message_reads(username, last_read_at) values (p_me, now())
    on conflict (username) do update set last_read_at = excluded.last_read_at;
  return json_build_object('ok', true);
end $$;
grant execute on function mark_messages_read(text) to anon;

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
-- p_day is a real, stable calendar day count (days since 1970-01-01,
-- client-local time) — not an offset from "today" — so a posted plan's
-- date never shifts meaning as real time passes. New plans (p_id null)
-- can't be created for a day before today; a 1-day tolerance absorbs
-- timezone skew between the browser's local clock and the DB server's,
-- since the strict same-day UX check already happens client-side.
-- Editing an existing plan never touches its day, so that path is
-- exempt — this only blocks creating brand-new backdated plans.
create or replace function upsert_plan(
  p_me text, p_id uuid, p_day int, p_act text, p_color text, p_time text,
  p_note text, p_audience text, p_range boolean, p_tags text[])
returns plans language plpgsql security definer as $$
declare r plans;
begin
  if p_id is null then
    if p_day < (current_date - date '1970-01-01') - 1 then
      raise exception 'backdate_blocked: cannot create a new plan for a day in the past';
    end if;
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
