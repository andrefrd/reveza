import { secao } from "../secao"

export default secao({
  pt: {
    uso: {
      descricao:
        "Custo equivalente, tokens, sessões e agentes, por conta, modelo, projeto e computador. Vem das transcrições de cada computador, agregado por hora.",
      periodo: "Período",
      dias: "{n} dias",
      metrica: "Medida",
      metricas: { usd: "Custo", tokens: "Tokens", respostas: "Respostas" },
      kpi: {
        custo: "Custo equivalente",
        custoDica: "Quanto este uso custaria pela tabela de preço da API. Não é cobrança.",
        tokens: "Tokens",
        tokensDetalhe: "{entrada} entrada · {saida} saída · {cache} cache",
        respostas: "Respostas",
        sessoes: "Sessões",
        agentes: "Agentes",
        porDia: "{valor} por dia",
      },
      porDia: {
        titulo: "Por dia, por conta",
        descricao:
          "Cada cor é um workspace e cada tom, uma conta dele. Passe o dedo ou o mouse numa barra para ver o detalhe.",
      },
      ranking: {
        titulo: "Ranking",
        dimensoes: { conta: "Conta", modelo: "Modelo", projeto: "Projeto", computador: "Computador" },
        nenhum: "Sem uso no período.",
      },
      sessoesDia: {
        titulo: "Sessões e agentes por dia",
        sessoes: "Sessões",
        agentes: "Agentes",
      },
      calor: {
        titulo: "Quando você mais usa",
        descricao: "Dia da semana e hora, no seu fuso. Mais escuro = mais uso.",
        menos: "menos",
        mais: "mais",
        celula: "{dia}, {hora}h: {valor}",
        dias: "seg,ter,qua,qui,sex,sáb,dom",
      },
      previsao: {
        titulo: "Previsão de esgotar",
        descricao:
          "No ritmo recente de cada conta: a janela de 5 horas olha a última hora; a semana, as últimas 24 horas.",
        conta: "Conta",
        janela: "Janela",
        quando: "Esgota",
        agora: "Agora",
        nao: "Não esgota antes de renovar",
        esgotada: "Já esgotada",
        semDado: "Sem leitura recente",
      },
      sessoes: {
        titulo: "Sessões mais caras do período",
        projeto: "Projeto",
        computador: "Computador",
        inicio: "Início",
        duracao: "Duração",
        agentes: "Agentes",
        custo: "Custo",
        aberta: "aberta",
        parada: "parou no limite",
      },
      csv: {
        nome: "reveza-uso-{de}-a-{ate}.csv",
        colunas: "hora,conta,computador,projeto,modelo,respostas,entrada,saida,cache_escrita,cache_leitura,usd",
        pronto: "Planilha baixada ({n} linhas)",
      },
    },
  },
  en: {
    uso: {
      descricao:
        "Equivalent cost, tokens, sessions and agents, by account, model, project and computer. It comes from each computer's transcripts, aggregated by hour.",
      periodo: "Period",
      dias: "{n} days",
      metrica: "Measure",
      metricas: { usd: "Cost", tokens: "Tokens", respostas: "Responses" },
      kpi: {
        custo: "Equivalent cost",
        custoDica: "What this usage would cost at API prices. Not a charge.",
        tokens: "Tokens",
        tokensDetalhe: "{entrada} input · {saida} output · {cache} cache",
        respostas: "Responses",
        sessoes: "Sessions",
        agentes: "Agents",
        porDia: "{valor} per day",
      },
      porDia: {
        titulo: "Per day, per account",
        descricao: "Each color is a workspace and each shade, one of its accounts. Hover or tap a bar for the details.",
      },
      ranking: {
        titulo: "Ranking",
        dimensoes: { conta: "Account", modelo: "Model", projeto: "Project", computador: "Computer" },
        nenhum: "No usage in this period.",
      },
      sessoesDia: {
        titulo: "Sessions and agents per day",
        sessoes: "Sessions",
        agentes: "Agents",
      },
      calor: {
        titulo: "When you use it most",
        descricao: "Day of week and hour, in your time zone. Darker = more usage.",
        menos: "less",
        mais: "more",
        celula: "{dia}, {hora}h: {valor}",
        dias: "Mon,Tue,Wed,Thu,Fri,Sat,Sun",
      },
      previsao: {
        titulo: "Run-out forecast",
        descricao:
          "At each account's recent pace: the 5-hour window looks at the last hour; the week, at the last 24 hours.",
        conta: "Account",
        janela: "Window",
        quando: "Runs out",
        agora: "Now",
        nao: "Won't run out before resetting",
        esgotada: "Already exhausted",
        semDado: "No recent reading",
      },
      sessoes: {
        titulo: "Most expensive sessions in the period",
        projeto: "Project",
        computador: "Computer",
        inicio: "Start",
        duracao: "Duration",
        agentes: "Agents",
        custo: "Cost",
        aberta: "open",
        parada: "stopped at the limit",
      },
      csv: {
        nome: "reveza-usage-{de}-to-{ate}.csv",
        colunas: "hour,account,computer,project,model,responses,input,output,cache_write,cache_read,usd",
        pronto: "Spreadsheet downloaded ({n} rows)",
      },
    },
  },
})
