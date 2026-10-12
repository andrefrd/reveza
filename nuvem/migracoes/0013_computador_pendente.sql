-- Reveza AI · 0013 · computador novo aparece (e pode ser revogado) desde o código de acesso (auditoria, 11/10/2026).
-- reaplicável: restrição recriada, linhas pendentes com "on conflict do nothing" e funções (create or replace).
--
-- Antes, "Criar o acesso" criava a identidade do computador sem linha em computadores: um código perdido e nunca
-- usado não aparecia no painel, não tinha como ser revogado e valia para sempre. Agora a linha nasce "pendente" (visível
-- e revogável), a identidade pendente não age na nuvem até o primeiro registro, e o código vence em 24 horas.

alter table public.computadores drop constraint if exists computadores_sistema_check;
alter table public.computadores add constraint computadores_sistema_check
  check (sistema in ('macos', 'linux', 'windows', 'pendente'));

-- identidades que já existem sem computador (códigos criados e nunca usados)
insert into public.computadores (user_id, nome, sistema, versao)
select m.user_id, 'Computador novo', 'pendente', '' from public.membros m
 where m.papel = 'computador' and not exists (select 1 from public.computadores c where c.user_id = m.user_id)
on conflict (user_id) do nothing;

create or replace function public.rvz_computador() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select c.id from public.computadores c
  join public.membros m on m.user_id = c.user_id and m.papel = 'computador'
  where c.user_id = auth.uid() and not c.revogado and c.sistema <> 'pendente'
$$;

create or replace function public.servico_registrar_computador(p_user uuid, p_criado_por uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if (select papel from public.membros where user_id = p_criado_por) is distinct from 'admin' then
    raise exception 'só administrador';
  end if;
  insert into public.membros (user_id, papel) values (p_user, 'computador');
  -- visível e revogável desde já
  insert into public.computadores (user_id, nome, sistema, versao) values (p_user, 'Computador novo', 'pendente', '')
  on conflict (user_id) do nothing;
  insert into public.auditoria (user_id, acao, alvo) values (p_criado_por, 'computador_novo', p_user::text);
  return jsonb_build_object('ok', true);
end $$;

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
  select revogado, sistema, criado_em into v_atual from public.computadores where user_id = auth.uid();
  if v_atual.revogado then raise exception 'computador revogado' using errcode = '42501'; end if;
  if v_atual.sistema = 'pendente' and v_atual.criado_em < now() - interval '24 hours' then
    raise exception 'código de acesso vencido: crie outro no painel' using errcode = '42501';
  end if;
  if v_nome = '' then v_nome := 'computador'; end if;
  insert into public.computadores (user_id, nome, sistema, versao, visto_em)
  values (auth.uid(), v_nome, p_sistema, left(p_versao, 40), now())
  on conflict (user_id) do update set nome = excluded.nome, sistema = excluded.sistema, versao = excluded.versao,
                                       visto_em = now()
  returning id into v_id;
  return jsonb_build_object('computador_id', v_id);
end $$;

-- Revogar também fecha a ligação que o computador tinha aberto (não sai mais chave embrulhada por ele).
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
  update public.ligacoes set expira_em = now() where criado_por = p_computador and usado_em is null and expira_em > now();
  perform public.rvz_auditar('revogar_computador', p_computador::text, jsonb_build_object('login_desligado', v_desligado));
  return jsonb_build_object('ok', true, 'login_desligado', v_desligado);
end $$;

-- A ligação só vem de computador ativo; e o pacote (chave embrulhada pela frase) não fica guardado depois de usado
-- ou vencido.
create or replace function public.agente_ligacao_buscar() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  v record;
begin
  delete from public.ligacoes where (usado_em is not null and usado_em < now() - interval '1 hour')
                                 or expira_em < now() - interval '1 hour';
  update public.ligacoes set usado_em = now()
   where id = (select l.id from public.ligacoes l join public.computadores c on c.id = l.criado_por and not c.revogado
                where l.usado_em is null and l.expira_em > now() and l.criado_por <> v_pc
                order by l.expira_em desc limit 1)
  returning embrulho, sal into v;
  if v.embrulho is null then return jsonb_build_object('ok', false, 'erro', 'nenhuma ligação aberta'); end if;
  return jsonb_build_object('ok', true, 'embrulho', public.rvz_b64(v.embrulho), 'sal', public.rvz_b64(v.sal));
end $$;
