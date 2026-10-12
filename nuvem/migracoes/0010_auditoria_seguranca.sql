-- Reveza AI · 0010 · correções da auditoria de segurança (skill security-audit da Cloudflare, rodada 1, 11/10/2026).
-- reaplicável: coluna com "if not exists", restrição recriada e funções (create or replace).
--
-- 1. Evento escrito por computador não sai pelos canais de alerta nem pelos webhooks assinados: cada evento guarda a
--    origem (nuvem ou computador), gravada aqui dentro e nunca vinda de quem chama; o envio só pega os da nuvem.
-- 2. Endereço de webhook/ntfy: o servidor só aceita letras, números, ponto e hífen (nada de %2e, ponto ideográfico
--    ou outro truque que o fetch transforma em 127.0.0.1).
-- 3. Posse: duas buscas ao mesmo tempo não pegam a mesma conta; marcar login e histórico só com posse viva; a
--    primeira atribuição respeita a posse de outro computador e a mesma trava do rvz_atribuir.
-- 4. Membro revogado: as chaves de API dele ficam revogadas e o celular dele para de receber aviso.
-- 5. Nome do computador (vai no texto de alerta): só letras, números, espaço e - _ ( ).

alter table public.eventos add column if not exists origem text not null default 'nuvem';
alter table public.eventos drop constraint if exists eventos_origem_check;
alter table public.eventos add constraint eventos_origem_check check (origem in ('nuvem', 'computador'));

create or replace function public.agente_evento(p_tipo text, p_texto text, p_dados jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pc uuid := public.rvz_exigir_computador();
begin
  -- 'alerta' é só da nuvem; e o que um computador escreve fica com origem 'computador', que o envio não pega
  if coalesce(p_tipo, '') not in ('troca', 'aviso', 'limite', 'retomada', 'conexao', 'erro', 'info') then
    raise exception 'tipo inválido';
  end if;
  if jsonb_typeof(coalesce(p_dados, '{}')) <> 'object' then raise exception 'dados inválidos'; end if;
  insert into public.eventos (tipo, texto, dados, origem)
  values (p_tipo, left(coalesce(p_texto, ''), 300), coalesce(p_dados, '{}') || jsonb_build_object('computador', v_pc),
          'computador');
  return jsonb_build_object('ok', true);
end $$;

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
    from (select * from public.eventos
           where id > v_ate and origem = 'nuvem' and tipo in ('alerta', 'troca', 'limite')
           order by id limit p_limite) e;
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
  -- só o que o navegador e o fetch leem igual: nada de %, unicode ou outro caractere que vira ponto depois
  if v_host !~ '^[a-z0-9.-]+$' then return false; end if;
  if v_host !~ '\.' or v_host ~ '\.$' or v_host ~ '^\.' or v_host ~ '\.\.' then return false; end if;
  if v_host ~ '^(0x[0-9a-f]+|[0-9]+)(\.(0x[0-9a-f]+|[0-9]+))*$' then return false; end if;
  if v_host ~ '(^|\.)(localhost|local|internal|lan|home|arpa|corp|intranet)$' then return false; end if;
  return true;
end $$;

create or replace function public.agente_registrar(p_nome text, p_sistema text, p_versao text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_nome text := btrim(regexp_replace(regexp_replace(left(coalesce(p_nome, ''), 80), '[^[:alnum:] _()-]+', ' ', 'g'), '\s+', ' ', 'g'));
begin
  if (select m.papel from public.membros m where m.user_id = auth.uid()) is distinct from 'computador' then
    raise exception 'só identidade de computador' using errcode = '42501';
  end if;
  if v_nome = '' then v_nome := 'computador'; end if;
  insert into public.computadores (user_id, nome, sistema, versao, visto_em)
  values (auth.uid(), v_nome, p_sistema, left(p_versao, 40), now())
  on conflict (user_id) do update set nome = excluded.nome, sistema = excluded.sistema, versao = excluded.versao,
                                       visto_em = now()
  returning id into v_id;
  if (select revogado from public.computadores where id = v_id) then
    raise exception 'computador revogado' using errcode = '42501';
  end if;
  return jsonb_build_object('computador_id', v_id);
end $$;

create or replace function public.agente_ola(p_versao text, p_diagnostico jsonb default null, p_conta_local text default null)
returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  v_local uuid;
  v_atr record;
  v_cfg jsonb;
  v_cmds jsonb;
begin
  update public.computadores
     set visto_em = now(), versao = left(p_versao, 40), diagnostico = coalesce(p_diagnostico, diagnostico)
   where id = v_pc;
  -- Renova só a posse de uso da conta atribuída; a de uma conta que saiu vence sozinha.
  update public.posse set expira_em = now() + interval '2 minutes'
   where computador_id = v_pc and motivo = 'uso'
     and conta_id = (select conta_id from public.atribuicao where computador_id = v_pc);
  -- Primeira vez: a conta que já está no computador vira a atribuição dele (se ninguém mais a usa nem a tem em mãos),
  -- com a mesma trava do rvz_atribuir.
  if not exists (select 1 from public.atribuicao where computador_id = v_pc) and p_conta_local is not null then
    perform pg_advisory_xact_lock(778801);
    select id into v_local from public.contas where email = lower(p_conta_local) and not pausada and not precisa_login;
    if v_local is not null
       and not exists (select 1 from public.atribuicao where conta_id = v_local)
       and not exists (select 1 from public.atribuicao where computador_id = v_pc)
       and not exists (select 1 from public.posse where conta_id = v_local and computador_id <> v_pc and expira_em > now()) then
      insert into public.atribuicao (computador_id, conta_id, motivo) values (v_pc, v_local, 'conta que já estava no computador');
    end if;
  end if;
  update public.comandos set estado = 'expirado'
   where computador_id = v_pc and estado = 'pendente' and criado_em < now() - interval '2 minutes';
  select a.conta_id, a.versao, a.motivo, c.email into v_atr
    from public.atribuicao a left join public.contas c on c.id = a.conta_id where a.computador_id = v_pc;
  select jsonb_object_agg(chave, valor) into v_cfg from public.config;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'acao', acao, 'corpo', corpo, 'criado_em', criado_em) order by id), '[]')
    into v_cmds
    from (select id, acao, corpo, criado_em from public.comandos
           where computador_id = v_pc and estado = 'pendente' order by id limit 10) q;
  return jsonb_build_object(
    'computador_id', v_pc,
    'atribuicao', case when v_atr.conta_id is null then null else
      jsonb_build_object('conta_id', v_atr.conta_id, 'email', v_atr.email, 'versao', v_atr.versao, 'motivo', v_atr.motivo) end,
    'config', v_cfg,
    'comandos', v_cmds,
    'ligacao_pendente', exists (select 1 from public.ligacoes where usado_em is null and expira_em > now()));
