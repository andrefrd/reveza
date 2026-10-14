-- Reveza AI · 0025 · modelo de cada conta e saída enxuta de cada computador (pedido de um usuário, 13/10/2026).
-- reaplicável: colunas e restrição com "if not exists", funções (create or replace).
--
-- 1. Cada conta pode ter um modelo (opus, sonnet, claude-opus-5-5, claude-fable-5[1m]...). Quando um computador passa
--    para ela, o agente grava esse modelo no settings.json do Claude Code. Conta sem modelo: o agente não mexe no
--    modelo (e devolve o que a pessoa tinha, se foi ele quem trocou).
-- 2. Cada computador pode ligar a saída enxuta: o agente põe um gancho no Claude Code que encurta a saída de comandos
--    conhecidos (git status, git diff, ls, find, grep...) antes de ela entrar na conversa. Desligada por padrão.

alter table public.contas add column if not exists modelo text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'contas_modelo_formato') then
    alter table public.contas add constraint contas_modelo_formato
      check (modelo is null or modelo ~ '^[a-z0-9][a-z0-9.-]{0,62}(\[1m\])?$');
  end if;
end $$;

alter table public.computadores add column if not exists enxugar boolean not null default false;

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
  select a.conta_id, a.versao, a.motivo, c.email, c.modelo into v_atr
    from public.atribuicao a left join public.contas c on c.id = a.conta_id where a.computador_id = v_pc;
  select jsonb_object_agg(chave, valor) into v_cfg from public.config;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'acao', acao, 'corpo', corpo, 'criado_em', criado_em) order by id), '[]')
    into v_cmds
    from (select id, acao, corpo, criado_em from public.comandos
           where computador_id = v_pc and estado = 'pendente' order by id limit 10) q;
  return jsonb_build_object(
    'computador_id', v_pc,
    'atribuicao', case when v_atr.conta_id is null then null else
      jsonb_build_object('conta_id', v_atr.conta_id, 'email', v_atr.email, 'versao', v_atr.versao, 'motivo', v_atr.motivo,
                         'modelo', v_atr.modelo) end,
    'config', v_cfg,
    'comandos', v_cmds,
    'enxugar', coalesce((select enxugar from public.computadores where id = v_pc), false),
    'ligacao_pendente', exists (select 1 from public.ligacoes where usado_em is null and expira_em > now()),
    'ligacoes', public.rvz_ligacoes_abertas(v_pc));
end $$;

-- Painel: o "modelo" entra na lista do que se muda numa conta. Vazio ou nulo tira (o agente não mexe mais no modelo).
create or replace function public.painel_conta(p_conta uuid, p_campos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  k text;
  v_modelo text;
begin
  perform public.rvz_exigir_admin();
  for k in select jsonb_object_keys(p_campos) loop
    if k not in ('cor', 'prioridade', 'reserva', 'pausada', 'agenda', 'teto_semana', 'modelo') then
      raise exception 'campo não permitido: %', k;
    end if;
  end loop;
  if p_campos ? 'agenda' and not public.rvz_agenda_valida(p_campos -> 'agenda') then
    raise exception 'agenda inválida: lista de {"dias":[1..7], "de":"HH:MM", "ate":"HH:MM"}';
  end if;
  if p_campos ? 'modelo' then
    if jsonb_typeof(p_campos -> 'modelo') not in ('string', 'null') then
      raise exception 'modelo inválido';
    end if;
    v_modelo := nullif(lower(btrim(p_campos ->> 'modelo')), '');
    if v_modelo is not null and v_modelo !~ '^[a-z0-9][a-z0-9.-]{0,62}(\[1m\])?$' then
      raise exception 'modelo inválido';
    end if;
  end if;
  update public.contas set
    cor = coalesce((p_campos ->> 'cor')::smallint, cor),
    prioridade = coalesce((p_campos ->> 'prioridade')::smallint, prioridade),
    reserva = coalesce((p_campos ->> 'reserva')::boolean, reserva),
    pausada = coalesce((p_campos ->> 'pausada')::boolean, pausada),
    agenda = coalesce(p_campos -> 'agenda', agenda),
    teto_semana = case when p_campos ? 'teto_semana' then (p_campos ->> 'teto_semana')::numeric else teto_semana end,
    modelo = case when p_campos ? 'modelo' then v_modelo else modelo end
  where id = p_conta;
  if not found then raise exception 'conta desconhecida'; end if;
  perform public.rvz_auditar('conta', p_conta::text, p_campos);
  return jsonb_build_object('ok', true);
end $$;

-- Painel (administrador com duas etapas): liga ou desliga a saída enxuta de um computador.
create or replace function public.painel_computador_enxugar(p_computador uuid, p_ligado boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.rvz_exigir_admin();
  if not exists (select 1 from public.computadores where id = p_computador and not revogado) then
    raise exception 'computador desconhecido';
  end if;
  update public.computadores set enxugar = coalesce(p_ligado, false) where id = p_computador;
  perform public.rvz_auditar('enxugar', p_computador::text, jsonb_build_object('ligado', coalesce(p_ligado, false)));
  return jsonb_build_object('ok', true);
end $$;
