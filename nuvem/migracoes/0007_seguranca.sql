-- Reveza AI · 0007 · ajustes da revisão de segurança de 11/10/2026: leitura de administrador só com duas etapas e
-- uma conta atribuída a um computador só (também sob decisões simultâneas).
-- reaplicável: só políticas e índice idempotentes; o instalador roda de novo quando o arquivo muda.

-- Administrador que entrou só com a senha (sem a segunda etapa) não lê convites, alertas, webhooks nem auditoria.
drop policy if exists admin_le on public.convites;
create policy admin_le on public.convites for select to authenticated using (public.rvz_eh_admin() and public.rvz_aal2());
drop policy if exists admin_le on public.alertas;
create policy admin_le on public.alertas for select to authenticated using (public.rvz_eh_admin() and public.rvz_aal2());
drop policy if exists admin_le on public.webhooks_saida;
create policy admin_le on public.webhooks_saida for select to authenticated using (public.rvz_eh_admin() and public.rvz_aal2());
drop policy if exists admin_le on public.auditoria;
create policy admin_le on public.auditoria for select to authenticated using (public.rvz_eh_admin() and public.rvz_aal2());

create unique index if not exists atribuicao_conta_unica on public.atribuicao (conta_id) where conta_id is not null;
