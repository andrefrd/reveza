-- Reveza AI · 0024 · conta preferida de cada computador (pedido de um usuário, 13/10/2026).
-- reaplicável: coluna e índice com "if not exists", funções (create or replace).
--
-- A prioridade das contas vale para todos os computadores. Quem tem uma conta maior (um plano 20x, por exemplo) quer
-- que ela fique num computador certo. Cada computador pode ter uma conta preferida, e uma conta é preferida de um
-- computador só. A regra:
--   1. Para este computador, a preferida vem antes de todas as outras candidatas (mesmo regras: livre, com login,
--      dentro da agenda, abaixo do aviso).
--   2. Para os outros, enquanto o dono dela está ligado, ela vem depois das demais (só entra se não houver outra).
--   3. Com a troca automática ligada, o computador volta para a preferida quando ela fica livre de novo, respeitando a
--      espera entre trocas. Troca pedida pelo painel ou pela API não é desfeita: fica até a próxima troca da regra.
--   4. Se outro computador estiver com a preferida e o dono ligado sem ela, o outro devolve e pega a melhor que sobrar
--      (nunca uma reserva nem a preferida de um terceiro). Sem outra para pegar, fica como está.

alter table public.computadores add column if not exists conta_preferida uuid references public.contas(id) on delete set null;
create unique index if not exists computadores_conta_preferida_unica on public.computadores (conta_preferida)
  where conta_preferida is not null and not revogado;

-- Outro computador ligado (visto nos últimos 2 minutos, não revogado) prefere esta conta.
create or replace function public.rvz_preferida_de_outro(p_conta uuid, p_pc uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.computadores q
                  where q.conta_preferida = p_conta and q.id is distinct from p_pc and not q.revogado
                    and q.visto_em > now() - interval '2 minutes')
$$;

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
   order by c.id is not distinct from (select q.conta_preferida from public.computadores q where q.id = p_pc) desc,
            c.reserva,
            public.rvz_preferida_de_outro(c.id, p_pc),
            case when p_ordem = 'aleatoria' then random() else 0 end,
            case when p_ordem = 'menor_uso' then public.rvz_pct_efetivo(c.id) else 0 end,
            c.prioridade,
            coalesce(public.rvz_ritmo_semana(c.id), 0) > 0,
            public.rvz_pct_efetivo(c.id),
            c.email
$$;

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
  v_manual text[] := array['pedido pelo painel', 'pedido pela API'];
  pc record;
  v_atual uuid;
  v_quando timestamptz;
  v_motivo text;
  v_pref uuid;
  v_esperou boolean;
  v_ef numeric;
  v_cand uuid;
  v_trocas int := 0;
