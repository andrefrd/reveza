-- Reveza AI · 0006 · funções que só as Edge Functions chamam (chave de serviço): convite, computador novo, alertas,
-- reaplicável: só funções e agenda (create or replace); o instalador roda de novo quando o arquivo muda.
-- vigia, resumo do dia e a API pública. Segredos de canal de alerta e de webhook ficam no Vault do Supabase.

-- ------------------------------------------------------------------------------------------- convite
create or replace function public.convite_aceitar(p_user uuid, p_email text, p_token_hash text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v record;
begin
  update public.convites set usado_em = now()
   where token_hash = p_token_hash and email = lower(p_email) and usado_em is null and expira_em > now()
  returning id, papel into v;
  if v.id is null then return jsonb_build_object('ok', false, 'erro', 'convite inválido, usado ou vencido'); end if;
  -- convite nunca rebaixa: quem já é administrador continua administrador
  insert into public.membros (user_id, papel) values (p_user, v.papel)
  on conflict (user_id) do update set papel = case when membros.papel = 'admin' then 'admin'::public.papel else excluded.papel end
  where membros.papel <> 'computador';
  insert into public.auditoria (user_id, acao, alvo) values (p_user, 'convite_aceito', lower(p_email));
  return jsonb_build_object('ok', true, 'papel', v.papel);
end $$;

-- Quem chama a Edge Function: membro? admin com duas etapas? (o token do usuário é conferido na função; aqui o papel)
create or replace function public.servico_papel(p_user uuid) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select papel::text from public.membros where user_id = p_user
$$;

create or replace function public.servico_registrar_computador(p_user uuid, p_criado_por uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select papel from public.membros where user_id = p_criado_por) is distinct from 'admin' then
    raise exception 'só administrador';
  end if;
  insert into public.membros (user_id, papel) values (p_user, 'computador');
  insert into public.auditoria (user_id, acao, alvo) values (p_criado_por, 'computador_novo', p_user::text);
  return jsonb_build_object('ok', true);
end $$;

-- ------------------------------------------------------------------------------------------- segredos de alerta
create or replace function public.painel_alerta_segredo(p_id uuid, p_segredo text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp, vault as $$
declare v_vault uuid;
begin
  perform public.rvz_exigir_admin();
  if length(coalesce(p_segredo, '')) < 6 or length(p_segredo) > 2000 then raise exception 'segredo inválido'; end if;
  select (destino ->> 'vault_id')::uuid into v_vault from public.alertas where id = p_id;
  if not found then raise exception 'alerta desconhecido'; end if;
  if v_vault is null then
    v_vault := vault.create_secret(p_segredo, 'reveza-alerta-' || p_id::text, 'segredo de canal de alerta do Reveza');
    update public.alertas set destino = destino || jsonb_build_object('vault_id', v_vault) where id = p_id;
  else
    perform vault.update_secret(v_vault, p_segredo);
  end if;
  perform public.rvz_auditar('alerta_segredo', p_id::text);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.painel_webhook_segredo(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp, vault as $$
declare
  v_segredo text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_vault uuid;
begin
  perform public.rvz_exigir_admin();
  select segredo_vault_id into v_vault from public.webhooks_saida where id = p_id;
  if not found then raise exception 'webhook desconhecido'; end if;
  if v_vault is null then
    v_vault := vault.create_secret(v_segredo, 'reveza-webhook-' || p_id::text, 'assinatura de webhook do Reveza');
    update public.webhooks_saida set segredo_vault_id = v_vault where id = p_id;
  else
    perform vault.update_secret(v_vault, v_segredo);
  end if;
  perform public.rvz_auditar('webhook_segredo', p_id::text);
  return jsonb_build_object('ok', true, 'segredo', v_segredo);  -- aparece uma vez, para quem recebe conferir a assinatura
end $$;

-- ------------------------------------------------------------------------------------------- vigia e alertas
-- Gera os eventos de alerta que dependem do tempo: computador parado, conta que precisa entrar de novo.
create or replace function public.vigiar() returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare pc record; ct record; n int := 0;
begin
  for pc in select id, nome, visto_em from public.computadores
             where not revogado and visto_em < now() - interval '3 minutes' and visto_em > now() - interval '7 days' loop
    if not exists (select 1 from public.eventos where tipo = 'alerta' and dados ->> 'motivo' = 'computador_parado'
                   and dados ->> 'computador' = pc.id::text and em > now() - interval '6 hours') then
      perform public.rvz_evento('alerta', format('O computador %s não dá notícia desde %s.', pc.nome,
                                to_char(pc.visto_em at time zone coalesce(public.rvz_cfg('fuso', '"America/Sao_Paulo"') #>> '{}', 'UTC'), 'DD/MM HH24:MI')),
                                jsonb_build_object('motivo', 'computador_parado', 'computador', pc.id));
      n := n + 1;
    end if;
  end loop;
  for ct in select id, email from public.contas where precisa_login loop
    if not exists (select 1 from public.eventos where tipo = 'alerta' and dados ->> 'motivo' = 'precisa_login'
                   and dados ->> 'conta' = ct.id::text and em > now() - interval '24 hours') then
      perform public.rvz_evento('alerta', format('%s precisa entrar de novo.', ct.email),
                                jsonb_build_object('motivo', 'precisa_login', 'conta', ct.id));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create or replace function public.resumo_dia() returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  with fuso as (select coalesce(public.rvz_cfg('fuso', '"America/Sao_Paulo"') #>> '{}', 'UTC') f),
  hoje as (select date_trunc('day', now() at time zone (select f from fuso)) at time zone (select f from fuso) ini)
  select jsonb_build_object(
    'usd', coalesce((select round(sum(usd), 2) from public.uso_tokens where hora >= (select ini from hoje)), 0),
    'tokens', coalesce((select sum(entrada + saida + cache_escrita + cache_leitura) from public.uso_tokens where hora >= (select ini from hoje)), 0),
    'trocas', (select count(*) from public.eventos where tipo = 'troca' and em >= (select ini from hoje)),
    'agentes', coalesce((select sum(agentes) from public.sessoes where inicio >= (select ini from hoje)), 0),
    'contas', (select coalesce(jsonb_agg(jsonb_build_object('email', c.email, 'pct', public.rvz_pct_efetivo(c.id)) order by c.email), '[]')
                 from public.contas c))
$$;

-- Eventos de alerta ainda não enviados, com os canais que querem cada um. Marca como enviados até o id lido.
create or replace function public.alertas_pendentes(p_limite integer default 50) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ate bigint := coalesce((public.rvz_cfg('alertas_ate', '0') #>> '{}')::bigint, 0);
  v_eventos jsonb;
  v_canais jsonb;
  v_max bigint;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'em', em, 'tipo', tipo, 'texto', texto, 'dados', dados) order by id), '[]'),
         max(id)
    into v_eventos, v_max
    from (select * from public.eventos where id > v_ate and tipo in ('alerta', 'troca', 'limite') order by id limit p_limite) e;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'canal', canal, 'destino', destino - 'vault_id',
                                               'tem_segredo', destino ? 'vault_id', 'eventos', eventos)), '[]')
    into v_canais from public.alertas where ativo;
  if v_max is not null then
    insert into public.config (chave, valor) values ('alertas_ate', to_jsonb(v_max))
    on conflict (chave) do update set valor = excluded.valor, mudado_em = now();
  end if;
  return jsonb_build_object('eventos', v_eventos, 'canais', v_canais,
    'webhooks', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'url', url, 'eventos', eventos)), '[]')
                   from public.webhooks_saida where ativo and segredo_vault_id is not null));
