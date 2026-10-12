-- Reveza AI · 0016 · notas da auditoria de segurança (rodada 1, 11/10/2026) que ainda faltavam.
-- reaplicável: funções (create or replace).
--
-- 1. O "aviso" de conta perto do limite que a nuvem dá uma vez a cada 5 horas não pode ser calado por um computador:
--    a conferência de "já avisei" só olha os avisos que a própria nuvem escreveu (origem 'nuvem').
-- 2. O e-mail de uma conta registrada por um computador segue o mesmo formato que o agente aceita, porque ele entra
--    no texto dos alertas e das trocas.

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
  if length(coalesce(p_email, '')) > 254 or lower(coalesce(p_email, '')) !~
     '^[a-z0-9][a-z0-9._%+-]*@[a-z0-9]([a-z0-9-]*[a-z0-9])?([.][a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' then
    raise exception 'e-mail inválido';
  end if;
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

