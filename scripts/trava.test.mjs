import { test } from "node:test";
import assert from "node:assert/strict";
import { problemas } from "./trava.mjs";

const falso = (prefixo, n) => prefixo + "a".repeat(n);

test("segredos são recusados", () => {
  assert.ok(problemas("x.ts", `const t = "${falso("sbp_", 40)}"`).length);
  assert.ok(problemas("x.ts", `k=${falso("sb_secret_", 30)}`).length);
  assert.ok(problemas("x.ts", "-----BEGIN PRIVATE KEY-----").length);
  assert.ok(problemas("x.ts", `"${falso("sk-ant-oat01-", 40)}"`).length);
  assert.ok(problemas("x.md", `licença ${falso("rbpu-", 30)}`).length);
});

test("arquivos de segredo são recusados, o exemplo passa", () => {
  assert.ok(problemas(".env", "").length);
  assert.ok(problemas("painel/.env.local", "").length);
  assert.equal(problemas(".env.exemplo", "VITE_SUPABASE_URL=").length, 0);
});

test("React Bits versionado é recusado", () => {
  assert.ok(problemas("painel/src/components/react-bits/Aurora.tsx", "export default 1").length);
  assert.equal(problemas("painel/scripts/baixar-react-bits.mjs", "baixa de reactbits.dev").length, 0);
});

test("dado pessoal é recusado", () => {
  assert.ok(problemas("README.md", "contato: alguem@chatadv.com.br").length);
  assert.ok(problemas("docs/x.md", "a conta paulosdantas.app").length);
});

test("código comum passa", () => {
  assert.equal(problemas("agente/src/troca.ts", "export function trocar() { return 1 }").length, 0);
  assert.equal(problemas("painel/src/App.tsx", "const anon = import.meta.env.VITE_SUPABASE_ANON_KEY").length, 0);
});

test("história: segredo apagado num commit seguinte ainda é achado, e mensagem de commit também conta", async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  const os = await import("node:os");
  const path = await import("node:path");
  const { historia } = await import("./trava.mjs");
  const dir = mkdtempSync(path.join(os.tmpdir(), "trava-"));
  const antes = process.cwd();
  const g = (...a) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@exemplo.com", "-c", "commit.gpgsign=false", ...a], { cwd: dir });
  try {
    g("init", "-q");
    writeFileSync(path.join(dir, "a.txt"), `token ${falso("sbp_", 40)}\n`);
    g("add", "a.txt");
    g("commit", "-q", "-m", "primeiro");
    writeFileSync(path.join(dir, "a.txt"), "limpo\n");
    g("commit", "-q", "-am", "contato alguem@chatadv.com.br");
    process.chdir(dir);
    const { achados } = historia();
    assert.ok(achados.some((a) => a.startsWith("a.txt") && a.includes("Supabase")), achados.join("\n"));
    assert.ok(achados.some((a) => a.startsWith("mensagem do commit")), achados.join("\n"));
  } finally {
    process.chdir(antes);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("o bloco Quem fez do README pode ter o site de quem mantém; fora dele, e em outro arquivo, não", () => {
  const bloco = "<!-- quem-fez -->\n[site](https://paulosdantas.adv.br)\n<!-- /quem-fez -->";
  assert.equal(problemas("README.md", `# Reveza\n${bloco}\n`).length, 0);
  assert.equal(problemas("README.en.md", bloco).length, 0);
  assert.ok(problemas("README.md", `${bloco}\ncontato: alguem@chatadv.com.br`).length, "fora do bloco");
  assert.ok(problemas("docs/x.md", bloco).length, "só no README");
  assert.ok(problemas("README.md", `<!-- quem-fez -->${falso("sbp_", 40)}<!-- /quem-fez -->`).length, "segredo vale no bloco");
});