end $$;

create or replace function public.agente_pegar_posse(p_conta uuid, p_motivo text, p_segundos integer default 120) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  v_dono uuid;
  v_cofre record;
begin
  if coalesce(p_motivo, '') not in ('uso', 'leitura', 'renovacao', 'login') then raise exception 'motivo inválido'; end if;
  -- trava a conta: dois computadores pedindo ao mesmo tempo esperam um pelo outro (sem posse viva, o "for update" da
  -- posse não trava nada)
  perform 1 from public.contas where id = p_conta for update;
  if p_motivo = 'uso' and not exists (select 1 from public.atribuicao where computador_id = v_pc and conta_id = p_conta) then
    return jsonb_build_object('ok', false, 'erro', 'a nuvem não atribuiu esta conta a este computador');
  end if;
  if p_motivo <> 'uso' and exists (select 1 from public.atribuicao where conta_id = p_conta and computador_id <> v_pc) then
    return jsonb_build_object('ok', false, 'erro', 'conta em uso por outro computador');
  end if;
  select computador_id into v_dono from public.posse where conta_id = p_conta and expira_em > now() for update;
  if v_dono is not null and v_dono <> v_pc then
    return jsonb_build_object('ok', false, 'erro', 'conta com outro computador');
  end if;
  insert into public.posse (conta_id, computador_id, motivo, expira_em)
  values (p_conta, v_pc, p_motivo, now() + make_interval(secs => least(greatest(p_segundos, 10), 600)))
  on conflict (conta_id) do update set computador_id = excluded.computador_id, motivo = excluded.motivo,
                                       desde = case when posse.computador_id = excluded.computador_id then posse.desde else now() end,
                                       expira_em = excluded.expira_em;
  select cifrado, nonce, versao, expira_em into v_cofre from public.cofre where conta_id = p_conta;
  return jsonb_build_object('ok', true, 'cofre', case when v_cofre.versao is null then null else jsonb_build_object(
    'cifrado', public.rvz_b64(v_cofre.cifrado), 'nonce', public.rvz_b64(v_cofre.nonce), 'versao', v_cofre.versao,
    'expira_em', v_cofre.expira_em) end);
end $$;

create or replace function public.agente_relatar_uso(p_janelas jsonb, p_historico jsonb default '[]') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_pc uuid := public.rvz_exigir_computador();
  j jsonb;
  n integer := 0;
