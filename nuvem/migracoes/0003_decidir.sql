-- Reveza AI · 0003 · a decisão de troca, na nuvem (seção 6 da ARQUITETURA).
-- reaplicável: só funções e agenda (create or replace); o instalador roda de novo quando o arquivo muda.
-- Roda para um computador (depois de cada relato de uso ou aviso de limite) ou para todos (pg_cron, a cada minuto).

create or replace function public.rvz_cfg(p_chave text, p_padrao jsonb) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select valor from public.config where chave = p_chave), p_padrao)
$$;

-- Maior % entre as janelas que decidem; janela cujo reset já passou conta como zero; null = sem leitura válida.
create or replace function public.rvz_pct_efetivo(p_conta uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select max(case when j.reset_em is not null and j.reset_em <= now() then 0 else j.pct end)
    from public.uso_janelas j
   where j.conta_id = p_conta and j.pct is not null
     and (j.lido_em > now() - interval '15 minutes' or (j.reset_em is not null and j.reset_em <= now()))
$$;

-- A agenda da conta deixa usar agora? Lista vazia = sempre. Item: {"dias":[1..7], "de":"08:00", "ate":"18:00"}
-- (1 = segunda), no fuso da configuração (padrão America/Sao_Paulo).
create or replace function public.rvz_agenda_permite(p_agenda jsonb) returns boolean
language plpgsql stable as $$
declare
  v_agora timestamp := now() at time zone coalesce(public.rvz_cfg('fuso', '"America/Sao_Paulo"') #>> '{}', 'America/Sao_Paulo');
  v_dia int := extract(isodow from v_agora);
  v_hora time := v_agora::time;
  item jsonb;
begin
  if p_agenda is null or jsonb_array_length(p_agenda) = 0 then return true; end if;
  for item in select * from jsonb_array_elements(p_agenda) loop
    if (item -> 'dias') ? v_dia::text or exists (select 1 from jsonb_array_elements(item -> 'dias') d where d::int = v_dia) then
      if v_hora >= (item ->> 'de')::time and v_hora < (item ->> 'ate')::time then return true; end if;
    end if;
  end loop;
  return false;
exception when others then
  return true; -- agenda que não se lê não derruba a decisão de todo mundo (o painel já recusa na gravação)
end $$;

-- Quanto da semana a conta "deveria" ter gasto até agora, se a cota fosse dividida igual pelos dias.
create or replace function public.rvz_ritmo_semana(p_conta uuid) returns numeric
language sql stable security definer set search_path = public, pg_temp as $$
  select case when j.reset_em is null or j.pct is null then null
              else j.pct - greatest(0, least(100, 100 - extract(epoch from (j.reset_em - now())) / (7 * 864))) end
    from public.uso_janelas j where j.conta_id = p_conta and j.tipo = 'seven_day'
$$;

-- Contas livres para um computador, na ordem de preferência. p_ordem: 'preferencia', 'aleatoria' ou 'menor_uso'.
create or replace function public.rvz_candidatas(p_pc uuid, p_ordem text default 'preferencia') returns table (conta_id uuid, efetivo numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id, public.rvz_pct_efetivo(c.id)
    from public.contas c
   where not c.pausada and not c.precisa_login
     and not exists (select 1 from public.atribuicao a where a.conta_id = c.id and a.computador_id <> p_pc)
     and not exists (select 1 from public.posse p where p.conta_id = c.id and p.computador_id <> p_pc and p.expira_em > now())
     and not exists (select 1 from public.atribuicao a where a.conta_id = c.id and a.computador_id = p_pc)
     and exists (select 1 from public.cofre k where k.conta_id = c.id)
     and public.rvz_agenda_permite(c.agenda)
     and public.rvz_pct_efetivo(c.id) is not null
     and public.rvz_pct_efetivo(c.id) < (public.rvz_cfg('aviso', '90') #>> '{}')::numeric
     and (c.teto_semana is null or coalesce((select j.pct from public.uso_janelas j
                                              where j.conta_id = c.id and j.tipo = 'seven_day'), 0) < c.teto_semana)
   order by c.reserva,
            case when p_ordem = 'aleatoria' then random() else 0 end,
            case when p_ordem = 'menor_uso' then public.rvz_pct_efetivo(c.id) else 0 end,
            c.prioridade,
            coalesce(public.rvz_ritmo_semana(c.id), 0) > 0,
            public.rvz_pct_efetivo(c.id),
            c.email
$$;

create or replace function public.rvz_atribuir(p_pc uuid, p_conta uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_de uuid;
begin
  -- uma atribuição de cada vez no projeto inteiro: duas decisões simultâneas não dão a mesma conta a dois computadores
  perform pg_advisory_xact_lock(778801);
  if p_conta is not null and exists (select 1 from public.atribuicao where conta_id = p_conta and computador_id <> p_pc) then
    return;
  end if;
  select conta_id into v_de from public.atribuicao where computador_id = p_pc;
  insert into public.atribuicao (computador_id, conta_id, motivo, versao, decidido_em)
  values (p_pc, p_conta, p_motivo, 1, now())
  on conflict (computador_id) do update set conta_id = excluded.conta_id, motivo = excluded.motivo,
                                            versao = atribuicao.versao + 1, decidido_em = now();
  perform public.rvz_evento('troca',
    format('Troca: %s → %s (%s).',
           coalesce((select email from public.contas where id = v_de), 'nenhuma'),
           coalesce((select email from public.contas where id = p_conta), 'nenhuma'), p_motivo),
    jsonb_build_object('computador', p_pc, 'de', v_de, 'para', p_conta, 'motivo', p_motivo));
end $$;

create or replace function public.decidir(p_pc uuid default null, p_limite boolean default false) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_auto boolean := (public.rvz_cfg('auto', 'false') #>> '{}')::boolean;
  v_modo text := public.rvz_cfg('modo', '"limiar"') #>> '{}';
  v_aviso numeric := (public.rvz_cfg('aviso', '90') #>> '{}')::numeric;
  v_troca numeric := (public.rvz_cfg('troca', '95') #>> '{}')::numeric;
  v_espera int := (public.rvz_cfg('espera_entre_trocas_s', '90') #>> '{}')::int;
  v_rod_min int := (public.rvz_cfg('rodizio_minutos', '90') #>> '{}')::int;
  v_rod_ordem text := public.rvz_cfg('rodizio_ordem', '"aleatoria"') #>> '{}';
  v_prox timestamptz := nullif(public.rvz_cfg('proximo_rodizio_em', 'null') #>> '{}', '')::timestamptz;
  v_gatilho numeric := case when v_modo = 'limite' then 100 else v_troca end;
  pc record;
  v_atual uuid;
  v_quando timestamptz;
  v_ef numeric;
  v_cand uuid;
  v_trocas int := 0;
begin
  for pc in select c.id from public.computadores c
             where not c.revogado and c.visto_em > now() - interval '2 minutes' and (p_pc is null or c.id = p_pc)
             order by c.id
             for update loop
    select conta_id, decidido_em into v_atual, v_quando from public.atribuicao where computador_id = pc.id for update;

    -- Computador sem conta: recebe a melhor livre (mesmo com a troca automática desligada, para começar a trabalhar).
    if v_atual is null then
      select conta_id into v_cand from public.rvz_candidatas(pc.id) limit 1;
      if v_cand is not null then
        perform public.rvz_atribuir(pc.id, v_cand, 'computador sem conta');
        v_trocas := v_trocas + 1;
      end if;
      continue;
    end if;

    if not v_auto then continue; end if;
    v_ef := public.rvz_pct_efetivo(v_atual);

    if p_limite or (v_ef is not null and v_ef >= v_gatilho) then
      select conta_id into v_cand from public.rvz_candidatas(pc.id) limit 1;
      if v_cand is null then
        if not exists (select 1 from public.eventos where tipo = 'alerta' and dados ->> 'motivo' = 'sem_livre'
                       and em > now() - interval '1 hour') then
          perform public.rvz_evento('alerta', 'Nenhuma conta livre para trocar.',
                                    jsonb_build_object('motivo', 'sem_livre', 'computador', pc.id));
        end if;
      elsif p_limite or v_quando is null or v_quando < now() - make_interval(secs => v_espera) then
        perform public.rvz_atribuir(pc.id, v_cand,
          case when p_limite then 'a sessão bateu o limite' when v_modo = 'limite' then 'chegou a 100%'
               else format('chegou a %s%%', v_troca) end);
        v_trocas := v_trocas + 1;
      end if;
      continue;
    end if;

    if v_modo = 'rodizio' and v_prox is not null and now() >= v_prox
       and (v_quando is null or v_quando < now() - make_interval(secs => v_espera)) then
      select conta_id into v_cand from public.rvz_candidatas(pc.id, v_rod_ordem) limit 1;
      if v_cand is not null then
        perform public.rvz_atribuir(pc.id, v_cand, 'rodízio do dia');
        v_trocas := v_trocas + 1;
      end if;
      continue;
    end if;

    if v_ef is not null and v_ef >= v_aviso
       and not exists (select 1 from public.eventos where tipo = 'aviso' and dados ->> 'conta' = v_atual::text
                       and em > now() - interval '5 hours') then
      perform public.rvz_evento('aviso', format('Conta em uso chegou a %s%%.', round(v_ef)),
                                jsonb_build_object('conta', v_atual, 'computador', pc.id, 'pct', v_ef));
    end if;
  end loop;

  -- Agenda o próximo rodízio quando o modo é rodízio e o horário passou (ou nunca foi marcado).
  if v_modo = 'rodizio' and (v_prox is null or now() >= v_prox) then
    insert into public.config (chave, valor) values ('proximo_rodizio_em',
      to_jsonb(now() + make_interval(secs => (v_rod_min * 60 * (0.75 + random() * 0.5))::int)))
    on conflict (chave) do update set valor = excluded.valor, mudado_em = now();
  end if;
  return v_trocas;
end $$;