end $$;

create or replace function public.servico_segredo_alerta(p_alerta uuid) returns text
language sql stable security definer set search_path = public, pg_temp, vault as $$
  select s.decrypted_secret from vault.decrypted_secrets s
   where s.id = (select (destino ->> 'vault_id')::uuid from public.alertas where id = p_alerta)
$$;

create or replace function public.servico_segredo_webhook(p_webhook uuid) returns text
language sql stable security definer set search_path = public, pg_temp, vault as $$
  select s.decrypted_secret from vault.decrypted_secrets s
   where s.id = (select segredo_vault_id from public.webhooks_saida where id = p_webhook)
$$;

-- ------------------------------------------------------------------------------------------- API pública
-- A Edge Function `api` confere a chave (api_conferir_chave) e chama estas com o dono da chave e os escopos dela.
create or replace function public.api_estado(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if coalesce((select papel::text from public.membros where user_id = p_user), '') not in ('admin', 'leitura') then
    raise exception 'sem acesso';
  end if;
  return jsonb_build_object(
    'config', (select jsonb_object_agg(chave, valor) from public.config where chave not in ('alertas_ate')),
    'computadores', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'nome', c.nome, 'visto_em', c.visto_em,
                       'conta', (select co.email from public.atribuicao a join public.contas co on co.id = a.conta_id where a.computador_id = c.id))), '[]')
                       from public.computadores c where not c.revogado),
    'contas', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'email', c.email, 'pausada', c.pausada,
                 'pct', public.rvz_pct_efetivo(c.id),
                 'janelas', (select coalesce(jsonb_agg(jsonb_build_object('tipo', j.tipo, 'pct', j.pct, 'reset_em', j.reset_em)), '[]')
                               from public.uso_janelas j where j.conta_id = c.id)) order by c.email), '[]')
               from public.contas c),
    'resumo_dia', public.resumo_dia());
