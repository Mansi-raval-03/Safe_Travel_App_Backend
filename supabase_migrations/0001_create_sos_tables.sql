-- Create SOS tables for Safe Travel App

create table public.sos_events (
  id uuid default gen_random_uuid() primary key,
  sender_id uuid not null references auth.users(id),
  receiver_id uuid not null references auth.users(id),
  latitude double precision not null,
  longitude double precision not null,
  message text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create index on public.sos_events (receiver_id);
create index on public.sos_events (created_at);

create table public.sos_live_location (
  id uuid default gen_random_uuid() primary key,
  sos_id uuid not null references public.sos_events(id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  created_at timestamptz default now()
);

create index on public.sos_live_location (sos_id);
create index on public.sos_live_location (created_at);

-- Enable publication for realtime if using Supabase self-hosted realtime
begin;
  drop publication if exists supabase_realtime;
  create publication supabase_realtime;
commit;
alter publication supabase_realtime add table public.sos_events, public.sos_live_location;

-- Row level security examples (adjust to your policies)
alter table public.sos_events enable row level security;
create policy "senders_can_insert" on public.sos_events
  for insert with check (auth.uid() = sender_id);
create policy "receiver_or_sender_can_select" on public.sos_events
  for select using (auth.uid() = receiver_id or auth.uid() = sender_id);

alter table public.sos_live_location enable row level security;
create policy "sos_live_insert" on public.sos_live_location
  for insert with check (exists (select 1 from public.sos_events se where se.id = sos_id and se.sender_id = auth.uid()));
create policy "sos_live_select" on public.sos_live_location
  for select using (exists (select 1 from public.sos_events se where se.id = sos_live_location.sos_id and (se.receiver_id = auth.uid() or se.sender_id = auth.uid())));
