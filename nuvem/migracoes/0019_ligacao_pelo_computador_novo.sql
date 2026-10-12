-- Reveza AI · 0019 · computador novo entra pelo código que aparece NELE (0.2.0).
-- reaplicável: tabela e índice "if not exists", política recriada e funções (create or replace).
--
-- Achado 2 da revisão de segurança de 11/10/2026: o código `rvzl_` do painel levava a senha do computador novo e a
-- frase do cofre em texto reversível; quem o visse na tela, num print ou na área de transferência abria o cofre.
-- Agora nenhum segredo passa pela tela:
--   1. o painel cria a identidade pendente (como antes) e mostra um código de acesso que só deixa o computador novo
--      PEDIR para entrar;
--   2. o computador novo registra aqui a chave pública dele (ECDH P-256, só em memória): um pedido por computador, que
--      não se troca e vence em 10 minutos; e mostra um código de 8 caracteres tirado dessa chave;
--   3. a pessoa digita esse código no computador que já tem a chave do cofre; ele confere, cifra a chave do cofre para
--      a chave pública do computador novo e entrega aqui. A nuvem só vê texto cifrado, lido uma vez só;
--   4. identidade pendente só vira computador depois de receber a chave (menos a primeira da instalação, que cria a
--      chave): um código de acesso vazado não chega nem a computador ativo.
-- O pedido de ligação pelo painel (frase cifrada para o navegador) sai: painel_comando recusa a ação "ligar".

create table if not exists public.ligacao_pedidos (
  computador_id uuid primary key references public.computadores on delete cascade,   -- o computador novo (pendente)
  aprovador uuid references public.computadores on delete set null,                   -- onde a janela abre (o painel escolhe)
  aprovador_em timestamptz,
  idioma text not null default 'pt-BR' check (idioma in ('pt-BR', 'en')),                -- a língua da janela (a do painel)
  publica jsonb check (publica is null or pg_column_size(publica) <= 512),            -- chave pública do computador novo
  pedido_em timestamptz,
  expira_em timestamptz,
  envelope jsonb check (envelope is null or pg_column_size(envelope) <= 2048),        -- a chave do cofre cifrada para ele
  entregue_por uuid references public.computadores on delete set null,
  entregue_em timestamptz,
  lido_em timestamptz,
  recusado text check (recusado is null or recusado in ('recusado_na_tela', 'dois_pedidos', 'codigo_errado')),
  recusado_em timestamptz
);
alter table public.ligacao_pedidos enable row level security;
revoke all on public.ligacao_pedidos from anon, authenticated;
-- o painel acompanha o pedido, sem a chave pública e sem o envelope
grant select (computador_id, aprovador, aprovador_em, idioma, pedido_em, expira_em, entregue_em, lido_em, recusado, recusado_em)
  on public.ligacao_pedidos to authenticated;
drop policy if exists membro_le on public.ligacao_pedidos;
create policy membro_le on public.ligacao_pedidos for select to authenticated using (public.rvz_eh_membro());

-- ------------------------------------------------------------------------------------------- apoio (não liberadas)

-- Chave pública ECDH P-256 em JWK, só com o que importa (32 bytes por coordenada = 43 caracteres base64url).
create or replace function public.rvz_chave_publica(p jsonb) returns jsonb
language sql immutable set search_path = public, pg_temp as $$
  select case when jsonb_typeof(p) = 'object' and p ->> 'kty' = 'EC' and p ->> 'crv' = 'P-256'
                   and coalesce(p ->> 'x', '') ~ '^[A-Za-z0-9_-]{43}$' and coalesce(p ->> 'y', '') ~ '^[A-Za-z0-9_-]{43}$'
              then jsonb_build_object('kty', 'EC', 'crv', 'P-256', 'x', p ->> 'x', 'y', p ->> 'y') end
$$;

-- O computador novo de quem chama: identidade de computador, linha pendente, não revogada, criada há menos de 24 h.
create or replace function public.rvz_computador_pendente() returns uuid
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v record;
begin
  select c.id, c.revogado, c.sistema, c.criado_em into v
    from public.computadores c join public.membros m on m.user_id = c.user_id and m.papel = 'computador'
   where c.user_id = auth.uid();
  if v.id is null or v.revogado then raise exception 'só computador novo' using errcode = '42501'; end if;
  if v.sistema <> 'pendente' then raise exception 'este computador já entrou na instalação' using errcode = '42501'; end if;
  if v.criado_em < now() - interval '24 hours' then
    raise exception 'código de acesso vencido: crie outro no painel' using errcode = '42501';
  end if;
  return v.id;