end $$;

create or replace function public.api_trocar(p_user uuid, p_computador uuid, p_conta uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select papel from public.membros where user_id = p_user) is distinct from 'admin' then raise exception 'sem acesso'; end if;
  if not exists (select 1 from public.computadores where id = p_computador and not revogado) then
    return jsonb_build_object('ok', false, 'erro', 'computador desconhecido');
  end if;
  if exists (select 1 from public.contas where id = p_conta and (pausada or precisa_login)) then
    return jsonb_build_object('ok', false, 'erro', 'conta pausada ou sem login');
  end if;
  if exists (select 1 from public.atribuicao where conta_id = p_conta and computador_id <> p_computador) then
    return jsonb_build_object('ok', false, 'erro', 'a conta está em uso em outro computador');
  end if;
  if not exists (select 1 from public.cofre where conta_id = p_conta) then
    return jsonb_build_object('ok', false, 'erro', 'conta sem login guardado');
  end if;
  perform public.rvz_atribuir(p_computador, p_conta, 'pedido pela API');
  insert into public.auditoria (user_id, acao, alvo, detalhes) values (p_user, 'api_trocar', p_conta::text, jsonb_build_object('computador', p_computador));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.api_config(p_user uuid, p_chave text, p_valor jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select papel from public.membros where user_id = p_user) is distinct from 'admin' then raise exception 'sem acesso'; end if;
  if coalesce(p_chave, '') not in ('auto', 'modo') then raise exception 'pela API só se muda auto e modo'; end if;
  if p_chave = 'auto' and jsonb_typeof(p_valor) <> 'boolean' then raise exception 'precisa ser verdadeiro ou falso'; end if;
  if p_chave = 'modo' and coalesce(p_valor #>> '{}', '') not in ('limite', 'limiar', 'rodizio') then raise exception 'modo desconhecido'; end if;
  insert into public.config (chave, valor, mudado_por, mudado_em) values (p_chave, p_valor, p_user, now())
  on conflict (chave) do update set valor = excluded.valor, mudado_por = excluded.mudado_por, mudado_em = now();
  insert into public.auditoria (user_id, acao, alvo, detalhes) values (p_user, 'api_config', p_chave, jsonb_build_object('valor', p_valor));
  return jsonb_build_object('ok', true);
end $$;
