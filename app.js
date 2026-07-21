(function () {
  "use strict";

  const fmtCurrency = (v) =>
    (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const fmtCurrency2 = (v) =>
    (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
  const fmtNumber = (v) => (v || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  const fmtPercent = (v) => `${(v || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

  let allRows = [];
  let oldestDate = null;
  let c2sLeads = [];
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

  function today0() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function addDays(date, delta) {
    const d = new Date(date);
    d.setDate(d.getDate() + delta);
    return d;
  }

  function toDateOnly(dateStr) {
    return new Date(dateStr.slice(0, 10) + "T00:00:00");
  }

  function dayCount(from, to) {
    return Math.round((to - from) / 86400000) + 1;
  }

  function getRange() {
    const to = today0();
    switch (state.rangeMode) {
      case "7":
        return { from: addDays(to, -6), to };
      case "30":
        return { from: addDays(to, -29), to };
      case "90":
        return { from: addDays(to, -89), to };
      case "month":
        return { from: new Date(to.getFullYear(), to.getMonth(), 1), to };
      case "custom":
        return {
          from: state.customFrom || addDays(to, -29),
          to: state.customTo || to,
        };
      default:
        return { from: addDays(to, -29), to };
    }
  }

  function inRange(dateStr, from, to) {
    const d = toDateOnly(dateStr);
    return d >= from && d <= to;
  }

  function rowsForRange(from, to) {
    return allRows.filter((r) => {
      if (!inRange(r.date, from, to)) return false;
      if (state.account !== "all" && r.account !== state.account) return false;
      return true;
    });
  }

  function filteredRows() {
    const { from, to } = getRange();
    return rowsForRange(from, to);
  }

  function previousRange() {
    const { from, to } = getRange();
    const duration = dayCount(from, to);
    const prevTo = addDays(from, -1);
    const prevFrom = addDays(prevTo, -(duration - 1));
    return { from: prevFrom, to: prevTo };
  }

  function hasFullPreviousWindow() {
    if (!oldestDate) return false;
    const { from: prevFrom } = previousRange();
    return toDateOnly(oldestDate) <= prevFrom;
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

  function trendBadge(current, previous) {
    if (previous == null || previous === 0 || current == null) return "";
    const delta = ((current - previous) / previous) * 100;
    const dir = delta >= 0 ? "up" : "down";
    const arrow = delta >= 0 ? "↑" : "↓";
    return `<div class="trend ${dir}">${arrow} ${Math.abs(delta).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}% vs período anterior</div>`;
  }

  function renderKPIs(rows) {
    const cur = summarize(rows);
    let prev = null;
    if (hasFullPreviousWindow()) {
      const { from, to } = previousRange();
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

  function renderBarChart(containerId, series, color, formatter) {
    const container = document.getElementById(containerId);
    container.innerHTML = "";
    if (series.length === 0) {
      container.innerHTML = '<p class="muted">Sem dados no período.</p>';
      return;
    }

    const width = 520, height = 220;
    const padL = 8, padR = 8, padT = 12, padB = 24;
    const plotW = width - padL - padR;
    const plotH = height - padT - padB;

    const maxV = Math.max(1, ...series.map((d) => d.value));
    const n = series.length;
    const gap = 2;
    const barW = Math.max(1.5, plotW / n - gap);
    const x = (i) => padL + i * (plotW / n);
    const barH = (v) => (v / maxV) * plotH;

    const gridLines = [0, 0.5, 1]
      .map((frac) => {
        const gy = padT + plotH * frac;
        return `<line class="chart-grid" x1="${padL}" y1="${gy}" x2="${width - padR}" y2="${gy}" />`;
      })
      .join("");

    const bars = series
      .map((d, i) => {
        const h = Math.max(1, barH(d.value));
        const bx = x(i);
        const by = padT + plotH - h;
        return `<rect class="chart-bar" data-i="${i}" x="${bx}" y="${by}" width="${barW}" height="${h}" rx="3" fill="${color}" />`;
      })
      .join("");

    const step = Math.max(1, Math.ceil(n / 6));
    const labels = series
      .map((d, i) => (i % step === 0 || i === n - 1 ? { i, date: d.date } : null))
      .filter(Boolean)
      .map(({ i, date }) => {
        const short = date.slice(5).replace("-", "/");
        return `<text class="chart-axis-label" x="${x(i) + barW / 2}" y="${height - 6}" text-anchor="middle">${short}</text>`;
      })
      .join("");

    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Série diária">
        ${gridLines}
        <line class="chart-baseline" x1="${padL}" y1="${padT + plotH}" x2="${width - padR}" y2="${padT + plotH}" />
        <g id="${containerId}-bars">${bars}</g>
        ${labels}
      </svg>
      <div class="chart-tooltip" id="${containerId}-tooltip"></div>
    `;

    const svg = container.querySelector("svg");
    const tooltip = document.getElementById(`${containerId}-tooltip`);
    const barEls = Array.from(document.querySelectorAll(`#${containerId}-bars .chart-bar`));

    function showAt(idx, clientX, clientY) {
      const d = series[idx];
      tooltip.innerHTML = `<div class="t-date">${d.date}</div><div class="t-value">${formatter(d.value)}</div>`;
      const rect = container.getBoundingClientRect();
      tooltip.style.left = `${clientX - rect.left}px`;
      tooltip.style.top = `${clientY - rect.top - 12}px`;
      tooltip.classList.add("visible");
    }
    function hide() {
      tooltip.classList.remove("visible");
    }

    barEls.forEach((bar, i) => {
      bar.addEventListener("mousemove", (evt) => showAt(i, evt.clientX, evt.clientY));
      bar.addEventListener("mouseleave", hide);
      bar.addEventListener(
        "touchstart",
        (evt) => {
          const t = evt.touches[0];
          showAt(i, t.clientX, t.clientY);
        },
        { passive: true }
      );
    });
    svg.addEventListener("mouseleave", hide);
  }

  function campaignAggregates(rows) {
    const key = (r) => `${r.account}${r.campaign}`;
    const map = new Map();
    for (const r of rows) {
      const k = key(r);
      if (!map.has(k)) {
        map.set(k, { account: r.account, campaign: r.campaign, spend: 0, impressions: 0, clicks: 0, leads: 0 });
      }
      const agg = map.get(k);
      agg.spend += r.spend;
      agg.impressions += r.impressions;
      agg.clicks += r.clicks;
      agg.leads += r.leads;
    }
    return Array.from(map.values()).map((agg) => ({
      ...agg,
      ctr: agg.impressions > 0 ? (agg.clicks / agg.impressions) * 100 : 0,
      cost_per_lead: agg.leads > 0 ? agg.spend / agg.leads : null,
    }));
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
    const { from, to } = getRange();
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
    const spend = filteredRows().reduce((s, r) => s + r.spend, 0);
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

  function renderAll() {
    const rows = filteredRows();
    renderKPIs(rows);
    renderBarChart("chart-spend", dailySeries(rows, "spend"), "var(--series-spend)", fmtCurrency);
    renderBarChart("chart-leads", dailySeries(rows, "leads"), "var(--series-leads)", fmtNumber);
    renderTable(rows);
    renderFunnel();
    renderROI();
  }

  function setGreeting() {
    const hour = new Date().getHours();
    const text = hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite";
    document.getElementById("greeting-text").textContent = text;
  }

  function setupSidebarNav() {
    const buttons = Array.from(document.querySelectorAll(".sidebar-nav button"));
    buttons.forEach((btn) => {
      btn.addEventListener("click", () => {
        buttons.forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const target = document.querySelector(btn.dataset.scroll);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  }

  function setupFilters(accounts) {
    const customRangeBox = document.getElementById("custom-range");
    const dateFromInput = document.getElementById("date-from");
    const dateToInput = document.getElementById("date-to");

    if (oldestDate) dateFromInput.min = dateToInput.min = oldestDate;
    const todayStr = today0().toISOString().slice(0, 10);
    dateFromInput.max = dateToInput.max = todayStr;

    document.querySelectorAll("#range-filter button").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#range-filter button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.rangeMode = btn.dataset.range;

        if (state.rangeMode === "custom") {
          customRangeBox.hidden = false;
          if (!dateFromInput.value) {
            const { from, to } = getRange();
            dateFromInput.value = from.toISOString().slice(0, 10);
            dateToInput.value = to.toISOString().slice(0, 10);
          }
        } else {
          customRangeBox.hidden = true;
        }
        renderAll();
      });
    });

    document.getElementById("apply-custom-range").addEventListener("click", () => {
      if (!dateFromInput.value || !dateToInput.value) return;
      const from = toDateOnly(dateFromInput.value);
      const to = toDateOnly(dateToInput.value);
      if (from > to) return;
      state.customFrom = from;
      state.customTo = to;
      renderAll();
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
      oldestDate = allRows.reduce((min, r) => (!min || r.date < min ? r.date : min), null);
      const accounts = Array.from(new Set(allRows.map((r) => r.account))).sort();
      setupFilters(accounts);

      const updatedAt = payload.generated_at ? new Date(payload.generated_at) : null;
      document.getElementById("updated-at").textContent = updatedAt
        ? `Atualizado em ${updatedAt.toLocaleString("pt-BR")}`
        : "";

      try {
        const c2sPayload = await loadC2SData();
        c2sLeads = c2sPayload.leads || [];
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