begin
  if jsonb_typeof(p_janelas) <> 'array' or jsonb_array_length(p_janelas) > 100 then raise exception 'janelas inválidas'; end if;
  for j in select * from jsonb_array_elements(p_janelas) loop
    if not exists (select 1 from public.posse where conta_id = (j ->> 'conta_id')::uuid and computador_id = v_pc
                   and expira_em > now() - interval '1 minute') then
      continue;  -- só relata quem tem a conta em mãos
    end if;
    insert into public.uso_janelas (conta_id, tipo, pct, reset_em, lido_em, fonte)
    values ((j ->> 'conta_id')::uuid, j ->> 'tipo', (j ->> 'pct')::numeric, (j ->> 'reset_em')::timestamptz, now(),
            coalesce(j ->> 'fonte', 'api'))
    on conflict (conta_id, tipo) do update set pct = excluded.pct, reset_em = excluded.reset_em,
                                               lido_em = excluded.lido_em, fonte = excluded.fonte;
    n := n + 1;
  end loop;
  if jsonb_typeof(p_historico) = 'array' and jsonb_array_length(p_historico) <= 500 then
    insert into public.uso_historico (conta_id, em, p5, p7)
    select (h ->> 'conta_id')::uuid, (h ->> 'em')::timestamptz, (h ->> 'p5')::numeric, (h ->> 'p7')::numeric
      from jsonb_array_elements(p_historico) h
     where exists (select 1 from public.posse p where p.conta_id = (h ->> 'conta_id')::uuid and p.computador_id = v_pc
                     and p.expira_em > now() - interval '1 minute')
    on conflict do nothing;
  end if;
  perform public.decidir(v_pc, false);
  return jsonb_build_object('ok', true, 'gravadas', n);
end $$;

create or replace function public.agente_marcar_login(p_conta uuid, p_precisa boolean) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_pc uuid := public.rvz_exigir_computador();
begin
  if not exists (select 1 from public.posse where conta_id = p_conta and computador_id = v_pc and expira_em > now())
     and not exists (select 1 from public.atribuicao where conta_id = p_conta and computador_id = v_pc) then
    return jsonb_build_object('ok', false, 'erro', 'conta não está com este computador');
  end if;
  update public.contas set precisa_login = coalesce(p_precisa, false) where id = p_conta;
  if p_precisa and exists (select 1 from public.atribuicao where conta_id = p_conta and computador_id = v_pc) then
    perform public.decidir(v_pc, true);
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.painel_revogar_membro(p_user uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public.rvz_exigir_admin();
  if p_user = auth.uid() then raise exception 'não dá para revogar a si mesmo'; end if;
  delete from public.membros where user_id = p_user and papel <> 'computador';
  if not found then return jsonb_build_object('ok', false, 'erro', 'membro desconhecido'); end if;
  -- se a pessoa for convidada de novo, as chaves antigas não voltam a valer; e o celular dela para de receber aviso
  update public.chaves_api set revogada = true where user_id = p_user and not revogada;
  delete from public.push_inscricoes where user_id = p_user;
  perform public.rvz_auditar('revogar_membro', p_user::text);
  return jsonb_build_object('ok', true);
end $$;

-- Pedido do painel a um computador: e-mail só com letras, números e . _ % + - (nenhum caractere de shell chega ao
-- login do computador, nem no Windows); o computador precisa existir e não estar revogado; corpo de cada ação conferido.
create or replace function public.painel_comando(p_computador uuid, p_acao text, p_corpo jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id bigint;
begin
  perform public.rvz_exigir_admin();
  if not exists (select 1 from public.computadores where id = p_computador and not revogado) then
    raise exception 'computador desconhecido ou revogado';
  end if;
  if jsonb_typeof(coalesce(p_corpo, '{}')) <> 'object' then raise exception 'pedido inválido'; end if;
  if p_acao in ('conectar', 'entrar_de_novo') and coalesce(p_corpo ->> 'email', '')
       !~ '^[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$' then
    raise exception 'e-mail inválido';
  end if;
  if p_acao in ('codigo_login', 'cancelar_login') and coalesce(p_corpo ->> 'login_id', '') !~ '^[0-9a-f]{6,32}$' then
    raise exception 'login desconhecido';
  end if;
  if p_acao = 'codigo_login' and (coalesce(p_corpo ->> 'codigo', '') = '' or length(p_corpo ->> 'codigo') > 4000
                                  or p_corpo ->> 'codigo' ~ '[\r\n]') then
    raise exception 'código inválido';
  end if;
  if p_acao = 'retomar_sessao' and coalesce(p_corpo ->> 'sessao', '') !~ '^[A-Za-z0-9_-]{1,80}$' then
    raise exception 'sessão inválida';
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
