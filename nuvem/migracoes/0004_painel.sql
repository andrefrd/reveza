-- Reveza AI · 0004 · funções que o painel chama (admin com verificação em duas etapas), chaves de API e agenda.
-- reaplicável: só funções e agenda (create or replace); o instalador roda de novo quando o arquivo muda.

-- Endereço que a nuvem vai chamar (webhook, servidor do ntfy): https, nome público, sem porta estranha e sem IP
-- escrito (a forma mais curta de apontar para dentro da rede: 127.0.0.1, 169.254.169.254, 0x7f.1...).
create or replace function public.rvz_url_externa(p_url text) returns boolean
language plpgsql immutable set search_path = public, pg_temp as $$
declare v_host text;
begin
  if p_url is null or length(p_url) > 500 or p_url !~ '^https://[^/\s?#@]+(/\S*)?$' then return false; end if;
  v_host := lower(substring(p_url from '^https://([^/?#]+)'));
  if v_host ~ ':' then
    if v_host !~ '^[^:\[\]]+:443$' then return false; end if;
    v_host := regexp_replace(v_host, ':443$', '');
  end if;
  if v_host !~ '\.' or v_host ~ '\.$' then return false; end if;
  if v_host ~ '^(0x[0-9a-f]+|[0-9]+)(\.(0x[0-9a-f]+|[0-9]+))*$' then return false; end if;
  if v_host ~ '(^|\.)(localhost|local|internal|lan|home|arpa|corp|intranet)$' then return false; end if;
  return true;
end $$;

-- Destino de alerta conferido por canal; só as chaves do canal passam (o vault_id nunca vem de fora).
create or replace function public.rvz_destino_alerta(p_canal text, p_destino jsonb) returns jsonb
language plpgsql immutable set search_path = public, pg_temp as $$
declare d jsonb := coalesce(p_destino, '{}');
begin
  if jsonb_typeof(d) <> 'object' then raise exception 'destino inválido'; end if;
  case p_canal
    when 'telegram' then
      if coalesce(d ->> 'chat_id', '') !~ '^(-?[0-9]{1,20}|@[A-Za-z0-9_]{5,32})$' then raise exception 'chat do Telegram inválido'; end if;
      return jsonb_build_object('chat_id', d ->> 'chat_id');
    when 'ntfy' then
      if not public.rvz_url_externa(coalesce(d ->> 'servidor', 'https://ntfy.sh')) then raise exception 'servidor do ntfy precisa ser https e público'; end if;
      return jsonb_build_object('servidor', coalesce(d ->> 'servidor', 'https://ntfy.sh'));
    when 'email' then
      if coalesce(d ->> 'de', '') !~ '^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$' or coalesce(d ->> 'para', '') !~ '^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$' then
        raise exception 'e-mail inválido';
      end if;
      return jsonb_build_object('de', d ->> 'de', 'para', d ->> 'para');
    when 'webhook' then
      if not public.rvz_url_externa(d ->> 'url') then raise exception 'o endereço precisa ser https e público'; end if;
      return jsonb_build_object('url', d ->> 'url');
    when 'push' then
      return '{}'::jsonb;
    else
      raise exception 'canal desconhecido';
  end case;
end $$;

