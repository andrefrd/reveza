-- Reveza AI · 0014 · disponibilidade contra dados de quem tem menos confiança (auditoria, 11/10/2026).
-- reaplicável: só funções (create or replace).
--
-- 1. Uso e sessões que um computador relata só entram com data plausível (até 400 dias atrás e no máximo 1 hora à
--    frente): data no futuro ficaria para sempre no topo das contas do painel e da API.
-- 2. Revogar um computador também apaga o diagnóstico que ele escreveu (um diagnóstico malformado não fica
--    atrapalhando a tela de quem administra).

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
   where (l ->> 'hora')::timestamptz between now() - interval '400 days' and now() + interval '1 hour'
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
     where (s ->> 'inicio')::timestamptz between now() - interval '400 days' and now() + interval '1 hour'
       and (s ->> 'fim')::timestamptz between now() - interval '400 days' and now() + interval '1 hour'
    on conflict (id) do update set fim = excluded.fim, respostas = excluded.respostas, tokens = excluded.tokens,
                                   usd = excluded.usd, agentes = excluded.agentes, contas = excluded.contas,
                                   modelos = excluded.modelos
    where sessoes.computador_id = v_pc;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.painel_revogar_computador(p_computador uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid; v_desligado boolean;
begin
  perform public.rvz_exigir_admin();
  update public.computadores set revogado = true, diagnostico = null where id = p_computador returning user_id into v_user;
  if v_user is null then return jsonb_build_object('ok', false, 'erro', 'computador desconhecido'); end if;
  -- revogar = desligar a identidade: o login do computador para de funcionar e as sessões abertas caem. Se o Auth
  -- recusar (permissão do esquema auth), as funções do agente já recusam o computador revogado; a auditoria registra.
  begin
    update auth.users set banned_until = 'infinity' where id = v_user;
    delete from auth.sessions where user_id = v_user;
    delete from auth.refresh_tokens where user_id = v_user::text;
    v_desligado := true;
  exception when others then
    v_desligado := false;
  end;
  delete from public.posse where computador_id = p_computador;
  delete from public.atribuicao where computador_id = p_computador;
  update public.comandos set estado = 'expirado' where computador_id = p_computador and estado in ('pendente', 'reservado');
  update public.ligacoes set expira_em = now() where criado_por = p_computador and usado_em is null and expira_em > now();
  perform public.rvz_auditar('revogar_computador', p_computador::text, jsonb_build_object('login_desligado', v_desligado));
  return jsonb_build_object('ok', true, 'login_desligado', v_desligado);
end $$;
