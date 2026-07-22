# Dashboard de Campanhas — Imobili Consultoria

Dashboard estático de performance de Meta Ads (Facebook/Instagram) e do funil
de vendas do CRM Contact2Sale, hospedado no GitHub Pages. Os dados são
atualizados automaticamente uma vez por dia via GitHub Actions.

## Como funciona

- `scripts/fetch_data.js` — busca os últimos 90 dias de dados de campanha
  (investimento, impressões, cliques, leads) direto da **Meta Marketing API**
  para as contas CA - LANÇAMENTOS e CA - INSTITUCIONAL, e grava em
  `data/campaigns.json`.
- `scripts/fetch_c2s.js` — busca leads dos últimos 90 dias via API do
  Contact2Sale e grava em `data/c2s.json`.
- `.github/workflows/update-data.yml` — roda os dois scripts todo dia às 09:00
  (America/Maceio) e comita os JSONs atualizados. Pode também ser disparado
  manualmente na aba **Actions** do repositório.
- `index.html` / `app.js` — página **Dashboard**: KPIs e gráficos de Meta Ads,
  resumo do funil de vendas e ROI, tabela de campanhas.
- `funil-imobili.html` / `funil.js` — página **Funil Imobili**: visão
  detalhada do funil do CRM (etapas, motivos de perda, performance por
  corretor, leads por empreendimento/origem), com base no processo comercial
  documentado internamente (Fluxo de Atendimento Padrão).
- `common.js` — funções e componentes compartilhados pelas duas páginas
  (formatação, filtro de período, gráfico de barras).
- `style.css` — estilos das duas páginas. Sem build step, sem dependências
  externas além da fonte Lato (Google Fonts).

## Rodar localmente

```bash
META_ACCESS_TOKEN=seu_token node scripts/fetch_data.js
C2S_API_TOKEN=seu_token node scripts/fetch_c2s.js
python3 -m http.server 8000
# abrir http://localhost:8000
```

`META_ACCESS_TOKEN` deve ser um token de **System User** do Business Manager
(Configurações do negócio → Usuários → Usuários do sistema) com a permissão
`ads_read` nas contas de anúncio, gerado com expiração "Nunca" — assim não
precisa ser renovado.

## Configuração no GitHub

1. Secrets **META_ACCESS_TOKEN** e **C2S_API_TOKEN** em
   *Settings → Secrets and variables → Actions*.
2. GitHub Pages configurado para publicar a partir da branch `main` (`/root`).
