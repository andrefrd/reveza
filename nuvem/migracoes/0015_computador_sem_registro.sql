-- Reveza AI · 0015 · identidade de computador só vira computador se nasceu pelo caminho que o painel enxerga
-- (verificação independente da auditoria, 11/10/2026).
-- reaplicável: só funções (create or replace).
--
-- servico_registrar_computador devolve o id do computador pendente (o painel revoga o código anterior ao criar outro);
-- agente_registrar recusa identidade sem linha em computadores (toda identidade nova nasce com a linha pendente).

create or replace function public.servico_registrar_computador(p_user uuid, p_criado_por uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid;
begin
  if (select papel from public.membros where user_id = p_criado_por) is distinct from 'admin' then
    raise exception 'só administrador';
  end if;
  insert into public.membros (user_id, papel) values (p_user, 'computador');
  insert into public.computadores (user_id, nome, sistema, versao) values (p_user, 'Computador novo', 'pendente', '')
  on conflict (user_id) do nothing
  returning id into v_id;
  insert into public.auditoria (user_id, acao, alvo) values (p_criado_por, 'computador_novo', p_user::text);
  return jsonb_build_object('ok', true, 'computador_id', v_id);
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
  select revogado, sistema, criado_em into v_atual from public.computadores where user_id = auth.uid() for update;
  if not found then raise exception 'acesso sem registro: crie outro no painel' using errcode = '42501'; end if;
  if v_atual.revogado then raise exception 'computador revogado' using errcode = '42501'; end if;
  if v_atual.sistema = 'pendente' and v_atual.criado_em < now() - interval '24 hours' then
    raise exception 'código de acesso vencido: crie outro no painel' using errcode = '42501';
  end if;
  if v_nome = '' then v_nome := 'computador'; end if;
  update public.computadores set nome = v_nome, sistema = p_sistema, versao = left(p_versao, 40), visto_em = now()
   where user_id = auth.uid()
  returning id into v_id;
  return jsonb_build_object('computador_id', v_id);
end $$;