end $$;

-- Pedidos abertos de outro computador (o que o computador que tem a chave do cofre pode liberar). Mais de um aberto
-- ao mesmo tempo = todos recusados (quem libera e quem entrega conferem).
create or replace function public.rvz_ligacoes_abertas(p_pc uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('computador_id', q.computador_id, 'publica', q.publica,
                                               'pedido_em', q.pedido_em, 'expira_em', q.expira_em,
                                               'para_mim', q.aprovador is not distinct from p_pc,
                                               'aprovador_em', q.aprovador_em, 'idioma', q.idioma) order by q.pedido_em), '[]'::jsonb)
    from (select l.* from public.ligacao_pedidos l
            join public.computadores c on c.id = l.computador_id and not c.revogado and c.sistema = 'pendente'
           where l.publica is not null and l.entregue_em is null and l.recusado is null and l.expira_em > now()
             and l.computador_id is distinct from p_pc
           order by l.pedido_em limit 5) q
$$;

-- ------------------------------------------------------------------------------------------- painel

-- Em qual computador a janela abre (o painel escolhe um que já tem a chave), e em que língua (a do painel; o texto da
-- janela é fixo, só a língua vem daqui). Escolher de novo abre a janela de novo.
create or replace function public.painel_ligacao_aprovador(p_computador uuid, p_aprovador uuid, p_idioma text default 'pt-BR')
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.rvz_exigir_admin();
  if coalesce(p_idioma, '') not in ('pt-BR', 'en') then raise exception 'idioma desconhecido'; end if;
  if not exists (select 1 from public.computadores where id = p_computador and sistema = 'pendente' and not revogado) then
    raise exception 'computador novo desconhecido ou revogado';
  end if;
  if not exists (select 1 from public.computadores where id = p_aprovador and sistema <> 'pendente' and not revogado) then
    raise exception 'computador desconhecido ou revogado';
  end if;
  insert into public.ligacao_pedidos (computador_id, aprovador, aprovador_em, idioma) values (p_computador, p_aprovador, now(), p_idioma)
  on conflict (computador_id) do update set aprovador = excluded.aprovador, aprovador_em = excluded.aprovador_em,
                                            idioma = excluded.idioma
   where ligacao_pedidos.entregue_em is null and ligacao_pedidos.recusado is null;
  perform public.rvz_auditar('ligacao_aprovador', p_computador::text, jsonb_build_object('aprovador', p_aprovador));
  return jsonb_build_object('ok', true);
end $$;

-- ------------------------------------------------------------------------------------------- computador novo

