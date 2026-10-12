-- Reveza AI · 0001 · tipos, tabelas, segurança de linha e funções de apoio.
-- Fonte: nuvem/contrato.sql. Roda numa transação. Exige os esquemas e papéis do Supabase (auth, anon, authenticated,
-- service_role); nos testes eles são imitados por testes/supabase-falso.sql.

create type public.papel as enum ('admin', 'leitura', 'computador');
create type public.modo_troca as enum ('limite', 'limiar', 'rodizio');
create type public.estado_comando as enum ('pendente', 'reservado', 'feito', 'recusado', 'expirado');

create table public.membros (
  user_id uuid primary key references auth.users on delete cascade,
  papel public.papel not null,
  nome text,
  idioma text not null default 'pt-BR' check (idioma in ('pt-BR', 'en')),
  criado_em timestamptz not null default now()
);

create table public.convites (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  papel public.papel not null check (papel <> 'computador'),
  token_hash text not null unique,
  expira_em timestamptz not null default now() + interval '72 hours',
  usado_em timestamptz,
  criado_por uuid not null references auth.users
);

create table public.computadores (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users on delete cascade,
  nome text not null check (length(nome) between 1 and 80),
  sistema text not null check (sistema in ('macos', 'linux', 'windows')),
  versao text not null check (length(versao) <= 40),
  visto_em timestamptz,
  revogado boolean not null default false,
  diagnostico jsonb check (pg_column_size(diagnostico) <= 16384),
  criado_em timestamptz not null default now()
);

create table public.contas (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  organizacao text check (length(organizacao) <= 200),
  plano text check (length(plano) <= 40),
  nivel text check (length(nivel) <= 40),
  cor smallint not null default 0 check (cor between 0 and 31),
  prioridade smallint not null default 100 check (prioridade between 0 and 1000),
  reserva boolean not null default false,
  pausada boolean not null default false,
  agenda jsonb not null default '[]' check (jsonb_typeof(agenda) = 'array' and pg_column_size(agenda) <= 4096),
  teto_semana numeric check (teto_semana between 1 and 100),
  precisa_login boolean not null default false,
  criado_em timestamptz not null default now()
);

create table public.cofre (
  conta_id uuid primary key references public.contas on delete cascade,
  cifrado bytea not null check (length(cifrado) between 17 and 65536),
  nonce bytea not null check (length(nonce) = 12),
  versao bigint not null check (versao > 0),
  expira_em timestamptz,
  gravado_por uuid references public.computadores on delete set null,
  gravado_em timestamptz not null default now()
);

create table public.posse (
  conta_id uuid primary key references public.contas on delete cascade,
  computador_id uuid not null references public.computadores on delete cascade,
  motivo text not null check (motivo in ('uso', 'leitura', 'renovacao', 'login')),
  desde timestamptz not null default now(),
  expira_em timestamptz not null
);

create table public.atribuicao (
  computador_id uuid primary key references public.computadores on delete cascade,
  conta_id uuid references public.contas on delete set null,
  motivo text not null,
  versao bigint not null default 1,
  decidido_em timestamptz not null default now()
);

create table public.uso_janelas (
  conta_id uuid not null references public.contas on delete cascade,
  tipo text not null check (tipo in ('five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet')),
  pct numeric check (pct between 0 and 1000),
  reset_em timestamptz,
  lido_em timestamptz not null default now(),
  fonte text not null check (fonte in ('sessao', 'api')),
  primary key (conta_id, tipo)
);

create table public.uso_historico (
  conta_id uuid not null references public.contas on delete cascade,
  em timestamptz not null,
  p5 numeric,
  p7 numeric,
  primary key (conta_id, em)
);

create table public.uso_tokens (
  hora timestamptz not null,
  conta_id uuid references public.contas on delete set null,
  computador_id uuid not null references public.computadores on delete cascade,
  projeto text not null default '' check (length(projeto) <= 120 and position('/' in projeto) = 0),
  modelo text not null check (length(modelo) <= 80),
  respostas integer not null default 0 check (respostas >= 0),
  entrada bigint not null default 0 check (entrada >= 0),
  saida bigint not null default 0 check (saida >= 0),
  cache_escrita bigint not null default 0 check (cache_escrita >= 0),
  cache_leitura bigint not null default 0 check (cache_leitura >= 0),
  usd numeric(14, 4) not null default 0 check (usd >= 0)
);
-- conta_id pode ser nula (uso de antes do registro): a unicidade usa um valor fixo no lugar do nulo.
create unique index uso_tokens_chave on public.uso_tokens
  (hora, coalesce(conta_id, '00000000-0000-0000-0000-000000000000'::uuid), computador_id, projeto, modelo);

