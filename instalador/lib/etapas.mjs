// Etapas numeradas de verdade: a lista do que VAI rodar no caminho desta instalação, numerada de 1 a N. Antes o
// número era fixo (1/8 a 8/8) e cada caminho pulava números (computador ligado, atualizar, sem nuvem).

/**
 * As etapas que rodam neste caminho, na ordem. As condições são as mesmas que o instalador usa para rodar cada uma:
 * ligar (computador novo numa instalação que já existe), a nuvem (nem ligado, nem sem nuvem, nem computador que só
 * atualiza o programa dele), o painel (quando a nuvem foi mexida: numa atualização sem token ela fica como está), as
 * contas (só na instalação nova) e os alertas (só com nuvem nova).
 */
export function etapasDoCaminho({ ligar = false, atualizar = false, semNuvem = false, soEsteComputador = false, nuvemNova = false, manterNuvem = false } = {}) {
  const nuvem = !ligar && !semNuvem && !soEsteComputador;
  const publica = nuvem && !manterNuvem;
  return [
    "conferir",
    "programa",
    ...(ligar ? ["ligar"] : []),
    ...(nuvem ? ["nuvem"] : []),
    "servico",
    ...(publica ? ["painel"] : []),
    ...(!atualizar && !ligar ? ["contas"] : []),
    ...(publica && nuvemNova ? ["alertas"] : []),
    "prova",
  ];
}

/** "3/5" para a terceira de cinco; vazio para etapa que não está na lista. */
export function numeroDaEtapa(lista, id) {
  const i = lista.indexOf(id);
  return i < 0 ? "" : `${i + 1}/${lista.length}`;
}

/**
 * Numa atualização com nuvem, sem pergunta e sem SUPABASE_ACCESS_TOKEN no ambiente, já se sabe que o token vem em branco:
 * a nuvem e o painel ficam como estão, e o painel não entra na conta. Com pergunta, só se sabe depois da resposta, e
 * a lista é refeita ali (as etapas seguintes saem com o total novo).
 */
export function manterNuvemPrevisto({ atualizar, temNuvem, semPerguntas, tokenNoAmbiente }) {
  return !!(atualizar && temNuvem && semPerguntas && !tokenNoAmbiente);
}