-- Agenda de uma conta: lista de {"dias":[1..7], "de":"HH:MM", "ate":"HH:MM"} (1 = segunda).
create or replace function public.rvz_agenda_valida(p jsonb) returns boolean
language plpgsql immutable set search_path = public, pg_temp as $$
declare item jsonb; d jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'array' or jsonb_array_length(p) > 50 then return false; end if;
  for item in select * from jsonb_array_elements(p) loop
    if jsonb_typeof(item) <> 'object' or jsonb_typeof(item -> 'dias') <> 'array' or jsonb_array_length(item -> 'dias') = 0 then
      return false;
    end if;
    for d in select * from jsonb_array_elements(item -> 'dias') loop
      if (d #>> '{}') !~ '^[1-7]$' then return false; end if;
    end loop;
    if coalesce(item ->> 'de', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or coalesce(item ->> 'ate', '') !~ '^(([01][0-9]|2[0-3]):[0-5][0-9]|24:00)$'
       or (item ->> 'de') >= (item ->> 'ate') then
      return false;
    end if;
  end loop;
  return true;
end $$;

create or replace function public.painel_config(p_chave text, p_valor jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_aviso numeric; v_troca numeric;
begin
  perform public.rvz_exigir_admin();
  case p_chave
    when 'auto', 'retomar_terminal' then
      if jsonb_typeof(p_valor) <> 'boolean' then raise exception 'precisa ser verdadeiro ou falso'; end if;
    when 'exigir_duas_etapas' then
      if jsonb_typeof(p_valor) <> 'boolean' then raise exception 'precisa ser verdadeiro ou falso'; end if;
      -- exigir sem ter as próprias duas etapas trancaria quem ligou do lado de fora
      if (p_valor #>> '{}')::boolean and not public.rvz_tem_duas_etapas(auth.uid()) then
        raise exception 'ative as suas duas etapas antes de exigir dos administradores';
      end if;
    when 'modo' then
      if coalesce(p_valor #>> '{}', '') not in ('limite', 'limiar', 'rodizio') then raise exception 'modo desconhecido'; end if;
    when 'aviso', 'troca' then
      if jsonb_typeof(p_valor) <> 'number' or (p_valor #>> '{}')::numeric not between 1 and 100 then
        raise exception 'limiar entre 1 e 100';
      end if;
      v_aviso := case when p_chave = 'aviso' then (p_valor #>> '{}')::numeric else (public.rvz_cfg('aviso', '90') #>> '{}')::numeric end;
      v_troca := case when p_chave = 'troca' then (p_valor #>> '{}')::numeric else (public.rvz_cfg('troca', '95') #>> '{}')::numeric end;
      if v_aviso >= v_troca then raise exception 'o aviso precisa ser menor que a troca'; end if;
    when 'rodizio_minutos' then
      if jsonb_typeof(p_valor) <> 'number' or (p_valor #>> '{}')::numeric not between 15 and 480 then
        raise exception 'rodízio de 15 a 480 minutos';
      end if;
    when 'rodizio_ordem' then
      if coalesce(p_valor #>> '{}', '') not in ('aleatoria', 'menor_uso') then raise exception 'ordem desconhecida'; end if;
    when 'intervalo_s' then
      -- o tempo de atualização que a pessoa escolhe no painel
      if jsonb_typeof(p_valor) <> 'number' or (p_valor #>> '{}')::numeric not in (5, 10, 15, 30) then
        raise exception 'tempo de atualização: 5, 10, 15 ou 30 segundos';
      end if;
    when 'espera_entre_trocas_s' then
      if jsonb_typeof(p_valor) <> 'number' or (p_valor #>> '{}')::numeric not between 30 and 3600 then
        raise exception 'espera de 30 a 3600 segundos';
      end if;
    when 'fuso' then
      if not exists (select 1 from pg_timezone_names where name = p_valor #>> '{}') then raise exception 'fuso desconhecido'; end if;
    else
      raise exception 'configuração desconhecida';
  end case;
  insert into public.config (chave, valor, mudado_por, mudado_em) values (p_chave, p_valor, auth.uid(), now())
  on conflict (chave) do update set valor = excluded.valor, mudado_por = excluded.mudado_por, mudado_em = now();
  if p_chave in ('modo', 'rodizio_minutos') then delete from public.config where chave = 'proximo_rodizio_em'; end if;
  perform public.rvz_auditar('config', p_chave, jsonb_build_object('valor', p_valor));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.painel_conta(p_conta uuid, p_campos jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare k text;
begin
  perform public.rvz_exigir_admin();
  for k in select jsonb_object_keys(p_campos) loop
    if k not in ('cor', 'prioridade', 'reserva', 'pausada', 'agenda', 'teto_semana') then
      raise exception 'campo não permitido: %', k;
    end if;
  end loop;
  if p_campos ? 'agenda' and not public.rvz_agenda_valida(p_campos -> 'agenda') then
    raise exception 'agenda inválida: lista de {"dias":[1..7], "de":"HH:MM", "ate":"HH:MM"}';
  end if;
  update public.contas set
    cor = coalesce((p_campos ->> 'cor')::smallint, cor),
    prioridade = coalesce((p_campos ->> 'prioridade')::smallint, prioridade),
    reserva = coalesce((p_campos ->> 'reserva')::boolean, reserva),
    pausada = coalesce((p_campos ->> 'pausada')::boolean, pausada),
    agenda = coalesce(p_campos -> 'agenda', agenda),
    teto_semana = case when p_campos ? 'teto_semana' then (p_campos ->> 'teto_semana')::numeric else teto_semana end
  where id = p_conta;
  if not found then raise exception 'conta desconhecida'; end if;
  perform public.rvz_auditar('conta', p_conta::text, p_campos);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.painel_trocar_agora(p_computador uuid, p_conta uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.rvz_exigir_admin();
  if not exists (select 1 from public.computadores where id = p_computador and not revogado) then
    raise exception 'computador desconhecido';
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

create or replace function public.painel_comando(p_computador uuid, p_acao text, p_corpo jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint;
begin
  perform public.rvz_exigir_admin();
  if p_acao in ('conectar', 'entrar_de_novo') and coalesce(p_corpo ->> 'email', '') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'e-mail inválido';
  end if;
  -- ligar: só a chave pública efêmera do navegador (P-256) e o idioma da frase
  if p_acao = 'ligar' and not (
       jsonb_typeof(p_corpo -> 'publica') = 'object'
       and p_corpo #>> '{publica,kty}' = 'EC' and p_corpo #>> '{publica,crv}' = 'P-256'
       and coalesce(p_corpo #>> '{publica,x}', '') ~ '^[A-Za-z0-9_-]{40,50}$'
       and coalesce(p_corpo #>> '{publica,y}', '') ~ '^[A-Za-z0-9_-]{40,50}$'
       and coalesce(p_corpo ->> 'idioma', 'pt-BR') in ('pt-BR', 'en')) then
    raise exception 'pedido de ligação inválido';
  end if;
  insert into public.comandos (criado_por, computador_id, acao, corpo)
  values (auth.uid(), p_computador, p_acao, coalesce(p_corpo, '{}')) returning id into v_id;
  perform public.rvz_auditar('comando', p_acao, jsonb_build_object('computador', p_computador, 'id', v_id));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- Convite: guarda só o resumo do token; o token vai no e-mail (Edge Function convite).
create or replace function public.painel_convidar(p_email text, p_papel public.papel, p_token_hash text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform public.rvz_exigir_admin();
  if p_papel = 'computador' then raise exception 'computador não se convida'; end if;
  -- convite novo para o mesmo e-mail cancela os que ainda estavam abertos
  update public.convites set expira_em = now() where email = lower(p_email) and usado_em is null and expira_em > now();
  insert into public.convites (email, papel, token_hash, criado_por) values (lower(p_email), p_papel, p_token_hash, auth.uid())
  returning id into v_id;
  perform public.rvz_auditar('convidar', lower(p_email), jsonb_build_object('papel', p_papel));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.painel_mudar_papel(p_user uuid, p_papel public.papel) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.rvz_exigir_admin();
  if p_papel = 'computador' or (select papel from public.membros where user_id = p_user) = 'computador' then
    raise exception 'papel de computador não se muda aqui';
  end if;
  if p_user = auth.uid() and p_papel <> 'admin'
     and (select count(*) from public.membros where papel = 'admin') <= 1 then
    raise exception 'o último administrador não pode deixar de ser administrador';
  end if;
  update public.membros set papel = p_papel where user_id = p_user;
  if not found then return jsonb_build_object('ok', false, 'erro', 'membro desconhecido'); end if;
  perform public.rvz_auditar('papel', p_user::text, jsonb_build_object('papel', p_papel));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.painel_revogar_membro(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.rvz_exigir_admin();
  if p_user = auth.uid() then raise exception 'não dá para revogar a si mesmo'; end if;
  delete from public.membros where user_id = p_user and papel <> 'computador';
  if not found then return jsonb_build_object('ok', false, 'erro', 'membro desconhecido'); end if;
  perform public.rvz_auditar('revogar_membro', p_user::text);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.painel_revogar_computador(p_computador uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_user uuid; v_desligado boolean;
begin
  perform public.rvz_exigir_admin();
  update public.computadores set revogado = true where id = p_computador returning user_id into v_user;
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
  perform public.rvz_auditar('revogar_computador', p_computador::text, jsonb_build_object('login_desligado', v_desligado));
  return jsonb_build_object('ok', true, 'login_desligado', v_desligado);
end $$;

create or replace function public.painel_alerta(p_canal text, p_destino jsonb, p_eventos text[], p_ativo boolean default true,
                                     p_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; v_destino jsonb;
begin
  perform public.rvz_exigir_admin();
  v_destino := public.rvz_destino_alerta(p_canal, p_destino);
  if p_id is null then
    insert into public.alertas (canal, destino, eventos, ativo, criado_por)
    values (p_canal, v_destino, p_eventos, p_ativo, auth.uid()) returning id into v_id;
  else
    -- o segredo guardado (vault_id) só a própria função põe; trocar o canal apaga o segredo antigo
    update public.alertas
       set destino = v_destino || case when canal = p_canal and destino ? 'vault_id'
                                       then jsonb_build_object('vault_id', destino -> 'vault_id') else '{}'::jsonb end,
           canal = p_canal, eventos = p_eventos, ativo = p_ativo
     where id = p_id returning id into v_id;
  end if;
  if v_id is null then return jsonb_build_object('ok', false, 'erro', 'alerta desconhecido'); end if;
  perform public.rvz_auditar('alerta', v_id::text, jsonb_build_object('canal', p_canal));
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function public.painel_alerta_apagar(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.rvz_exigir_admin();
  delete from public.alertas where id = p_id;
  if not found then return jsonb_build_object('ok', false, 'erro', 'alerta desconhecido'); end if;
  perform public.rvz_auditar('alerta_apagar', p_id::text);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.painel_webhook(p_url text, p_eventos text[], p_ativo boolean default true, p_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  perform public.rvz_exigir_admin();
  if not public.rvz_url_externa(p_url) then raise exception 'o endereço precisa ser https e público'; end if;
  if p_id is null then
    insert into public.webhooks_saida (url, eventos, ativo, criado_por) values (p_url, p_eventos, p_ativo, auth.uid())
    returning id into v_id;
  else
    update public.webhooks_saida set url = p_url, eventos = p_eventos, ativo = p_ativo where id = p_id returning id into v_id;
  end if;
  perform public.rvz_auditar('webhook', v_id::text, jsonb_build_object('url', p_url));
  return jsonb_build_object('ok', v_id is not null, 'id', v_id);
end $$;

create or replace function public.painel_convite_cancelar(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.rvz_exigir_admin();
  update public.convites set expira_em = now() where id = p_id and usado_em is null and expira_em > now();
  if not found then return jsonb_build_object('ok', false, 'erro', 'convite desconhecido, usado ou vencido'); end if;
  perform public.rvz_auditar('convite_cancelar', p_id::text);
  return jsonb_build_object('ok', true);
end $$;

-- Chave de API pessoal: a chave inteira aparece UMA vez; fica guardado só o resumo SHA-256.
create or replace function public.painel_chave_api_criar(p_nome text, p_escopos text[]) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prefixo text := 'rvz_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
  v_segredo text := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  v_id uuid;
begin
  if not public.rvz_eh_membro() then raise exception 'só membro' using errcode = '42501'; end if;
  if not public.rvz_aal2() then raise exception 'confirme a verificação em duas etapas' using errcode = '42501'; end if;
  if ('trocar' = any(p_escopos) or 'config' = any(p_escopos)) and not public.rvz_eh_admin() then
    raise exception 'escopo só para administrador' using errcode = '42501';
  end if;
  insert into public.chaves_api (user_id, nome, prefixo, hash, escopos)
  values (auth.uid(), left(p_nome, 80), v_prefixo, encode(sha256(convert_to(v_prefixo || '_' || v_segredo, 'UTF8')), 'hex'),
          p_escopos)
  returning id into v_id;
  perform public.rvz_auditar('chave_api_criar', v_id::text, jsonb_build_object('escopos', p_escopos));
  return jsonb_build_object('ok', true, 'id', v_id, 'chave', v_prefixo || '_' || v_segredo);
end $$;

create or replace function public.painel_chave_api_revogar(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_dono uuid;
begin
  if not public.rvz_eh_membro() then raise exception 'só membro' using errcode = '42501'; end if;
  select user_id into v_dono from public.chaves_api where id = p_id;
  if v_dono is null then return jsonb_build_object('ok', false, 'erro', 'chave desconhecida'); end if;
  if v_dono <> auth.uid() then perform public.rvz_exigir_admin(); end if;
  update public.chaves_api set revogada = true where id = p_id;
  perform public.rvz_auditar('chave_api_revogar', p_id::text);
  return jsonb_build_object('ok', true);
end $$;

-- Usada SÓ pela Edge Function da API pública (chave de serviço): confere uma chave e devolve dono e escopos.
create or replace function public.api_conferir_chave(p_chave text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v record;
begin
  update public.chaves_api set usada_em = now()
   where hash = encode(sha256(convert_to(p_chave, 'UTF8')), 'hex') and not revogada
     and exists (select 1 from public.membros m where m.user_id = chaves_api.user_id and m.papel in ('admin', 'leitura'))
  returning user_id, escopos into v;
  if v.user_id is null then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'user_id', v.user_id, 'escopos', v.escopos);
end $$;

create or replace function public.painel_meu_idioma(p_idioma text) returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  update public.membros set idioma = p_idioma where user_id = auth.uid() and p_idioma in ('pt-BR', 'en');
  select jsonb_build_object('ok', true);
$$;

create or replace function public.painel_push_inscrever(p_endpoint text, p_p256dh text, p_auth text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.rvz_eh_membro() then raise exception 'só membro' using errcode = '42501'; end if;
  -- só os serviços de push dos navegadores (o alerta chama este endereço)
  if p_endpoint !~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.push\.apple\.com|web\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/' then
    raise exception 'endereço de push desconhecido';
  end if;
  insert into public.push_inscricoes (user_id, endpoint, p256dh, auth) values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth
  where push_inscricoes.user_id = excluded.user_id;
  if not found then return jsonb_build_object('ok', false, 'erro', 'inscrição de outra pessoa'); end if;
  return jsonb_build_object('ok', true);
end $$;