create table public.sessoes (
  id text primary key check (length(id) <= 80),
  computador_id uuid not null references public.computadores on delete cascade,
  projeto text not null default '' check (length(projeto) <= 120 and position('/' in projeto) = 0),
  inicio timestamptz,
  fim timestamptz,
  respostas integer not null default 0,
  tokens bigint not null default 0,
  usd numeric(14, 4) not null default 0,
  agentes integer not null default 0,
  contas uuid[] not null default '{}',
  modelos text[] not null default '{}',
  parada_no_limite boolean not null default false
);

create table public.eventos (
  id bigint generated always as identity primary key,
  em timestamptz not null default now(),
  tipo text not null check (tipo in ('troca', 'aviso', 'limite', 'retomada', 'conexao', 'erro', 'info', 'alerta')),
  texto text not null check (length(texto) <= 500),
  dados jsonb not null default '{}' check (pg_column_size(dados) <= 4096)
);
create index eventos_em on public.eventos (em desc);

create table public.comandos (
  id bigint generated always as identity primary key,
  criado_em timestamptz not null default now(),
  criado_por uuid not null references auth.users,
  computador_id uuid not null references public.computadores on delete cascade,
  acao text not null check (acao in ('conectar', 'entrar_de_novo', 'cancelar_login', 'codigo_login', 'atualizar',
                                     'diagnostico', 'retomar_sessao')),
  corpo jsonb not null default '{}' check (jsonb_typeof(corpo) = 'object' and pg_column_size(corpo) <= 4096),
  estado public.estado_comando not null default 'pendente',
  resposta jsonb check (pg_column_size(resposta) <= 16384),
  http smallint,
  reservado_em timestamptz,
  concluido_em timestamptz
);
create index comandos_pendentes on public.comandos (computador_id, criado_em) where estado = 'pendente';

create table public.config (
  chave text primary key check (chave in ('auto', 'modo', 'aviso', 'troca', 'rodizio_minutos', 'rodizio_ordem',
                                          'intervalo_s', 'retomar_terminal', 'espera_entre_trocas_s',
                                          'proximo_rodizio_em', 'fuso', 'alertas_ate')),
  valor jsonb not null,
  mudado_por uuid references auth.users,
  mudado_em timestamptz not null default now()
);

create table public.alertas (
  id uuid primary key default gen_random_uuid(),
  canal text not null check (canal in ('telegram', 'ntfy', 'email', 'webhook', 'push')),
  destino jsonb not null check (pg_column_size(destino) <= 2048),
  eventos text[] not null check (eventos <@ array['sem_livre', 'precisa_login', 'computador_parado', 'login_vence',
                                                   'resumo_dia', 'troca', 'limite']),
  ativo boolean not null default true,
  criado_por uuid not null references auth.users
);

create table public.push_inscricoes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  endpoint text not null unique check (endpoint like 'https://%' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) <= 200),
  auth text not null check (length(auth) <= 100),
  criado_em timestamptz not null default now()
);

create table public.chaves_api (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  nome text not null check (length(nome) between 1 and 80),
  prefixo text not null check (prefixo ~ '^rvz_[a-z0-9]{6}$'),
  hash text not null unique check (hash ~ '^[0-9a-f]{64}$'),
  escopos text[] not null check (escopos <@ array['ler', 'trocar', 'config'] and cardinality(escopos) > 0),
  criada_em timestamptz not null default now(),
  usada_em timestamptz,
  revogada boolean not null default false
);

create table public.webhooks_saida (
  id uuid primary key default gen_random_uuid(),
  url text not null check (url like 'https://%' and length(url) <= 1000),
  eventos text[] not null,
  segredo_vault_id uuid,
  ativo boolean not null default true,
  criado_por uuid not null references auth.users
);

create table public.ligacoes (                -- chave do cofre embrulhada por 10 min para ligar um computador novo
  id uuid primary key default gen_random_uuid(),
  embrulho bytea not null check (length(embrulho) between 32 and 512),
  sal bytea not null check (length(sal) between 16 and 64),
  criado_por uuid not null references public.computadores on delete cascade,
  expira_em timestamptz not null default now() + interval '10 minutes',
  usado_em timestamptz
);

create table public.auditoria (
  id bigint generated always as identity primary key,
  em timestamptz not null default now(),
  user_id uuid,
  acao text not null,
  alvo text,
  detalhes jsonb not null default '{}'
);
create index auditoria_em on public.auditoria (em desc);

