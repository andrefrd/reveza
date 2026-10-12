-- Reveza AI · 0022 · a agenda da atualização sozinha da nuvem (só no Supabase; os testes locais pulam .supabase.sql).
-- reaplicável: só agenda (unschedule e schedule pelo nome); o instalador e a própria nuvem rodam de novo quando muda.
--
-- De hora em hora, o pg_cron chama a Edge Function `atualizar-nuvem` com o segredo do cron (o mesmo dos alertas, no
-- Vault). Ela confere a escolha da instalação (atualizar_sozinho): desligada não faz nada; de madrugada, só das 3h às
-- 5h no fuso; assim que sair, a qualquer hora. A função responde em segundos; o prazo de 150 s é folga.
select cron.unschedule(jobid) from cron.job where jobname = 'reveza-atualizar-nuvem';
select cron.schedule('reveza-atualizar-nuvem', '7 * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'reveza_url') || '/functions/v1/atualizar-nuvem',
    headers := jsonb_build_object('x-reveza-cron', (select decrypted_secret from vault.decrypted_secrets where name = 'reveza_cron'),
                                  'Content-Type', 'application/json'),
    body := '{"acao": "sozinho"}'::jsonb,
    timeout_milliseconds := 150000)
$$);
