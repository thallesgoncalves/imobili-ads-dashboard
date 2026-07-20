(function () {
  "use strict";

  const fmtCurrency = (v) =>
    (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
  const fmtCurrency2 = (v) =>
    (v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 2 });
  const fmtNumber = (v) => (v || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  const fmtPercent = (v) => `${(v || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

  let allRows = [];
  let state = { rangeDays: 30, account: "all", sortKey: "spend", sortDir: "desc" };

  async function loadData() {
    const res = await fetch("data/campaigns.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load data/campaigns.json (${res.status})`);
    return res.json();
  }

  function withinRange(dateStr, days) {
    const d = new Date(dateStr + "T00:00:00");
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - (days - 1));
    return d >= cutoff;
  }

  function filteredRows() {
    return allRows.filter((r) => {
      if (!withinRange(r.date, state.rangeDays)) return false;
      if (state.account !== "all" && r.account !== state.account) return false;
      return true;
    });
  }

  function renderKPIs(rows) {
    const spend = rows.reduce((s, r) => s + r.spend, 0);
    const impressions = rows.reduce((s, r) => s + r.impressions, 0);
    const clicks = rows.reduce((s, r) => s + r.clicks, 0);
    const leads = rows.reduce((s, r) => s + r.leads, 0);
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    const cpl = leads > 0 ? spend / leads : null;

    const tiles = [
      { label: "Investimento", value: fmtCurrency(spend) },
      { label: "Leads", value: fmtNumber(leads) },
      { label: "Custo por lead", value: cpl == null ? "—" : fmtCurrency2(cpl) },
      { label: "Cliques", value: fmtNumber(clicks) },
      { label: "CTR", value: fmtPercent(ctr) },
      { label: "Impressões", value: fmtNumber(impressions) },
    ];

    const el = document.getElementById("kpi-row");
    el.innerHTML = tiles
      .map((t) => `<div class="stat-tile"><div class="label">${t.label}</div><div class="value">${t.value}</div></div>`)
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

  function renderLineChart(containerId, series, color, formatter) {
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
    const x = (i) => padL + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const y = (v) => padT + plotH - (v / maxV) * plotH;

    const linePoints = series.map((d, i) => `${x(i)},${y(d.value)}`).join(" ");
    const areaPoints = `${x(0)},${padT + plotH} ${linePoints} ${x(n - 1)},${padT + plotH}`;

    const gridLines = [0, 0.5, 1]
      .map((frac) => {
        const gy = padT + plotH * frac;
        return `<line class="chart-grid" x1="${padL}" y1="${gy}" x2="${width - padR}" y2="${gy}" />`;
      })
      .join("");

    const step = Math.max(1, Math.ceil(n / 6));
    const labels = series
      .map((d, i) => (i % step === 0 || i === n - 1 ? { i, date: d.date } : null))
      .filter(Boolean)
      .map(({ i, date }) => {
        const short = date.slice(5).replace("-", "/");
        return `<text class="chart-axis-label" x="${x(i)}" y="${height - 6}" text-anchor="middle">${short}</text>`;
      })
      .join("");

    const svgNS = "http://www.w3.org/2000/svg";
    container.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Série diária">
        ${gridLines}
        <line class="chart-baseline" x1="${padL}" y1="${padT + plotH}" x2="${width - padR}" y2="${padT + plotH}" />
        <polygon class="chart-area" points="${areaPoints}" fill="${color}" />
        <polyline class="chart-line" points="${linePoints}" stroke="${color}" />
        ${labels}
        <g id="${containerId}-hover">
          <line class="chart-crosshair" x1="0" y1="${padT}" x2="0" y2="${padT + plotH}" />
          <circle class="chart-dot" cx="0" cy="0" r="4" fill="${color}" style="opacity:0" />
        </g>
        <rect x="${padL}" y="${padT}" width="${plotW}" height="${plotH}" fill="transparent" style="cursor:crosshair" id="${containerId}-hitrect" />
      </svg>
      <div class="chart-tooltip" id="${containerId}-tooltip"></div>
    `;

    const svg = container.querySelector("svg");
    const hitrect = document.getElementById(`${containerId}-hitrect`);
    const hoverGroup = document.getElementById(`${containerId}-hover`);
    const crosshair = hoverGroup.querySelector(".chart-crosshair");
    const dot = hoverGroup.querySelector(".chart-dot");
    const tooltip = document.getElementById(`${containerId}-tooltip`);

    function pointFromEvent(evt) {
      const rect = svg.getBoundingClientRect();
      const scaleX = width / rect.width;
      const px = (evt.clientX - rect.left) * scaleX;
      let idx = 0;
      let best = Infinity;
      for (let i = 0; i < n; i++) {
        const dist = Math.abs(x(i) - px);
        if (dist < best) { best = dist; idx = i; }
      }
      return idx;
    }

    function showAt(idx) {
      const d = series[idx];
      const cx = x(idx), cy = y(d.value);
      crosshair.setAttribute("x1", cx);
      crosshair.setAttribute("x2", cx);
      crosshair.classList.add("visible");
      dot.setAttribute("cx", cx);
      dot.setAttribute("cy", cy);
      dot.style.opacity = 1;
      tooltip.innerHTML = `<div class="t-date">${d.date}</div><div class="t-value">${formatter(d.value)}</div>`;
      const rect = svg.getBoundingClientRect();
      const leftPx = rect.left + (cx / width) * rect.width - container.getBoundingClientRect().left;
      const topPx = rect.top + (cy / height) * rect.height - container.getBoundingClientRect().top;
      tooltip.style.left = `${leftPx}px`;
      tooltip.style.top = `${topPx}px`;
      tooltip.classList.add("visible");
    }

    function hide() {
      crosshair.classList.remove("visible");
      dot.style.opacity = 0;
      tooltip.classList.remove("visible");
    }

    hitrect.addEventListener("mousemove", (evt) => showAt(pointFromEvent(evt)));
    hitrect.addEventListener("mouseleave", hide);
    hitrect.addEventListener(
      "touchstart",
      (evt) => {
        const touch = evt.touches[0];
        showAt(pointFromEvent(touch));
      },
      { passive: true }
    );
  }

  function campaignAggregates(rows) {
    const key = (r) => `${r.account}${r.campaign}`;
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
    const sorted = sortRows(campaignAggregates(rows));
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

  function renderAll() {
    const rows = filteredRows();
    renderKPIs(rows);
    renderLineChart("chart-spend", dailySeries(rows, "spend"), "var(--series-spend)", fmtCurrency);
    renderLineChart("chart-leads", dailySeries(rows, "leads"), "var(--series-leads)", fmtNumber);
    renderTable(rows);
  }

  function setupFilters(accounts) {
    document.querySelectorAll("#range-filter button").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#range-filter button").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.rangeDays = Number(btn.dataset.range);
        renderAll();
      });
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
    try {
      const payload = await loadData();
      allRows = payload.rows || [];
      const accounts = Array.from(new Set(allRows.map((r) => r.account))).sort();
      setupFilters(accounts);

      const updatedAt = payload.generated_at ? new Date(payload.generated_at) : null;
      document.getElementById("updated-at").textContent = updatedAt
        ? `Atualizado em ${updatedAt.toLocaleString("pt-BR")}`
        : "";

      renderAll();
    } catch (err) {
      document.getElementById("kpi-row").innerHTML =
        `<p class="muted">Não foi possível carregar os dados: ${err.message}</p>`;
      console.error(err);
    }
  }

  init();
})();
