-- Santos Rock Access | Migration 001
-- Run on a NEW Supabase project using Supabase CLI migrations.
-- This migration establishes storage and RLS. It does NOT expose ticket redemption yet.
begin;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create type public.org_role as enum ('owner','admin');
create type public.event_role as enum ('admin','supervisor','scanner');
create type public.event_status as enum ('draft','published','live','closed','cancelled');
create type public.ticket_status as enum ('issued','redeemed','void');
create type public.order_status as enum ('pending','verified','cancelled','refunded');
create type public.ticket_source as enum ('sinpe','ticketera','complimentary','door','other');
create type public.checkin_result as enum ('accepted','duplicate','invalid','void','wrong_event','error');

create table public.organizations (
 id uuid primary key default gen_random_uuid(), name text not null check (length(btrim(name)) between 2 and 160),
 slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
 created_at timestamptz not null default now()
);
create table public.profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '', created_at timestamptz not null default now()
);
create table public.organization_members (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role public.org_role not null, created_at timestamptz not null default now(),
 primary key (organization_id,user_id)
);
create table public.events (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 name text not null check (length(btrim(name)) between 2 and 180),
 venue text, starts_at timestamptz not null, ends_at timestamptz,
 timezone text not null default 'America/Costa_Rica',
 status public.event_status not null default 'draft',
 created_at timestamptz not null default now(),
 check (ends_at is null or ends_at > starts_at),
 unique(id,organization_id)
);
create table public.event_members (
 event_id uuid not null references public.events(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 role public.event_role not null, created_at timestamptz not null default now(),
 primary key(event_id,user_id)
);
create table public.ticket_types (
 id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events(id),
 name text not null, capacity integer check (capacity is null or capacity >= 0),
 access_zone text not null default 'general', created_at timestamptz not null default now(),
 unique(id,event_id)
);
create table public.ticket_holders (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 full_name text, email text, phone text, created_at timestamptz not null default now(),
 unique(id,organization_id)
);
create table public.orders (
 id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events(id),
 source public.ticket_source not null, external_order_id text,
 buyer_email text, payment_reference text,
 payment_status public.order_status not null default 'pending',
 created_at timestamptz not null default now(), unique(id,event_id)
);
create unique index orders_external_ref_unique on public.orders(event_id,source,external_order_id)
 where external_order_id is not null;
create table public.import_batches (
 id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events(id),
 source public.ticket_source not null, imported_by uuid references auth.users(id),
 imported_at timestamptz not null default now(), row_count integer not null default 0 check(row_count>=0),
 status text not null default 'pending' check(status in ('pending','validated','completed','failed')),
 unique(id,event_id)
);
create table public.tickets (
 id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events(id),
 type_id uuid not null, order_id uuid, holder_id uuid,
 source public.ticket_source not null, import_batch_id uuid,
 external_ticket_id text, status public.ticket_status not null default 'issued',
 issued_at timestamptz not null default now(), redeemed_at timestamptz,
 foreign key(type_id,event_id) references public.ticket_types(id,event_id),
 foreign key(order_id,event_id) references public.orders(id,event_id),
 foreign key(import_batch_id,event_id) references public.import_batches(id,event_id),
 foreign key(holder_id) references public.ticket_holders(id),
 unique(id,event_id),
 check ((status='redeemed' and redeemed_at is not null) or (status <> 'redeemed' and redeemed_at is null))
);
create unique index tickets_external_id_unique on public.tickets(event_id,source,external_ticket_id)
 where external_ticket_id is not null;
-- Credentials must never be directly selectable by frontend roles.
create table public.ticket_credentials (
 id uuid primary key default gen_random_uuid(), ticket_id uuid not null references public.tickets(id) on delete cascade,
 credential_kind text not null check(credential_kind in ('native','external')),
 token_digest bytea not null unique, created_at timestamptz not null default now(),
 revoked_at timestamptz
);
create table public.scanners (
 id uuid primary key default gen_random_uuid(), event_id uuid not null references public.events(id),
 label text not null, created_at timestamptz not null default now(),
 last_seen_at timestamptz, unique(id,event_id)
);
create table public.checkins (
 id uuid primary key default gen_random_uuid(), event_id uuid not null,
 ticket_id uuid not null, scanner_id uuid, operator_id uuid references auth.users(id),
 result public.checkin_result not null,
 checked_in_at timestamptz not null default now(), request_id uuid not null unique,
 foreign key(ticket_id,event_id) references public.tickets(id,event_id),
 foreign key(scanner_id,event_id) references public.scanners(id,event_id)
);
create unique index one_accepted_checkin_per_ticket on public.checkins(ticket_id) where result='accepted';
create table public.audit_logs (
 id bigint generated always as identity primary key,
 organization_id uuid not null references public.organizations(id),
 event_id uuid references public.events(id),
 actor_id uuid references auth.users(id), action text not null,
 entity_type text not null, entity_id uuid, metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create index event_members_user_idx on public.event_members(user_id,event_id);
create index org_members_user_idx on public.organization_members(user_id,organization_id);
create index events_org_idx on public.events(organization_id);
create index tickets_event_status_idx on public.tickets(event_id,status);
create index checkins_event_time_idx on public.checkins(event_id,checked_in_at desc);
create index audit_org_time_idx on public.audit_logs(organization_id,created_at desc);

-- Privileged membership predicates: no recursion through membership RLS.
create function app_private.is_org_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.organization_members m
 where m.organization_id=p_org and m.user_id=(select auth.uid()) and m.role in ('owner','admin'));
$$;
create function app_private.is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.organization_members m
 where m.organization_id=p_org and m.user_id=(select auth.uid()));
