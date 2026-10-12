-- Reveza AI · 0008 · o que o painel pedia e o banco ainda não tinha: ligar computador novo pelo painel (comando
-- "ligar"), sessões abertas de quem está logado, e-mail dos membros para o administrador e validade dos logins.
-- reaplicável: restrição recriada e funções (create or replace); o instalador roda de novo quando o arquivo muda.

alter table public.comandos drop constraint if exists comandos_acao_check;
alter table public.comandos add constraint comandos_acao_check check (acao in ('conectar', 'entrar_de_novo',
  'cancelar_login', 'codigo_login', 'atualizar', 'diagnostico', 'retomar_sessao', 'ligar'));

-- Sessões abertas de quem está logado (o próprio Auth guarda; aqui só a leitura das suas e o encerrar uma delas).
create or replace function public.painel_minhas_sessoes() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_atual text := auth.jwt() ->> 'session_id';
begin
  if not public.rvz_eh_membro() then raise exception 'só membro' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'criada_em', s.created_at,
            'ultima_vez', coalesce(s.refreshed_at, s.updated_at, s.created_at), 'aparelho', left(coalesce(s.user_agent, ''), 300),
            'atual', s.id::text = v_atual) order by coalesce(s.refreshed_at, s.updated_at, s.created_at) desc)
          from auth.sessions s where s.user_id = auth.uid()), '[]'::jsonb);
end $$;

create or replace function public.painel_encerrar_sessao(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.rvz_eh_membro() then raise exception 'só membro' using errcode = '42501'; end if;
  delete from auth.sessions where id = p_id and user_id = auth.uid();
  if not found then return jsonb_build_object('ok', false, 'erro', 'sessão desconhecida'); end if;
  perform public.rvz_auditar('sessao_encerrar', p_id::text);
  return jsonb_build_object('ok', true);
end $$;

-- Membros com e-mail, para o administrador (com duas etapas) reconhecer quem é quem no Time.
create or replace function public.painel_membros() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public.rvz_exigir_admin();
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'papel', m.papel, 'nome', m.nome,
            'email', u.email, 'criado_em', m.criado_em) order by m.criado_em)
          from public.membros m join auth.users u on u.id = m.user_id where m.papel <> 'computador'), '[]'::jsonb);
end $$;

-- Até quando vale o login guardado de cada conta (só a data; o login em si continua cifrado e fora do alcance).
create or replace function public.painel_validade_logins() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.rvz_eh_membro() then raise exception 'só membro' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('conta_id', conta_id, 'expira_em', expira_em, 'versao', versao))
          from public.cofre), '[]'::jsonb);
end $$;

-- Para a Edge Function de alertas testar um webhook de saída (o administrador aperta "testar" no painel).
create or replace function public.servico_webhook(p_id uuid) returns jsonb
language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('id', id, 'url', url, 'ativo', ativo, 'tem_segredo', segredo_vault_id is not null)
    from public.webhooks_saida where id = p_id
$$;