-- Registra a chave pública do computador novo: uma vez só; a mesma chave de novo (resposta perdida) devolve o mesmo
-- pedido, outra chave é recusada. Vence em 10 minutos.
create or replace function public.agente_ligacao_pedir(p_publica jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_computador_pendente();
  v_pub jsonb := public.rvz_chave_publica(p_publica);
  v_novo uuid;
  v record;
begin
  if v_pub is null then raise exception 'chave pública inválida'; end if;
  insert into public.ligacao_pedidos (computador_id, publica, pedido_em, expira_em)
  values (v_pc, v_pub, now(), now() + interval '10 minutes')
  on conflict (computador_id) do update set publica = excluded.publica, pedido_em = excluded.pedido_em,
                                            expira_em = excluded.expira_em
   where ligacao_pedidos.publica is null and ligacao_pedidos.recusado is null and ligacao_pedidos.entregue_em is null
  returning computador_id into v_novo;
  select * into v from public.ligacao_pedidos where computador_id = v_pc;
  if v.publica is distinct from v_pub then
    raise exception 'este código de acesso já pediu para entrar uma vez: gere outro no painel' using errcode = '42501';
  end if;
  if v.recusado is not null or v.entregue_em is not null or v.expira_em <= now() then
    raise exception 'este pedido já fechou: gere outro código no painel' using errcode = '42501';
  end if;
  if v_novo is not null then
    perform public.rvz_evento('info', 'Um computador novo pediu para entrar (o código aparece nele).',
                              jsonb_build_object('computador', v_pc, 'ligacao', 'pedido'));
  end if;
  return jsonb_build_object('ok', true, 'computador_id', v_pc, 'expira_em', v.expira_em);
end $$;

-- O computador novo busca a chave entregue: lida uma vez só (o envelope sai do banco na leitura).
create or replace function public.agente_ligacao_receber() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_computador_pendente();
  v record;
  v_aprovador text;
begin
  select * into v from public.ligacao_pedidos where computador_id = v_pc for update;
  if v.publica is null then return jsonb_build_object('estado', 'sem_pedido'); end if;
  if v.recusado is not null then return jsonb_build_object('estado', 'recusado', 'motivo', v.recusado); end if;
  if v.lido_em is not null then return jsonb_build_object('estado', 'lido'); end if;
  if v.envelope is not null and v.entregue_em > now() - interval '10 minutes' then
    update public.ligacao_pedidos set envelope = null, lido_em = now() where computador_id = v_pc;
    return jsonb_build_object('estado', 'entregue', 'envelope', v.envelope,
      'impressao', (select valor #>> '{}' from public.config where chave = 'cofre_impressao'));
  end if;
  if v.entregue_em is not null or v.expira_em <= now() then
    update public.ligacao_pedidos set envelope = null where computador_id = v_pc and envelope is not null;
    return jsonb_build_object('estado', 'vencido');
  end if;
  select nome into v_aprovador from public.computadores where id = v.aprovador and not revogado and sistema <> 'pendente';
  return jsonb_build_object('estado', 'esperando', 'expira_em', v.expira_em, 'aprovador', v_aprovador);
end $$;

-- ------------------------------------------------------------------------------------------- quem tem a chave

create or replace function public.agente_ligacoes_abertas() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pc uuid := public.rvz_exigir_computador();
begin
  return jsonb_build_object('ok', true, 'pedidos', public.rvz_ligacoes_abertas(v_pc));
end $$;

-- Entrega a chave do cofre cifrada para a chave pública do pedido. Só computador ativo, só para o pedido aberto com a
-- mesma chave pública que ele conferiu, e só se ele for o único aberto (dois ao mesmo tempo: recusa todos).
create or replace function public.agente_ligacao_entregar(p_computador uuid, p_publica jsonb, p_envelope jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  v_env jsonb;
  v_abertos integer;
  v record;
begin
  if jsonb_typeof(p_envelope) = 'object'
     and public.rvz_chave_publica(p_envelope -> 'efemera') is not null
     and coalesce(p_envelope ->> 'iv', '') ~ '^[A-Za-z0-9+/]{16}$'
     and coalesce(p_envelope ->> 'cifrado', '') ~ '^[A-Za-z0-9+/]{40,128}={0,2}$' then
    v_env := jsonb_build_object('efemera', public.rvz_chave_publica(p_envelope -> 'efemera'), 'iv', p_envelope ->> 'iv',
                                'cifrado', p_envelope ->> 'cifrado');
  else
    raise exception 'envelope inválido';
  end if;
  perform pg_advisory_xact_lock(778802);
  -- o envelope que ninguém leu em 10 minutos não fica guardado
  update public.ligacao_pedidos set envelope = null where envelope is not null and entregue_em < now() - interval '10 minutes';
  select count(*) into v_abertos from public.ligacao_pedidos l
    join public.computadores c on c.id = l.computador_id and not c.revogado and c.sistema = 'pendente'
   where l.publica is not null and l.entregue_em is null and l.recusado is null and l.expira_em > now();
  if v_abertos > 1 then
    update public.ligacao_pedidos set recusado = 'dois_pedidos', recusado_em = now()
     where publica is not null and entregue_em is null and recusado is null and expira_em > now();
    perform public.rvz_evento('aviso', 'Dois computadores novos pediram para entrar ao mesmo tempo: os dois foram recusados.',
                              jsonb_build_object('por', v_pc, 'ligacao', 'recusado', 'motivo', 'dois_pedidos'));
    return jsonb_build_object('ok', false, 'erro', 'dois pedidos de ligação ao mesmo tempo: recusei os dois; gere de novo no painel');
  end if;
  select l.* into v from public.ligacao_pedidos l
    join public.computadores c on c.id = l.computador_id and not c.revogado and c.sistema = 'pendente'
   where l.computador_id = p_computador and l.computador_id <> v_pc for update of l;
  if v.computador_id is null or v.publica is null then return jsonb_build_object('ok', false, 'erro', 'pedido desconhecido'); end if;
  if v.publica is distinct from public.rvz_chave_publica(p_publica) then
    return jsonb_build_object('ok', false, 'erro', 'a chave do pedido não é a que foi conferida');
  end if;
  if v.entregue_em is not null or v.recusado is not null then return jsonb_build_object('ok', false, 'erro', 'pedido já fechado'); end if;
  if v.expira_em <= now() then return jsonb_build_object('ok', false, 'erro', 'pedido vencido'); end if;
  update public.ligacao_pedidos set envelope = v_env, entregue_por = v_pc, entregue_em = now() where computador_id = p_computador;
  perform public.rvz_evento('info', 'Computador novo liberado: a chave do cofre foi entregue cifrada só para ele.',
                            jsonb_build_object('computador', p_computador, 'por', v_pc, 'ligacao', 'entregue'));
  return jsonb_build_object('ok', true);
end $$;

-- Recusa um pedido aberto (Recusar na janela, código errado três vezes, ou dois pedidos ao mesmo tempo).
create or replace function public.agente_ligacao_recusar(p_computador uuid, p_motivo text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  v_feito boolean;
begin
  if coalesce(p_motivo, '') not in ('recusado_na_tela', 'dois_pedidos', 'codigo_errado') then raise exception 'motivo inválido'; end if;
  update public.ligacao_pedidos set recusado = p_motivo, recusado_em = now(), envelope = null
   where computador_id = p_computador and computador_id <> v_pc and publica is not null and entregue_em is null and recusado is null;
  v_feito := found;
  if v_feito then
    perform public.rvz_evento('aviso', case p_motivo
        when 'dois_pedidos' then 'Dois computadores novos pediram para entrar ao mesmo tempo: os dois foram recusados.'
        when 'codigo_errado' then 'Pedido de computador novo recusado: o código digitado não conferiu três vezes.'
        else 'Pedido de computador novo recusado na tela de um computador.' end,
      jsonb_build_object('computador', p_computador, 'por', v_pc, 'ligacao', 'recusado', 'motivo', p_motivo));
  end if;
  return jsonb_build_object('ok', v_feito);
end $$;

-- ------------------------------------------------------------------------------------------- registro e busca

-- Identidade pendente só vira computador depois de receber a chave do cofre pelo pedido (a primeira da instalação,
-- antes de existir chave, cria a chave depois de registrar).
create or replace function public.agente_registrar(p_nome text, p_sistema text, p_versao text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_atual record;
  v_nome text := btrim(regexp_replace(regexp_replace(left(coalesce(p_nome, ''), 80), '[^[:alnum:] _()-]+', ' ', 'g'), '\s+', ' ', 'g'));
begin
  if (select m.papel from public.membros m where m.user_id = auth.uid()) is distinct from 'computador' then
    raise exception 'só identidade de computador' using errcode = '42501';
  end if;
  if coalesce(p_sistema, '') not in ('macos', 'linux', 'windows') then raise exception 'sistema inválido'; end if;
  select id, revogado, sistema, criado_em into v_atual from public.computadores where user_id = auth.uid() for update;
  if not found then raise exception 'acesso sem registro: crie outro no painel' using errcode = '42501'; end if;
  if v_atual.revogado then raise exception 'computador revogado' using errcode = '42501'; end if;
  if v_atual.sistema = 'pendente' and v_atual.criado_em < now() - interval '24 hours' then
    raise exception 'código de acesso vencido: crie outro no painel' using errcode = '42501';
  end if;
  if v_atual.sistema = 'pendente'
     and exists (select 1 from public.config where chave = 'cofre_impressao')
     and not exists (select 1 from public.ligacao_pedidos where computador_id = v_atual.id and lido_em is not null) then
    raise exception 'este computador ainda não recebeu a chave do cofre: termine a ligação (o código aparece nele e é digitado num computador que já usa o Reveza)'
      using errcode = '42501';
  end if;
  if v_nome = '' then v_nome := 'computador'; end if;
  update public.computadores set nome = v_nome, sistema = p_sistema, versao = left(p_versao, 40), visto_em = now()
   where user_id = auth.uid()
  returning id into v_id;
  return jsonb_build_object('computador_id', v_id);
end $$;

-- A busca de 5 em 5 s (a de 0010) passa a levar os pedidos de computador novo abertos.
create or replace function public.agente_ola(p_versao text, p_diagnostico jsonb default null, p_conta_local text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  v_local uuid;
  v_atr record;
  v_cfg jsonb;
  v_cmds jsonb;
begin
  update public.computadores
     set visto_em = now(), versao = left(p_versao, 40), diagnostico = coalesce(p_diagnostico, diagnostico)
   where id = v_pc;
  -- Renova só a posse de uso da conta atribuída; a de uma conta que saiu vence sozinha.
  update public.posse set expira_em = now() + interval '2 minutes'
   where computador_id = v_pc and motivo = 'uso'
     and conta_id = (select conta_id from public.atribuicao where computador_id = v_pc);
  -- Primeira vez: a conta que já está no computador vira a atribuição dele (se ninguém mais a usa nem a tem em mãos),
  -- com a mesma trava do rvz_atribuir.
  if not exists (select 1 from public.atribuicao where computador_id = v_pc) and p_conta_local is not null then
    perform pg_advisory_xact_lock(778801);
    select id into v_local from public.contas where email = lower(p_conta_local) and not pausada and not precisa_login;
    if v_local is not null
       and not exists (select 1 from public.atribuicao where conta_id = v_local)
       and not exists (select 1 from public.atribuicao where computador_id = v_pc)
       and not exists (select 1 from public.posse where conta_id = v_local and computador_id <> v_pc and expira_em > now()) then
      insert into public.atribuicao (computador_id, conta_id, motivo) values (v_pc, v_local, 'conta que já estava no computador');
    end if;
  end if;
  update public.comandos set estado = 'expirado'
   where computador_id = v_pc and estado = 'pendente' and criado_em < now() - interval '2 minutes';
  select a.conta_id, a.versao, a.motivo, c.email into v_atr
    from public.atribuicao a left join public.contas c on c.id = a.conta_id where a.computador_id = v_pc;
  select jsonb_object_agg(chave, valor) into v_cfg from public.config;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'acao', acao, 'corpo', corpo, 'criado_em', criado_em) order by id), '[]')
    into v_cmds
    from (select id, acao, corpo, criado_em from public.comandos
           where computador_id = v_pc and estado = 'pendente' order by id limit 10) q;
  return jsonb_build_object(
    'computador_id', v_pc,
    'atribuicao', case when v_atr.conta_id is null then null else
      jsonb_build_object('conta_id', v_atr.conta_id, 'email', v_atr.email, 'versao', v_atr.versao, 'motivo', v_atr.motivo) end,
    'config', v_cfg,
    'comandos', v_cmds,
    'ligacao_pendente', exists (select 1 from public.ligacoes where usado_em is null and expira_em > now()),
    'ligacoes', public.rvz_ligacoes_abertas(v_pc));
end $$;

-- Pedido do painel a um computador (o de 0010), sem a ação "ligar": a frase cifrada para o navegador saiu na 0.2.0.
create or replace function public.painel_comando(p_computador uuid, p_acao text, p_corpo jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint;
begin
  perform public.rvz_exigir_admin();
  if p_acao = 'ligar' then
    raise exception 'o pedido de ligação pelo painel saiu: o código aparece no computador novo e é digitado no que já usa o Reveza';
  end if;
  if not exists (select 1 from public.computadores where id = p_computador and not revogado) then
    raise exception 'computador desconhecido ou revogado';
  end if;
  if jsonb_typeof(coalesce(p_corpo, '{}')) <> 'object' then raise exception 'pedido inválido'; end if;
  if p_acao in ('conectar', 'entrar_de_novo') and coalesce(p_corpo ->> 'email', '')
       !~ '^[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$' then
    raise exception 'e-mail inválido';
  end if;
  if p_acao in ('codigo_login', 'cancelar_login') and coalesce(p_corpo ->> 'login_id', '') !~ '^[0-9a-f]{6,32}$' then
    raise exception 'login desconhecido';
  end if;
  if p_acao = 'codigo_login' and (coalesce(p_corpo ->> 'codigo', '') = '' or length(p_corpo ->> 'codigo') > 4000
                                  or p_corpo ->> 'codigo' ~ '[\r\n]') then
    raise exception 'código inválido';
  end if;
  if p_acao = 'retomar_sessao' and coalesce(p_corpo ->> 'sessao', '') !~ '^[A-Za-z0-9_-]{1,80}$' then
    raise exception 'sessão inválida';
  end if;
  insert into public.comandos (criado_por, computador_id, acao, corpo)
  values (auth.uid(), p_computador, p_acao, coalesce(p_corpo, '{}')) returning id into v_id;
  perform public.rvz_auditar('comando', p_acao, jsonb_build_object('computador', p_computador, 'id', v_id));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