begin
  for pc in select c.id, c.conta_preferida from public.computadores c
             where not c.revogado and c.visto_em > now() - interval '2 minutes' and (p_pc is null or c.id = p_pc)
             order by c.id
             for update loop
    v_atual := null; v_quando := null; v_motivo := null;
    select conta_id, decidido_em, motivo into v_atual, v_quando, v_motivo
      from public.atribuicao where computador_id = pc.id for update;
    v_pref := pc.conta_preferida;

    -- Computador sem conta: recebe a melhor livre (mesmo com a troca automática desligada, para começar a trabalhar).
    -- A preferida dele vem primeiro na lista.
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
    v_esperou := v_quando is null or v_quando < now() - make_interval(secs => v_espera);

    if p_limite or (v_ef is not null and v_ef >= v_gatilho) then
      select conta_id into v_cand from public.rvz_candidatas(pc.id) limit 1;
      if v_cand is null then
        if not exists (select 1 from public.eventos where tipo = 'alerta' and dados ->> 'motivo' = 'sem_livre'
                       and em > now() - interval '1 hour') then
          perform public.rvz_evento('alerta', 'Nenhuma conta livre para trocar.',
                                    jsonb_build_object('motivo', 'sem_livre', 'computador', pc.id));
        end if;
      elsif p_limite or v_esperou then
        perform public.rvz_atribuir(pc.id, v_cand,
          case when p_limite then 'a sessão bateu o limite' when v_modo = 'limite' then 'chegou a 100%'
               else format('chegou a %s%%', v_troca) end);
        v_trocas := v_trocas + 1;
      end if;
      continue;
    end if;

    -- Volta para a preferida quando ela está livre de novo. Troca pedida à mão fica até a próxima troca da regra.
    if v_pref is not null and v_pref <> v_atual and not (coalesce(v_motivo, '') = any(v_manual)) and v_esperou
       and exists (select 1 from public.rvz_candidatas(pc.id) k where k.conta_id = v_pref) then
      perform public.rvz_atribuir(pc.id, v_pref, 'conta preferida deste computador');
      v_trocas := v_trocas + 1;
      continue;
    end if;

    -- Devolve a preferida de outro computador ligado que está sem ela, se houver outra conta boa para pegar.
    if not (coalesce(v_motivo, '') = any(v_manual)) and v_esperou
       and exists (select 1 from public.computadores q
                    where q.conta_preferida = v_atual and q.id <> pc.id and not q.revogado
                      and q.visto_em > now() - interval '2 minutes'
                      and not exists (select 1 from public.atribuicao qa
                                       where qa.computador_id = q.id and qa.motivo = any(v_manual))) then
      select k.conta_id into v_cand from public.rvz_candidatas(pc.id) k join public.contas c on c.id = k.conta_id
       where not c.reserva and not public.rvz_preferida_de_outro(k.conta_id, pc.id) limit 1;
      if v_cand is not null then
        perform public.rvz_atribuir(pc.id, v_cand, 'devolvendo a conta preferida de outro computador');
        v_trocas := v_trocas + 1;
        continue;
      end if;
    end if;

    -- No rodízio, o computador que está na preferida fica nela.
    if v_modo = 'rodizio' and v_prox is not null and now() >= v_prox and v_esperou
       and v_atual is distinct from v_pref then
      select conta_id into v_cand from public.rvz_candidatas(pc.id, v_rod_ordem) limit 1;
      if v_cand is not null then
        perform public.rvz_atribuir(pc.id, v_cand, 'rodízio do dia');
        v_trocas := v_trocas + 1;
      end if;
      continue;
    end if;

    if v_ef is not null and v_ef >= v_aviso
       and not exists (select 1 from public.eventos where tipo = 'aviso' and origem = 'nuvem' and dados ->> 'conta' = v_atual::text
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

-- Painel (administrador com duas etapas): define ou tira (p_conta nula) a conta preferida de um computador. Se ela
-- estiver livre, o computador passa para ela na hora.
create or replace function public.painel_computador_preferida(p_computador uuid, p_conta uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.rvz_exigir_admin();
  if not exists (select 1 from public.computadores where id = p_computador and not revogado) then
    raise exception 'computador desconhecido';
  end if;
  if p_conta is not null then
    if not exists (select 1 from public.contas where id = p_conta) then
      return jsonb_build_object('ok', false, 'erro', 'conta desconhecida');
    end if;
    if exists (select 1 from public.computadores where conta_preferida = p_conta and id <> p_computador and not revogado) then
      return jsonb_build_object('ok', false, 'erro', 'outro computador já prefere esta conta');
    end if;
  end if;
  update public.computadores set conta_preferida = p_conta where id = p_computador;
  perform public.rvz_auditar('preferida', p_computador::text, jsonb_build_object('conta', p_conta));
  if p_conta is not null and exists (select 1 from public.rvz_candidatas(p_computador) k where k.conta_id = p_conta) then
    perform public.rvz_atribuir(p_computador, p_conta, 'conta preferida deste computador');
  end if;
  return jsonb_build_object('ok', true);
end $$;
