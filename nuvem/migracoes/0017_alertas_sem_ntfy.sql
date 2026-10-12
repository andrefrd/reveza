-- Reveza AI · 0017 · o canal ntfy sai dos alertas (12/10/2026: ninguém usava). Ficam Telegram, e-mail, webhook e a
-- notificação no celular (push).
-- reaplicável: apaga o que sobrou de ntfy (com o segredo dele no Vault), recria a restrição do canal e a conferência
-- do destino (create or replace). Rodar de novo não muda nada.

-- um alerta ntfy que tenha sobrado sai junto com o tópico guardado no Vault (o tópico é o segredo do canal)
delete from vault.secrets s
 using public.alertas a
 where a.canal = 'ntfy' and a.destino ? 'vault_id' and s.id::text = a.destino ->> 'vault_id';
delete from public.alertas where canal = 'ntfy';

alter table public.alertas drop constraint if exists alertas_canal_check;
alter table public.alertas add constraint alertas_canal_check check (canal in ('telegram', 'email', 'webhook', 'push'));

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
