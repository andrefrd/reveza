-- Reveza AI · 0005 · agenda do pg_cron (só no Supabase; os testes locais pulam arquivos .supabase.sql).
-- reaplicável: só funções e agenda (create or replace); o instalador roda de novo quando o arquivo muda.
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule(jobid) from cron.job where jobname in ('reveza-decidir', 'reveza-limpeza', 'reveza-vigiar', 'reveza-alertas', 'reveza-resumo');
select cron.schedule('reveza-decidir', '* * * * *', 'select public.decidir()');
-- Limpeza: comandos e ligações velhos, histórico com mais de 90 dias, eventos com mais de 180 dias.
select cron.schedule('reveza-limpeza', '17 4 * * *', $$
  delete from public.comandos where criado_em < now() - interval '30 days';
  delete from public.ligacoes where expira_em < now() - interval '1 day';
  delete from public.uso_historico where em < now() - interval '90 days';
  delete from public.eventos where em < now() - interval '180 days';
$$);
select cron.schedule('reveza-vigiar', '*/2 * * * *', 'select public.vigiar()');
-- Alertas: chama a Edge Function com um segredo só do cron (no Vault; o provisionamento cria os dois segredos).
select cron.schedule('reveza-alertas', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'reveza_url') || '/functions/v1/alertas',
    headers := jsonb_build_object('x-reveza-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'reveza_cron'),
                                  'Content-Type', 'application/json'),
    body := '{"acao": "enviar"}'::jsonb)
$$);
select cron.schedule('reveza-resumo', '0 0 * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'reveza_url') || '/functions/v1/alertas',
    headers := jsonb_build_object('x-reveza-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'reveza_cron'),
                                  'Content-Type', 'application/json'),
    body := '{"acao": "resumo"}'::jsonb)
$$);
