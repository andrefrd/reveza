-- Imita o que o Supabase traz pronto, para testar as migrações no PGlite: papéis, esquema auth e as funções que leem
-- o token da requisição (request.jwt.claims), do mesmo jeito que o PostgREST faz.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  banned_until timestamptz,
  raw_app_meta_data jsonb not null default '{}'
);
create table if not exists auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null,
  created_at timestamptz default now(), updated_at timestamptz default now(), refreshed_at timestamp, user_agent text, ip inet);
create table if not exists auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid not null,
  factor_type text default 'totp', status text not null default 'unverified');
create table if not exists auth.refresh_tokens (id bigserial primary key, user_id varchar(255), revoked boolean default false);
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
grant execute on function auth.jwt(), auth.uid() to anon, authenticated, service_role;
-- Como o Supabase: tudo que nasce no public já vem liberado para anon e authenticated. As migrações têm de fechar.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
-- Vault do Supabase (imitação: guarda em claro, só para teste).
create schema if not exists vault;
create table if not exists vault.secrets (id uuid primary key default gen_random_uuid(), name text unique, secret text not null,
                                          description text, created_at timestamptz default now());
create or replace function vault.create_secret(new_secret text, new_name text default null, new_description text default '')
returns uuid language sql as $$ insert into vault.secrets (secret, name, description) values (new_secret, new_name, new_description) returning id $$;
create or replace function vault.update_secret(secret_id uuid, new_secret text default null, new_name text default null,
                                               new_description text default null, new_key_id uuid default null)
returns void language sql as $$ update vault.secrets set secret = coalesce(new_secret, secret) where id = secret_id $$;
create or replace view vault.decrypted_secrets as select id, name, secret as decrypted_secret from vault.secrets;
revoke all on schema vault from anon, authenticated;
