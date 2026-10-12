-- Reveza AI · 0011 · endurecimentos da auditoria de segurança (rodada 1, 11/10/2026), notas dos caçadores.
-- reaplicável: gatilho recriado e funções (create or replace).
--
-- 1. Código de login colado no painel não fica legível para quem só lê: some do comando também quando ele vence
--    ou é cancelado (antes, só quando o computador reservava).
-- 2. "Trocar agora" pelo painel recusa conta pausada ou que precisa entrar de novo (a API já recusava).
-- 3. Chave de API de administrador sem verificação em duas etapas deixa de trocar e mudar configuração quando a
--    instalação passa a exigir as duas etapas.

create or replace function public.rvz_comando_sem_codigo() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  -- ao reservar, o próprio agente_reservar_comando entrega o código ao computador e depois apaga
  if new.estado not in ('pendente', 'reservado') and new.corpo ? 'codigo' then new.corpo := new.corpo - 'codigo'; end if;
  return new;
end $$;
drop trigger if exists comandos_sem_codigo on public.comandos;
create trigger comandos_sem_codigo before update of estado on public.comandos
  for each row execute function public.rvz_comando_sem_codigo();
-- e os que já venceram com código dentro
update public.comandos set corpo = corpo - 'codigo' where estado not in ('pendente', 'reservado') and corpo ? 'codigo';

create or replace function public.painel_trocar_agora(p_computador uuid, p_conta uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.rvz_exigir_admin();
  if not exists (select 1 from public.computadores where id = p_computador and not revogado) then
    raise exception 'computador desconhecido';
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
  perform public.rvz_atribuir(p_computador, p_conta, 'pedido pelo painel');
  perform public.rvz_auditar('trocar', p_conta::text, jsonb_build_object('computador', p_computador));
  return jsonb_build_object('ok', true);
end $$;

-- Administrador pela API: com a instalação exigindo duas etapas, só quem tem o fator verificado.
create or replace function public.rvz_admin_api(p_user uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select (select papel from public.membros where user_id = p_user) is not distinct from 'admin'
     and (not public.rvz_exige_duas_etapas() or public.rvz_tem_duas_etapas(p_user))
$$;

create or replace function public.api_trocar(p_user uuid, p_computador uuid, p_conta uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.rvz_admin_api(p_user) then raise exception 'sem acesso'; end if;
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
  if not public.rvz_admin_api(p_user) then raise exception 'sem acesso'; end if;
  if coalesce(p_chave, '') not in ('auto', 'modo') then raise exception 'pela API só se muda auto e modo'; end if;
  if p_chave = 'auto' and jsonb_typeof(p_valor) <> 'boolean' then raise exception 'precisa ser verdadeiro ou falso'; end if;
  if p_chave = 'modo' and coalesce(p_valor #>> '{}', '') not in ('limite', 'limiar', 'rodizio') then raise exception 'modo desconhecido'; end if;
  insert into public.config (chave, valor, mudado_por, mudado_em) values (p_chave, p_valor, p_user, now())
  on conflict (chave) do update set valor = excluded.valor, mudado_por = excluded.mudado_por, mudado_em = now();
  insert into public.auditoria (user_id, acao, alvo, detalhes) values (p_user, 'api_config', p_chave, jsonb_build_object('valor', p_valor));
  return jsonb_build_object('ok', true);
end $$;