$$;
create function app_private.has_event_role(p_event uuid, p_roles public.event_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
 select exists(select 1 from public.events e where e.id=p_event and
  (app_private.is_org_admin(e.organization_id) or exists(
   select 1 from public.event_members m where m.event_id=e.id
   and m.user_id=(select auth.uid()) and m.role=any(p_roles))));
$$;
create function app_private.can_view_event(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select app_private.has_event_role(p_event,array['admin','supervisor','scanner']::public.event_role[]);
$$;
create function app_private.can_manage_event(p_event uuid) returns boolean
language sql stable security definer set search_path = '' as $$
 select app_private.has_event_role(p_event,array['admin']::public.event_role[]);
$$;
create function app_private.event_org(p_event uuid) returns uuid
language sql stable security definer set search_path = '' as $$
 select organization_id from public.events where id=p_event;
$$;
revoke all on all functions in schema app_private from public, anon;
grant usage on schema app_private to authenticated;
grant execute on all functions in schema app_private to authenticated;

-- All exposed tables have RLS, even those intentionally inaccessible directly.
do $$ declare t text; begin
 foreach t in array array['organizations','profiles','organization_members','events','event_members',
 'ticket_types','ticket_holders','orders','import_batches','tickets','ticket_credentials',
 'scanners','checkins','audit_logs'] loop
  execute format('alter table public.%I enable row level security',t);
 end loop;
end $$;

-- Explicit least-privilege grants; SQL migrations run as project owner.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.organizations,public.profiles,public.organization_members,
 public.events,public.event_members,public.ticket_types,public.ticket_holders,
 public.orders,public.import_batches,public.tickets,public.scanners,
 public.checkins,public.audit_logs to authenticated;
-- No direct client writes to financial records, tickets, credentials or check-ins.
-- A subsequent migration will add carefully scoped RPC functions.

create policy org_select on public.organizations for select to authenticated
 using (app_private.is_org_member(id));
create policy profile_select on public.profiles for select to authenticated
 using (user_id=(select auth.uid()));
create policy org_members_select on public.organization_members for select to authenticated
 using (user_id=(select auth.uid()) or app_private.is_org_admin(organization_id));
create policy event_select on public.events for select to authenticated
 using (app_private.can_view_event(id));
create policy event_members_select on public.event_members for select to authenticated
 using (user_id=(select auth.uid()) or app_private.can_manage_event(event_id));
create policy ticket_types_select on public.ticket_types for select to authenticated
 using (app_private.can_view_event(event_id));
create policy holders_select on public.ticket_holders for select to authenticated
 using (app_private.is_org_admin(organization_id));
create policy orders_select on public.orders for select to authenticated
 using (app_private.can_manage_event(event_id));
create policy batches_select on public.import_batches for select to authenticated
 using (app_private.can_manage_event(event_id));
create policy tickets_select on public.tickets for select to authenticated
 using (app_private.has_event_role(event_id,array['admin','supervisor']::public.event_role[]));
create policy scanners_select on public.scanners for select to authenticated
 using (app_private.can_view_event(event_id));
create policy checkins_select on public.checkins for select to authenticated
 using (app_private.has_event_role(event_id,array['admin','supervisor']::public.event_role[]));
create policy audit_select on public.audit_logs for select to authenticated
 using (app_private.is_org_admin(organization_id));
-- ticket_credentials: no SELECT policy and no authenticated grants.
-- Scanner gets no raw ticket or holder table access; use a limited redeem/search RPC later.

commit;
