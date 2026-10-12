-- Reveza AI · 0002 · funções que o agente (cada computador) chama. Todas exigem um computador ativo.
-- reaplicável: só funções e agenda (create or replace); o instalador roda de novo quando o arquivo muda.
-- Binário (cofre, ligação) entra e sai em base64.

create or replace function public.rvz_b64(b bytea) returns text language sql immutable as $$
  select replace(encode(b, 'base64'), E'\n', '')
$$;

create or replace function public.rvz_evento(p_tipo text, p_texto text, p_dados jsonb default '{}') returns void
language sql security definer set search_path = public, pg_temp as $$
  insert into public.eventos (tipo, texto, dados) values (p_tipo, left(p_texto, 500), coalesce(p_dados, '{}'))
$$;

-- Registro do próprio computador (o usuário do Auth já tem papel computador, criado pelo administrador).
create or replace function public.agente_registrar(p_nome text, p_sistema text, p_versao text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if (select m.papel from public.membros m where m.user_id = auth.uid()) is distinct from 'computador' then
    raise exception 'só identidade de computador' using errcode = '42501';
  end if;
  insert into public.computadores (user_id, nome, sistema, versao, visto_em)
  values (auth.uid(), left(p_nome, 80), p_sistema, left(p_versao, 40), now())
  on conflict (user_id) do update set nome = excluded.nome, sistema = excluded.sistema, versao = excluded.versao,
                                       visto_em = now()
  returning id into v_id;
  if (select revogado from public.computadores where id = v_id) then
    raise exception 'computador revogado' using errcode = '42501';
  end if;
  return jsonb_build_object('computador_id', v_id);
end $$;

-- A busca de 5 em 5 s: renova presença e posses, devolve o que este computador deve fazer.
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
  -- Primeira vez: a conta que já está no computador vira a atribuição dele (se ninguém mais a usa).
  if not exists (select 1 from public.atribuicao where computador_id = v_pc) and p_conta_local is not null then
    select id into v_local from public.contas where email = lower(p_conta_local) and not pausada and not precisa_login;
    if v_local is not null and not exists (select 1 from public.atribuicao where conta_id = v_local) then
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
    'ligacao_pendente', exists (select 1 from public.ligacoes where usado_em is null and expira_em > now()));
end $$;

-- Posse exclusiva de uma conta (uso, leitura de uso, renovação ou login). Devolve o cofre cifrado.
create or replace function public.agente_pegar_posse(p_conta uuid, p_motivo text, p_segundos integer default 120) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  v_dono uuid;
  v_cofre record;
begin
  if coalesce(p_motivo, '') not in ('uso', 'leitura', 'renovacao', 'login') then raise exception 'motivo inválido'; end if;
  if p_motivo = 'uso' and not exists (select 1 from public.atribuicao where computador_id = v_pc and conta_id = p_conta) then
    return jsonb_build_object('ok', false, 'erro', 'a nuvem não atribuiu esta conta a este computador');
  end if;
  if p_motivo <> 'uso' and exists (select 1 from public.atribuicao where conta_id = p_conta and computador_id <> v_pc) then
    return jsonb_build_object('ok', false, 'erro', 'conta em uso por outro computador');
  end if;
  select computador_id into v_dono from public.posse where conta_id = p_conta and expira_em > now() for update;
  if v_dono is not null and v_dono <> v_pc then
    return jsonb_build_object('ok', false, 'erro', 'conta com outro computador');
  end if;
  insert into public.posse (conta_id, computador_id, motivo, expira_em)
  values (p_conta, v_pc, p_motivo, now() + make_interval(secs => least(greatest(p_segundos, 10), 600)))
  on conflict (conta_id) do update set computador_id = excluded.computador_id, motivo = excluded.motivo,
                                       desde = case when posse.computador_id = excluded.computador_id then posse.desde else now() end,
                                       expira_em = excluded.expira_em;
  select cifrado, nonce, versao, expira_em into v_cofre from public.cofre where conta_id = p_conta;
  return jsonb_build_object('ok', true, 'cofre', case when v_cofre.versao is null then null else jsonb_build_object(
    'cifrado', public.rvz_b64(v_cofre.cifrado), 'nonce', public.rvz_b64(v_cofre.nonce), 'versao', v_cofre.versao,
    'expira_em', v_cofre.expira_em) end);
end $$;

