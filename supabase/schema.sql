-- Trend Sync Sniper Signal Console
-- Single global TradingView signal stream with login-only dashboard access.

create extension if not exists "pgcrypto";

-- Existing base tables expected by the webhook/dashboard:
--
-- trades(
--   id uuid default gen_random_uuid() primary key,
--   trade_id text unique not null,
--   indicator text,
--   ticker text not null,
--   direction text not null,
--   timeframe text,
--   mode text,
--   quality text,
--   confidence int,
--   alignment int,
--   entry_price float,
--   sl_price float,
--   tp1_price float,
--   tp2_price float,
--   tp3_price float,
--   status text default 'OPEN',
--   tp1_hit boolean default false,
--   tp2_hit boolean default false,
--   tp3_hit boolean default false,
--   sl_hit boolean default false,
--   exit_reason text,
--   exit_price float,
--   duration text,
--   entry_time timestamptz default now(),
--   exit_time timestamptz,
--   created_at timestamptz default now()
-- )
--
-- settings(
--   id uuid default gen_random_uuid() primary key,
--   capital float default 500,
--   risk_pct float default 1.0,
--   updated_at timestamptz default now()
-- )

alter table trades
  add column if not exists trade_taken boolean not null default true;

alter table trades
  alter column trade_taken set default true;

alter table settings
  add column if not exists updated_at timestamptz default now();

create index if not exists trades_entry_time_idx on trades (entry_time desc);
create index if not exists trades_status_idx on trades (status);
create index if not exists trades_indicator_idx on trades (indicator);
create index if not exists trades_status_indicator_entry_idx on trades (status, indicator, entry_time desc);

alter table trades enable row level security;
alter table settings enable row level security;

drop policy if exists "Authenticated users can read trades" on trades;
drop policy if exists "Authenticated users can update trades" on trades;
drop policy if exists "Authenticated users can read settings" on settings;
drop policy if exists "Authenticated users can insert settings" on settings;
drop policy if exists "Authenticated users can update settings" on settings;

create policy "Authenticated users can read trades"
  on trades for select
  to authenticated
  using (true);

create policy "Authenticated users can update trades"
  on trades for update
  to authenticated
  using (true)
  with check (true);

revoke update on trades from authenticated;
grant update (trade_taken) on trades to authenticated;

create policy "Authenticated users can read settings"
  on settings for select
  to authenticated
  using (true);

create policy "Authenticated users can insert settings"
  on settings for insert
  to authenticated
  with check (true);

create policy "Authenticated users can update settings"
  on settings for update
  to authenticated
  using (true)
  with check (true);

-- Realtime for dashboard subscriptions.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'trades'
  ) then
    alter publication supabase_realtime add table trades;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'settings'
  ) then
    alter publication supabase_realtime add table settings;
  end if;
end $$;

-- Required Vercel env:
-- BOT_TOKEN
-- SUPABASE_URL
-- SUPABASE_SERVICE_ROLE_KEY
-- NEXT_PUBLIC_SUPABASE_URL
-- NEXT_PUBLIC_SUPABASE_ANON_KEY