-- ------------------------------------------------------------------------------------------- quem é quem
create function public.rvz_papel() returns public.papel
language sql stable security definer set search_path = public, pg_temp as $$
  select m.papel from public.membros m where m.user_id = auth.uid()
$$;

create function public.rvz_eh_membro() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.membros m where m.user_id = auth.uid() and m.papel in ('admin', 'leitura'))
$$;

create function public.rvz_eh_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.membros m where m.user_id = auth.uid() and m.papel = 'admin')
$$;

-- Verificação em duas etapas feita nesta sessão (o Supabase põe aal = aal2 no token depois do TOTP).
create function public.rvz_aal2() returns boolean
language sql stable as $$
  select coalesce(auth.jwt() ->> 'aal', '') = 'aal2'
$$;

create function public.rvz_computador() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id from public.computadores c
  join public.membros m on m.user_id = c.user_id and m.papel = 'computador'
  where c.user_id = auth.uid() and not c.revogado
$$;

create function public.rvz_exigir_admin() returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.rvz_eh_admin() then raise exception 'só administrador' using errcode = '42501'; end if;
  if not public.rvz_aal2() then raise exception 'confirme a verificação em duas etapas' using errcode = '42501'; end if;
end $$;

create function public.rvz_exigir_computador() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare c uuid := public.rvz_computador();
begin
  if c is null then raise exception 'só computador ativo' using errcode = '42501'; end if;
  return c;
end $$;

create function public.rvz_auditar(acao text, alvo text, detalhes jsonb default '{}') returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.auditoria (user_id, acao, alvo, detalhes) values (auth.uid(), acao, alvo, coalesce(detalhes, '{}'))
$$;

-- ------------------------------------------------------------------------------------------- segurança de linha
-- Sem FORCE: as funções security definer pertencem ao dono das tabelas e passam pela RLS de propósito; quem chama
-- de fora (anon, authenticated) passa pelas políticas.
do $$
declare t text;
begin
  foreach t in array array['membros', 'convites', 'computadores', 'contas', 'cofre', 'posse', 'atribuicao',
                           'uso_janelas', 'uso_historico', 'uso_tokens', 'sessoes', 'eventos', 'comandos', 'config',
                           'alertas', 'push_inscricoes', 'chaves_api', 'webhooks_saida', 'ligacoes', 'auditoria'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- Leitura para quem é membro (admin ou leitura). Nenhuma escrita direta: tudo passa pelas funções.
do $$
declare t text;
begin
  foreach t in array array['computadores', 'contas', 'posse', 'atribuicao', 'uso_janelas', 'uso_historico',
                           'uso_tokens', 'sessoes', 'eventos', 'comandos', 'config'] loop
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy membro_le on public.%I for select to authenticated using (public.rvz_eh_membro())', t);
  end loop;
end $$;

grant select on public.membros to authenticated;
create policy membro_le on public.membros for select to authenticated
  using (public.rvz_eh_membro() or user_id = auth.uid());

grant select on public.convites, public.alertas, public.webhooks_saida, public.auditoria to authenticated;
create policy admin_le on public.convites for select to authenticated using (public.rvz_eh_admin());
create policy admin_le on public.alertas for select to authenticated using (public.rvz_eh_admin());
create policy admin_le on public.webhooks_saida for select to authenticated using (public.rvz_eh_admin());
create policy admin_le on public.auditoria for select to authenticated using (public.rvz_eh_admin());

grant select (id, user_id, nome, prefixo, escopos, criada_em, usada_em, revogada) on public.chaves_api to authenticated;
create policy dono_le on public.chaves_api for select to authenticated using (user_id = auth.uid());

grant select (id, user_id, endpoint, criado_em) on public.push_inscricoes to authenticated;
create policy dono_le on public.push_inscricoes for select to authenticated using (user_id = auth.uid());

-- cofre e ligacoes: ninguém lê direto (só pelas funções do agente). Sem política = nada passa.

-- As permissões de execução de função são fechadas e liberadas uma a uma no fim da última migração (0099).

-- Configuração inicial: troca automática DESLIGADA (decisão do dono: a pessoa liga quando quiser).
insert into public.config (chave, valor) values
  ('auto', 'false'), ('modo', '"limiar"'), ('aviso', '90'), ('troca', '95'), ('rodizio_minutos', '90'),
  ('rodizio_ordem', '"aleatoria"'), ('intervalo_s', '5'), ('retomar_terminal', 'false'),
  ('espera_entre_trocas_s', '90');