-- Devolve ao cofre o login mais novo. Exige posse e a versão de antes (ninguém grava por cima de ninguém).
create or replace function public.agente_devolver_cofre(p_conta uuid, p_cifrado text, p_nonce text, p_versao_anterior bigint,
                                             p_expira_em timestamptz default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  v_atual bigint;
begin
  if not exists (select 1 from public.posse where conta_id = p_conta and computador_id = v_pc and expira_em > now()) then
    return jsonb_build_object('ok', false, 'erro', 'sem posse da conta');
  end if;
  select versao into v_atual from public.cofre where conta_id = p_conta for update;
  if coalesce(v_atual, 0) <> p_versao_anterior then
    return jsonb_build_object('ok', false, 'erro', 'versão do cofre mudou', 'versao', v_atual);
  end if;
  insert into public.cofre (conta_id, cifrado, nonce, versao, expira_em, gravado_por, gravado_em)
  values (p_conta, decode(p_cifrado, 'base64'), decode(p_nonce, 'base64'), p_versao_anterior + 1, p_expira_em, v_pc, now())
  on conflict (conta_id) do update set cifrado = excluded.cifrado, nonce = excluded.nonce, versao = excluded.versao,
                                       expira_em = excluded.expira_em, gravado_por = excluded.gravado_por,
                                       gravado_em = excluded.gravado_em;
  return jsonb_build_object('ok', true, 'versao', p_versao_anterior + 1);
end $$;

create or replace function public.agente_soltar_posse(p_conta uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pc uuid := public.rvz_exigir_computador();
begin
  delete from public.posse where conta_id = p_conta and computador_id = v_pc;
  return jsonb_build_object('ok', true);
end $$;

-- Login novo feito neste computador (o login oficial, com a conta conferida). Cria ou substitui o cofre da conta.
create or replace function public.agente_registrar_conta(p_email text, p_organizacao text, p_plano text, p_nivel text,
                                              p_cifrado text, p_nonce text, p_expira_em timestamptz default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  v_id uuid;
  v_versao bigint;
  v_cor smallint;
  v_existe uuid;
begin
  -- Antes de qualquer gravação: conta que outro computador tem (atribuída a ele ou com posse viva) não muda daqui.
  select id into v_existe from public.contas where email = lower(p_email);
  if v_existe is not null and (
       exists (select 1 from public.atribuicao where conta_id = v_existe and computador_id <> v_pc)
    or exists (select 1 from public.posse where conta_id = v_existe and computador_id <> v_pc and expira_em > now())) then
    return jsonb_build_object('ok', false, 'erro', 'conta com outro computador agora; tente de novo em instantes');
  end if;
  select coalesce(max(cor) + 1, 0) % 32 into v_cor from public.contas;
  insert into public.contas (email, organizacao, plano, nivel, cor)
  values (lower(p_email), left(p_organizacao, 200), left(p_plano, 40), left(p_nivel, 40), v_cor)
  on conflict (email) do update set organizacao = excluded.organizacao, plano = excluded.plano, nivel = excluded.nivel,
                                    precisa_login = false
  returning id into v_id;
  select coalesce(versao, 0) + 1 into v_versao from public.cofre where conta_id = v_id;
  v_versao := coalesce(v_versao, 1);
  insert into public.cofre (conta_id, cifrado, nonce, versao, expira_em, gravado_por)
  values (v_id, decode(p_cifrado, 'base64'), decode(p_nonce, 'base64'), v_versao, p_expira_em, v_pc)
  on conflict (conta_id) do update set cifrado = excluded.cifrado, nonce = excluded.nonce, versao = excluded.versao,
                                       expira_em = excluded.expira_em, gravado_por = excluded.gravado_por,
                                       gravado_em = now();
  perform public.rvz_evento('conexao', format('%s conectada.', lower(p_email)),
                            jsonb_build_object('conta', v_id, 'computador', v_pc));
  return jsonb_build_object('ok', true, 'conta_id', v_id, 'versao', v_versao);
end $$;

-- Uso das janelas (das contas que este computador tem em mãos) e pontos de histórico.
create or replace function public.agente_relatar_uso(p_janelas jsonb, p_historico jsonb default '[]') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  j jsonb;
  n integer := 0;
begin
  if jsonb_typeof(p_janelas) <> 'array' or jsonb_array_length(p_janelas) > 100 then raise exception 'janelas inválidas'; end if;
  for j in select * from jsonb_array_elements(p_janelas) loop
    if not exists (select 1 from public.posse where conta_id = (j ->> 'conta_id')::uuid and computador_id = v_pc
                   and expira_em > now() - interval '1 minute') then
      continue;  -- só relata quem tem a conta em mãos
    end if;
    insert into public.uso_janelas (conta_id, tipo, pct, reset_em, lido_em, fonte)
    values ((j ->> 'conta_id')::uuid, j ->> 'tipo', (j ->> 'pct')::numeric, (j ->> 'reset_em')::timestamptz, now(),
            coalesce(j ->> 'fonte', 'api'))
    on conflict (conta_id, tipo) do update set pct = excluded.pct, reset_em = excluded.reset_em,
                                               lido_em = excluded.lido_em, fonte = excluded.fonte;
    n := n + 1;
  end loop;
  if jsonb_typeof(p_historico) = 'array' and jsonb_array_length(p_historico) <= 500 then
    insert into public.uso_historico (conta_id, em, p5, p7)
    select (h ->> 'conta_id')::uuid, (h ->> 'em')::timestamptz, (h ->> 'p5')::numeric, (h ->> 'p7')::numeric
      from jsonb_array_elements(p_historico) h
     where exists (select 1 from public.posse p where p.conta_id = (h ->> 'conta_id')::uuid and p.computador_id = v_pc)
    on conflict do nothing;
  end if;
  perform public.decidir(v_pc, false);
  return jsonb_build_object('ok', true, 'gravadas', n);
end $$;

-- Registro de uso das transcrições: o agente manda o total de cada hora que mudou (idempotente).
create or replace function public.agente_relatar_tokens(p_linhas jsonb, p_sessoes jsonb default '[]') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
begin
  if jsonb_typeof(p_linhas) <> 'array' or jsonb_array_length(p_linhas) > 1000 then raise exception 'linhas inválidas'; end if;
  insert into public.uso_tokens (hora, conta_id, computador_id, projeto, modelo, respostas, entrada, saida,
                                 cache_escrita, cache_leitura, usd)
  select date_trunc('hour', (l ->> 'hora')::timestamptz), nullif(l ->> 'conta_id', '')::uuid, v_pc,
         left(replace(coalesce(l ->> 'projeto', ''), '/', ''), 120), left(l ->> 'modelo', 80),
         (l ->> 'respostas')::int, (l ->> 'entrada')::bigint, (l ->> 'saida')::bigint,
         (l ->> 'cache_escrita')::bigint, (l ->> 'cache_leitura')::bigint, (l ->> 'usd')::numeric
    from jsonb_array_elements(p_linhas) l
  on conflict (hora, coalesce(conta_id, '00000000-0000-0000-0000-000000000000'::uuid), computador_id, projeto, modelo)
  do update set respostas = excluded.respostas, entrada = excluded.entrada, saida = excluded.saida,
                cache_escrita = excluded.cache_escrita, cache_leitura = excluded.cache_leitura, usd = excluded.usd;
  if jsonb_typeof(p_sessoes) = 'array' and jsonb_array_length(p_sessoes) <= 200 then
    insert into public.sessoes (id, computador_id, projeto, inicio, fim, respostas, tokens, usd, agentes, contas, modelos)
    select left(s ->> 'id', 80), v_pc, left(replace(coalesce(s ->> 'projeto', ''), '/', ''), 120),
           (s ->> 'inicio')::timestamptz, (s ->> 'fim')::timestamptz, (s ->> 'respostas')::int,
           (s ->> 'tokens')::bigint, (s ->> 'usd')::numeric, (s ->> 'agentes')::int,
           coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(s -> 'contas') x), '{}'),
           coalesce((select array_agg(left(x, 80)) from jsonb_array_elements_text(s -> 'modelos') x), '{}')
      from jsonb_array_elements(p_sessoes) s
    on conflict (id) do update set fim = excluded.fim, respostas = excluded.respostas, tokens = excluded.tokens,
                                   usd = excluded.usd, agentes = excluded.agentes, contas = excluded.contas,
                                   modelos = excluded.modelos
    where sessoes.computador_id = v_pc;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- A sessão bateu o limite: a conta atribuída vai a 100% e a nuvem decide na hora (sem esperar o intervalo).
create or replace function public.agente_limite(p_conta uuid, p_sessao text default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  v_atr uuid;
  v_versao bigint;
begin
  select conta_id, versao into v_atr, v_versao from public.atribuicao where computador_id = v_pc;
  if v_atr is distinct from p_conta then
    -- O limite foi da conta de antes da troca: nada a fazer, a troca já aconteceu.
    return jsonb_build_object('ok', true, 'trocou', true, 'versao', v_versao);
  end if;
  insert into public.uso_janelas (conta_id, tipo, pct, lido_em, fonte) values (p_conta, 'five_hour', 100, now(), 'sessao')
  on conflict (conta_id, tipo) do update set pct = 100, lido_em = now(), fonte = 'sessao';
  if p_sessao is not null then
    update public.sessoes set parada_no_limite = true where id = p_sessao and computador_id = v_pc;
  end if;
  perform public.rvz_evento('limite', 'Uma sessão bateu o limite.', jsonb_build_object('conta', p_conta, 'computador', v_pc));
  perform public.decidir(v_pc, true);
  select versao into v_versao from public.atribuicao where computador_id = v_pc;
  return jsonb_build_object('ok', true, 'versao', v_versao);
end $$;

create or replace function public.agente_reservar_comando(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  v record;
begin
  update public.comandos set estado = 'reservado', reservado_em = now()
   where id = p_id and computador_id = v_pc and estado = 'pendente' and criado_em > now() - interval '2 minutes'
  returning id, acao, corpo, criado_em into v;
  if v.id is null then return jsonb_build_object('ok', false); end if;
  -- o código de login colado no painel só precisa chegar ao computador: sai da tabela assim que ele reserva
  if v.corpo ? 'codigo' then update public.comandos set corpo = corpo - 'codigo' where id = v.id; end if;
  return jsonb_build_object('ok', true, 'comando',
    jsonb_build_object('id', v.id, 'acao', v.acao, 'corpo', v.corpo, 'criado_em', v.criado_em));
end $$;

create or replace function public.agente_responder_comando(p_id bigint, p_http integer, p_resposta jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pc uuid := public.rvz_exigir_computador();
begin
  update public.comandos
     set estado = case when p_http between 200 and 299 then 'feito'::public.estado_comando else 'recusado' end,
         http = p_http, resposta = p_resposta, concluido_em = now()
   where id = p_id and computador_id = v_pc and estado = 'reservado';
  return jsonb_build_object('ok', found);
end $$;

create or replace function public.agente_evento(p_tipo text, p_texto text, p_dados jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pc uuid := public.rvz_exigir_computador();
begin
  -- 'alerta' é só da nuvem: o que um computador escreve não sai pelos canais de alerta de ninguém
  if coalesce(p_tipo, '') not in ('troca', 'aviso', 'limite', 'retomada', 'conexao', 'erro', 'info') then
    raise exception 'tipo inválido';
  end if;
  perform public.rvz_evento(p_tipo, left(p_texto, 300), coalesce(p_dados, '{}') || jsonb_build_object('computador', v_pc));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.agente_ligacao_publicar(p_embrulho text, p_sal text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  v_exp timestamptz;
begin
  update public.ligacoes set expira_em = now() where usado_em is null and expira_em > now() and criado_por = v_pc;
  insert into public.ligacoes (embrulho, sal, criado_por) values (decode(p_embrulho, 'base64'), decode(p_sal, 'base64'), v_pc)
  returning expira_em into v_exp;
  perform public.rvz_evento('info', 'Ligação de computador novo aberta por 10 minutos.', jsonb_build_object('computador', v_pc));
  return jsonb_build_object('ok', true, 'expira_em', v_exp);
end $$;

create or replace function public.agente_ligacao_buscar() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  v record;
begin
  update public.ligacoes set usado_em = now()
   where id = (select id from public.ligacoes where usado_em is null and expira_em > now() and criado_por <> v_pc
                order by expira_em desc limit 1)
  returning embrulho, sal into v;
  if v.embrulho is null then return jsonb_build_object('ok', false, 'erro', 'nenhuma ligação aberta'); end if;
  return jsonb_build_object('ok', true, 'embrulho', public.rvz_b64(v.embrulho), 'sal', public.rvz_b64(v.sal));
end $$;

-- A conta precisa (ou não precisa mais) entrar de novo: a nuvem para de atribuí-la e, se era a deste computador,
-- troca na hora.
create or replace function public.agente_marcar_login(p_conta uuid, p_precisa boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pc uuid := public.rvz_exigir_computador();
begin
  if not exists (select 1 from public.posse where conta_id = p_conta and computador_id = v_pc)
     and not exists (select 1 from public.atribuicao where conta_id = p_conta and computador_id = v_pc) then
    return jsonb_build_object('ok', false, 'erro', 'conta não está com este computador');
  end if;
  update public.contas set precisa_login = coalesce(p_precisa, false) where id = p_conta;
  if p_precisa and exists (select 1 from public.atribuicao where conta_id = p_conta and computador_id = v_pc) then
    perform public.decidir(v_pc, true);
  end if;
  return jsonb_build_object('ok', true);
end $$;
