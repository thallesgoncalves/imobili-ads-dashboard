# Dashboard de Campanhas — Imobili Consultoria

Dashboard estático de performance de Meta Ads (Facebook/Instagram) e do funil
de vendas do CRM Contact2Sale, hospedado no GitHub Pages. Os dados são
atualizados automaticamente a cada 15 minutos via GitHub Actions.

> **Sobre a "atualização a cada 15 min":** é a cadência da coleta de dados
> (commit no repositório). Duas coisas podem atrasar o que aparece na tela:
> o GitHub Pages usa CDN com cache de ~10 min nos arquivos estáticos
> (incluindo os JSONs de dados), e o agendador do GitHub Actions não garante
> o horário exato — pode atrasar alguns minutos em picos de uso da
> plataforma. Na prática, espere dados com até ~20-25 min de defasagem, não
> 15 min cravados.

## Como funciona

- `scripts/fetch_data.js` — busca os últimos 90 dias de dados de campanha
  (investimento, impressões, cliques, leads) direto da **Meta Marketing API**
  para as contas CA - LANÇAMENTOS e CA - INSTITUCIONAL, e grava em
  `data/campaigns.json`.
- `scripts/fetch_c2s.js` — busca leads dos últimos 90 dias via API do
  Contact2Sale e grava em `data/c2s.json`.
- `scripts/fetch_creatives.js` — busca dados diários por anúncio (nível ad) e
  por canal/posicionamento (breakdowns `publisher_platform`/`platform_position`)
  na Meta Marketing API, mais thumbnail e formulário de lead dos criativos com
  maior investimento, e grava em `data/creatives.json`. Com
  `SKIP_CREATIVE_DETAILS=true`, pula a busca de thumbnail/formulário (que não
  muda de 15 em 15 min) e reaproveita o que já estava salvo.
- `.github/workflows/update-data.yml` — roda os três scripts a cada 15
  minutos e comita os JSONs atualizados. Uma vez por dia, às 09:00
  (America/Maceio), o run também atualiza as thumbnails dos criativos —
  nos demais runs do dia isso é pulado (`SKIP_CREATIVE_DETAILS=true`) pra
  não gastar chamada de API à toa em algo que não muda. Pode também ser
  disparado manualmente na aba **Actions** do repositório (sempre roda
  completo, incluindo thumbnails).
- `index.html` / `app.js` — página **Dashboard**: KPIs e gráficos de Meta Ads,
  resumo do funil de vendas e ROI (com filtro de período próprio), tabela de
  campanhas.
- `funil-imobili.html` / `funil.js` — página **Funil Imobili**: visão
  detalhada do funil do CRM (etapas, motivos de perda, performance por
  corretor, leads por empreendimento/origem), com base no processo comercial
  documentado internamente (Fluxo de Atendimento Padrão).
- `canais-criativos.html` / `canais.js` — página **Canais & Criativos**:
  investimento/leads por canal e posicionamento, ranking de criativos (com
  thumbnail) e agrupamento por formulário de lead.
- `common.js` — funções e componentes compartilhados pelas três páginas
  (formatação, filtro de período — suporta múltiplos filtros independentes
  na mesma página —, gráfico de barras).
- `style.css` — estilos das três páginas. Sem build step, sem dependências
  externas além da fonte Lato (Google Fonts).

## Rodar localmente

```bash
META_ACCESS_TOKEN=seu_token node scripts/fetch_data.js
C2S_API_TOKEN=seu_token node scripts/fetch_c2s.js
META_ACCESS_TOKEN=seu_token node scripts/fetch_creatives.js
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
