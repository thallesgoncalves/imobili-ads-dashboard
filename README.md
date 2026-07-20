# Dashboard de Campanhas — Imobili Consultoria

Dashboard estático de performance de Meta Ads (Facebook/Instagram), hospedado no
GitHub Pages. Os dados vêm da API do [Windsor.ai](https://windsor.ai) e são
atualizados automaticamente uma vez por dia via GitHub Actions.

## Como funciona

- `scripts/fetch_data.js` — busca os últimos 90 dias de dados de campanha
  (investimento, impressões, cliques, leads) via API do Windsor.ai e grava em
  `data/campaigns.json`.
- `.github/workflows/update-data.yml` — roda o script todo dia às 09:00
  (America/Maceio) e comita o JSON atualizado. Pode também ser disparado
  manualmente na aba **Actions** do repositório.
- `index.html` / `style.css` / `app.js` — dashboard estático que lê
  `data/campaigns.json` e renderiza KPIs, gráficos diários e a tabela de
  campanhas. Sem build step, sem dependências externas.

## Rodar localmente

```bash
WINDSOR_API_KEY=sua_key node scripts/fetch_data.js
python3 -m http.server 8000
# abrir http://localhost:8000
```

## Configuração no GitHub

1. Secret **WINDSOR_API_KEY** em *Settings → Secrets and variables → Actions*.
2. GitHub Pages configurado para publicar a partir da branch `main` (`/root`).
