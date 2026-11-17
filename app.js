(function () {
  "use strict";

  const { fmtCurrency, fmtCurrency2, fmtNumber, fmtPercent, toDateOnly, getRange, inRange, previousRange, hasFullPreviousWindow, trendBadge, renderBarChart, setGreeting, setupSidebarNav, setupRangeFilter } =
    window.Common;

  let allRows = [];
  let budgets = { accounts: [], campaigns: [] };
  const budgetById = new Map();
  let oldestDate = null;
  let c2sLeads = [];
  let c2sOldestDate = null;
  let c2sLoadFailed = false;
  let state = {
    rangeMode: "30",
    customFrom: null,
    customTo: null,
    account: "all",
    search: "",
    sortKey: "spend",
    sortDir: "desc",
  };
  // Independent date range for the CRM funnel + ROI cards, decoupled from
  // the ads filter above — lets you compare a different lead/deal window.
  let crmState = { rangeMode: "30", customFrom: null, customTo: null };

  const FUNNEL_STAGES = [
    { name: "Novo", color: "var(--funnel-1)" },
    { name: "Em negociação", color: "var(--funnel-2)" },
    { name: "Convertido", color: "var(--funnel-3)" },
    { name: "Negócio fechado", color: "var(--funnel-4)" },
    { name: "Finalizado", color: "var(--funnel-4)" },
  ];

  async function loadData() {
    const res = await fetch("data/campaigns.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load data/campaigns.json (${res.status})`);
    return res.json();
  }

  async function loadC2SData() {
    const res = await fetch("data/c2s.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load data/c2s.json (${res.status})`);
    return res.json();
  }

  function rowsForRange(from, to) {
    return allRows.filter((r) => {
      if (!inRange(r.date, from, to)) return false;
      if (state.account !== "all" && r.account !== state.account) return false;
      return true;
    });
  }

  function filteredRows() {
    const { from, to } = getRange(state);
    return rowsForRange(from, to);
  }

  function summarize(rows) {
    const spend = rows.reduce((s, r) => s + r.spend, 0);
    const impressions = rows.reduce((s, r) => s + r.impressions, 0);
    const clicks = rows.reduce((s, r) => s + r.clicks, 0);
    const leads = rows.reduce((s, r) => s + r.leads, 0);
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    const cpl = leads > 0 ? spend / leads : null;
    return { spend, impressions, clicks, leads, ctr, cpl };
  }

  function renderKPIs(rows) {
    const cur = summarize(rows);
    let prev = null;
    if (hasFullPreviousWindow(state, oldestDate)) {
      const { from, to } = previousRange(state);
      prev = summarize(rowsForRange(from, to));
    }

    document.getElementById("kpi-hero").innerHTML = `
      <div>
        <div class="label">Investimento total</div>
        <div class="value">${fmtCurrency(cur.spend)}</div>
      </div>
      ${prev ? trendBadge(cur.spend, prev.spend) : ""}
    `;

    const secondary = [
      { label: "Leads", value: fmtNumber(cur.leads), trend: prev ? trendBadge(cur.leads, prev.leads) : "" },
      { label: "Custo por lead", value: cur.cpl == null ? "—" : fmtCurrency2(cur.cpl), trend: prev ? trendBadge(cur.cpl, prev.cpl) : "" },
      { label: "Cliques", value: fmtNumber(cur.clicks), trend: prev ? trendBadge(cur.clicks, prev.clicks) : "" },
      { label: "CTR", value: fmtPercent(cur.ctr), trend: prev ? trendBadge(cur.ctr, prev.ctr) : "" },
      { label: "Impressões", value: fmtNumber(cur.impressions), trend: prev ? trendBadge(cur.impressions, prev.impressions) : "" },
    ];

    document.getElementById("kpi-secondary").innerHTML = secondary
      .map(
        (t) => `<div class="stat-tile">
          <div class="label">${t.label}</div>
          <div class="value">${t.value}</div>
          ${t.trend}
        </div>`
      )
      .join("");
  }

  function dailySeries(rows, key) {
    const byDate = new Map();
    for (const r of rows) {
      byDate.set(r.date, (byDate.get(r.date) || 0) + r[key]);
    }
    return Array.from(byDate.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, value]) => ({ date, value }));
  }

  function campaignAggregates(rows) {
    const key = (r) => `${r.account}${r.campaign}`;
    const map = new Map();
    for (const r of rows) {
      const k = key(r);
      if (!map.has(k)) {
        map.set(k, { account: r.account, campaign: r.campaign, spend: 0, impressions: 0, clicks: 0, leads: 0, ids: new Set() });
      }
      const agg = map.get(k);
      if (r.campaign_id) agg.ids.add(r.campaign_id);
      agg.spend += r.spend;
      agg.impressions += r.impressions;
      agg.clicks += r.clicks;
      agg.leads += r.leads;
    }
    return Array.from(map.values()).map((agg) => ({
      ...agg,
      ...budgetInfo(agg.ids),
      ctr: agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0,
      cost_per_lead: agg.leads > 0 ? agg.spend / agg.leads : null,
    }));
  }

  // Status + daily budget for a table row. A row can span several campaigns
  // that share a name; active ones are summed, otherwise show the largest.
  function budgetInfo(ids) {
    const items = Array.from(ids).map((id) => budgetById.get(id)).filter(Boolean);
    if (items.length === 0) return { status: null, daily_budget: null };
    const active = items.filter((c) => c.status === "ACTIVE");
    const pool = active.length ? active : items;
    const vals = pool.map((c) => c.daily_budget).filter((v) => v != null);
    const daily = vals.length ? (active.length ? vals.reduce((s, v) => s + v, 0) : Math.max(...vals)) : null;
    return { status: active.length ? "ACTIVE" : items[0].status, daily_budget: daily };
  }

  function statusPill(status) {
    if (!status) return "—";
    if (status === "ACTIVE") return '<span class="status-pill status-active">Ativa</span>';
    if (/PAUSED/.test(status)) return '<span class="status-pill">Pausada</span>';
    if (/DISAPPROVED|WITH_ISSUES|PENDING_BILLING_INFO/.test(status)) return `<span class="status-pill status-issue">${status}</span>`;
    return `<span class="status-pill">${status}</span>`;
  }

  function renderBudget() {
    const el = document.getElementById("budget-grid");
    if (!el) return;
    const inScope = (x) => state.account === "all" || x.account === state.account;
    const activeCamps = budgets.campaigns.filter((c) => inScope(c) && c.status === "ACTIVE");
    const withDaily = activeCamps.filter((c) => c.daily_budget != null);
    const dailyActive = withDaily.reduce((s, c) => s + c.daily_budget, 0);
    const accts = budgets.accounts.filter(inScope);
    const hasBalance = accts.some((a) => a.balance_available != null);
    const balance = accts.reduce((s, a) => s + (a.balance_available || 0), 0);
    const noBalance = accts
      .filter((a) => a.balance_available === 0 && activeCamps.some((c) => c.account === a.account))
      .map((a) => a.account);
    // Autonomy per account (balance ÷ that account's active daily budgets);
    // the headline is the shortest one — whichever account runs dry first.
    const perAccount = accts
      .map((a) => {
        const daily = withDaily.filter((c) => c.account === a.account).reduce((s, c) => s + c.daily_budget, 0);
        const d = a.balance_available != null && daily > 0 ? Math.floor(a.balance_available / daily) : null;
        return { name: a.account, days: d };
      })
      .filter((x) => x.days != null);
    const days = perAccount.length ? Math.min(...perAccount.map((x) => x.days)) : null;
    const missing = activeCamps.length - withDaily.length;

    const tiles = [
      {
        label: "Verba diária ativa",
        value: fmtCurrency2(dailyActive),
        sub: `${fmtNumber(activeCamps.length)} campanha(s) ativa(s)${missing > 0 ? ` · ${missing} sem verba diária` : ""}`,
      },
      {
        label: "Saldo disponível",
        value: hasBalance ? fmtCurrency2(balance) : "—",
        sub:
          noBalance.length > 0
            ? `Sem saldo: ${noBalance.join(", ")}`
            : accts.length > 1
            ? accts.map((a) => `${a.account.replace("CA - ", "")} ${a.balance_available == null ? "—" : fmtCurrency2(a.balance_available)}`).join(" · ")
            : accts[0] && accts[0].balance_available == null && accts[0].funding_label
            ? accts[0].funding_label
            : "",
        warn: noBalance.length > 0,
      },
      {
        label: "Autonomia estimada",
        value: days == null ? "—" : `${fmtNumber(days)} dias`,
        sub:
          perAccount.length > 1
            ? perAccount.map((x) => `${x.name.replace("CA - ", "")} ${fmtNumber(x.days)} dias`).join(" · ")
            : "Saldo ÷ verba diária ativa, se gastar 100% do orçamento",
        highlight: true,
      },
    ];

    el.innerHTML = tiles
      .map(
        (t) => `<div class="roi-tile ${t.highlight ? "roi-highlight" : ""}">
          <div class="label">${t.label}</div>
          <div class="value">${t.value}</div>
          ${t.sub ? `<div class="roi-sub ${t.warn ? "warn" : ""}">${t.sub}</div>` : ""}
        </div>`
      )
      .join("");
  }

  function sortRows(rows) {
    const { sortKey, sortDir } = state;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      let av = a[sortKey], bv = b[sortKey];
      if (av == null) av = -Infinity;
      if (bv == null) bv = -Infinity;
      if (typeof av === "string") return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
  }

  function renderTable(rows) {
    let aggregates = campaignAggregates(rows);
    if (state.search.trim()) {
      const q = state.search.trim().toLowerCase();
      aggregates = aggregates.filter((c) => c.campaign.toLowerCase().includes(q) || c.account.toLowerCase().includes(q));
    }
    const sorted = sortRows(aggregates);
    document.getElementById("table-count").textContent = `${sorted.length} campanhas`;
    const tbody = document.getElementById("campaign-tbody");
    tbody.innerHTML = sorted
      .map(
        (c) => `
      <tr>
        <td><span class="account-badge">${c.account}</span></td>
        <td>${c.campaign}</td>
        <td>${statusPill(c.status)}</td>
        <td class="num">${c.daily_budget == null ? "—" : fmtCurrency2(c.daily_budget)}</td>
        <td class="num">${fmtCurrency(c.spend)}</td>
        <td class="num">${fmtNumber(c.impressions)}</td>
        <td class="num">${fmtNumber(c.clicks)}</td>
        <td class="num">${fmtPercent(c.ctr)}</td>
        <td class="num">${fmtNumber(c.leads)}</td>
        <td class="num">${c.cost_per_lead == null ? "—" : fmtCurrency2(c.cost_per_lead)}</td>
      </tr>`
      )
      .join("");

    document.querySelectorAll("#campaign-table thead th").forEach((th) => {
      th.classList.remove("sorted-asc", "sorted-desc");
      if (th.dataset.sort === state.sortKey) {
        th.classList.add(state.sortDir === "asc" ? "sorted-asc" : "sorted-desc");
      }
    });
  }

  function filteredC2SLeads() {
    const { from, to } = getRange(crmState);
    return c2sLeads.filter((l) => l.created_at && inRange(l.created_at, from, to));
  }

  function renderFunnel() {
    if (c2sLoadFailed) return;
    const leads = filteredC2SLeads();
    const total = leads.length;
    const won = leads.filter((l) => l.done).length;
    const lost = leads.filter((l) => l.archived).length;
    const open = total - won - lost;
    const conversion = total > 0 ? (won / total) * 100 : 0;

    document.getElementById("funnel-kpis").innerHTML = [
      { label: "Leads no CRM", value: fmtNumber(total) },
      { label: "Em andamento", value: fmtNumber(open) },
      { label: "Negócios fechados", value: fmtNumber(won) },
      { label: "Taxa de conversão", value: fmtPercent(conversion) },
    ]
      .map((t) => `<div class="stat-tile"><div class="label">${t.label}</div><div class="value">${t.value}</div></div>`)
      .join("");

    const counts = new Map();
    for (const l of leads) {
      if (l.archived) continue;
      const name = l.status_name || "Outros";
      counts.set(name, (counts.get(name) || 0) + 1);
    }

    const segments = [];
    for (const stage of FUNNEL_STAGES) {
      if (counts.has(stage.name)) {
        segments.push({ label: stage.name, count: counts.get(stage.name), color: stage.color });
        counts.delete(stage.name);
      }
    }
    for (const [name, count] of counts) {
      segments.push({ label: name, count, color: "var(--funnel-4)" });
    }
    if (lost > 0) segments.push({ label: "Arquivado (perdido)", count: lost, color: "var(--status-critical)" });

    const visible = segments.filter((s) => s.count > 0);
    const barTotal = Math.max(1, visible.reduce((s, r) => s + r.count, 0));

    document.getElementById("funnel-seg-bar").innerHTML = visible
      .map((s) => `<div class="funnel-seg" style="flex-grow:${s.count}; background:${s.color}" title="${s.label}: ${s.count}"></div>`)
      .join("");

    document.getElementById("funnel-legend").innerHTML = visible
      .map((s) => {
        const pct = (s.count / barTotal) * 100;
        return `<div class="funnel-legend-item">
          <span class="funnel-swatch" style="background:${s.color}"></span>
          <div class="funnel-legend-text">
            <div class="funnel-legend-label">${s.label}</div>
            <div class="funnel-legend-value">${fmtNumber(s.count)}</div>
            <div class="funnel-legend-pct">${pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% do total</div>
          </div>
        </div>`;
      })
      .join("");
  }

  function renderROI() {
    if (c2sLoadFailed) return;
    const { from, to } = getRange(crmState);
    const spend = rowsForRange(from, to).reduce((s, r) => s + r.spend, 0);
    const wonLeads = filteredC2SLeads().filter((l) => l.done && l.done_price != null);
    const totalSold = wonLeads.reduce((s, l) => s + l.done_price, 0);
    const commission = totalSold * 0.05;
    const roi = spend > 0 && wonLeads.length > 0 ? ((commission - spend) / spend) * 100 : null;
    const roiText = roi == null ? "—" : `${roi >= 0 ? "+" : ""}${roi.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`;

    const tiles = [
      { label: "Investimento em anúncios", value: fmtCurrency(spend) },
      {
        label: "Valor total vendido",
        value: fmtCurrency(totalSold),
        sub: `${fmtNumber(wonLeads.length)} negócio(s) fechado(s)`,
      },
      { label: "Comissão estimada (5%)", value: fmtCurrency(commission) },
      { label: "ROI", value: roiText, highlight: true },
    ];

    document.getElementById("roi-grid").innerHTML = tiles
      .map(
        (t) => `<div class="roi-tile ${t.highlight ? "roi-highlight" : ""}">
          <div class="label">${t.label}</div>
          <div class="value">${t.value}</div>
          ${t.sub ? `<div class="roi-sub">${t.sub}</div>` : ""}
        </div>`
      )
      .join("");
  }

  function renderAdsSection() {
    const rows = filteredRows();
    renderKPIs(rows);
    renderBarChart("chart-spend", dailySeries(rows, "spend"), "var(--series-spend)", fmtCurrency);
    renderBarChart("chart-leads", dailySeries(rows, "leads"), "var(--series-leads)", fmtNumber);
    renderTable(rows);
    renderBudget();
  }

  function renderCrmSection() {
    renderFunnel();
    renderROI();
  }

  function renderAll() {
    renderAdsSection();
    renderCrmSection();
  }

  function setupFilters(accounts) {
    setupRangeFilter(state, oldestDate, renderAdsSection);
    setupRangeFilter(crmState, c2sOldestDate, renderCrmSection, {
      rangeFilter: "#crm-range-filter",
      customRange: "#crm-custom-range",
      dateFrom: "#crm-date-from",
      dateTo: "#crm-date-to",
      applyBtn: "#crm-apply-custom-range",
    });

    const select = document.getElementById("account-filter");
    for (const acc of accounts) {
      const opt = document.createElement("option");
      opt.value = acc;
      opt.textContent = acc;
      select.appendChild(opt);
    }
    select.addEventListener("change", () => {
      state.account = select.value;
      renderAll();
    });

    const search = document.getElementById("campaign-search");
    search.addEventListener("input", () => {
      state.search = search.value;
      renderTable(filteredRows());
    });

    document.querySelectorAll("#campaign-table thead th[data-sort]").forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.sort;
        if (state.sortKey === key) {
          state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
        } else {
          state.sortKey = key;
          state.sortDir = "desc";
        }
        renderTable(filteredRows());
      });
    });
  }

  async function init() {
    setGreeting();
    setupSidebarNav();
    try {
      const payload = await loadData();
      allRows = payload.rows || [];
      budgets = payload.budgets || budgets;
      for (const c of budgets.campaigns) budgetById.set(c.campaign_id, c);
      oldestDate = allRows.reduce((min, r) => (!min || r.date < min ? r.date : min), null);
      const accounts = Array.from(new Set([...allRows.map((r) => r.account), ...budgets.accounts.map((a) => a.account)])).sort();

      const updatedAt = payload.generated_at ? new Date(payload.generated_at) : null;
      document.getElementById("updated-at").textContent = updatedAt
        ? `Atualizado em ${updatedAt.toLocaleString("pt-BR")}`
        : "";

      try {
        const c2sPayload = await loadC2SData();
        c2sLeads = c2sPayload.leads || [];
        c2sOldestDate = c2sLeads.reduce(
          (min, l) => (l.created_at && (!min || l.created_at < min) ? l.created_at.slice(0, 10) : min),
          null
        );
        const c2sUpdatedAt = c2sPayload.generated_at ? new Date(c2sPayload.generated_at) : null;
        document.getElementById("funnel-updated").textContent = c2sUpdatedAt
          ? `Atualizado em ${c2sUpdatedAt.toLocaleString("pt-BR")}`
          : "";
      } catch (c2sErr) {
        c2sLeads = [];
        c2sLoadFailed = true;
        const msg = `<p class="muted">Não foi possível carregar os dados do CRM: ${c2sErr.message}</p>`;
        document.getElementById("funnel-kpis").innerHTML = "";
        document.getElementById("funnel-seg-bar").innerHTML = "";
        document.getElementById("funnel-legend").innerHTML = msg;
        document.getElementById("roi-grid").innerHTML = msg;
        console.error(c2sErr);
      }

      setupFilters(accounts);
      renderAll();
    } catch (err) {
      document.getElementById("kpi-hero").innerHTML = "";
      document.getElementById("kpi-secondary").innerHTML =
        `<p class="muted">Não foi possível carregar os dados: ${err.message}</p>`;
      console.error(err);
    }
  }

  init();
})();
