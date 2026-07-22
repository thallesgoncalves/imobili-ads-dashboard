(function () {
  "use strict";

  const { fmtCurrency, fmtNumber, fmtPercent, getRange, inRange, setGreeting, setupSidebarNav, setupRangeFilter } =
    window.Common;

  const LOST_REASON_LABELS = {
    return_delay: "Demora no retorno",
    inactive: "Inativo",
    fail_to_contact: "Não conseguiu contato",
    invalid: "Inválido",
    bought_elsewhere: "Comprou em outro lugar",
    just_researching: "Só pesquisando",
    not_ready_to_buy: "Ainda não decidido",
    underprivileged: "Sem perfil financeiro",
    partner_agent: "Fechou com outro corretor",
    missing_product: "Não tinha o produto buscado",
    service_problem: "Problema no atendimento",
    ddd_far: "Fora da região",
    without_qualification: "Sem qualificação",
    z_others: "Outros",
  };

  const STAGE_COLORS = {
    novo: "var(--funnel-1)",
    negociacao: "var(--funnel-2)",
    visita: "var(--funnel-3)",
    fechado: "var(--funnel-4)",
    arquivado: "var(--status-critical)",
  };

  const LOST_COLORS = ["var(--funnel-4)", "var(--funnel-3)", "var(--funnel-2)", "var(--funnel-1)", "var(--status-critical)", "var(--text-muted)"];

  let allLeads = [];
  let oldestDate = null;
  let loadFailed = false;
  let state = { rangeMode: "30", customFrom: null, customTo: null };
  let sellerSort = { key: "total", dir: "desc" };
  let productSort = { key: "total", dir: "desc" };

  async function loadC2SData() {
    const res = await fetch("data/c2s.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load data/c2s.json (${res.status})`);
    return res.json();
  }

  function filteredLeads() {
    const { from, to } = getRange(state);
    return allLeads.filter((l) => l.created_at && inRange(l.created_at, from, to));
  }

  function stageOf(lead) {
    if (lead.archived) return "arquivado";
    if (lead.done) return "fechado";
    if (lead.visit) return "visita";
    if (lead.status_name === "Novo") return "novo";
    return "negociacao";
  }

  function renderKPIs(leads) {
    const total = leads.length;
    const won = leads.filter((l) => l.done);
    const withVisit = leads.filter((l) => l.visit).length;
    const conversion = total > 0 ? (won.length / total) * 100 : 0;

    const cycleDays = won
      .filter((l) => l.done_deal_at)
      .map((l) => (new Date(l.done_deal_at) - new Date(l.created_at)) / 86400000)
      .filter((d) => d >= 0);
    const avgCycle = cycleDays.length > 0 ? cycleDays.reduce((s, d) => s + d, 0) / cycleDays.length : null;

    document.getElementById("kpi-hero").innerHTML = `
      <div>
        <div class="label">Leads no funil</div>
        <div class="value">${fmtNumber(total)}</div>
      </div>
    `;

    const secondary = [
      { label: "Visitas agendadas", value: fmtNumber(withVisit) },
      { label: "Negócios fechados", value: fmtNumber(won.length) },
      { label: "Taxa de conversão", value: fmtPercent(conversion) },
      { label: "Ciclo médio de fechamento", value: avgCycle == null ? "—" : `${Math.round(avgCycle)} dias` },
    ];
    document.getElementById("kpi-secondary").innerHTML = secondary
      .map((t) => `<div class="stat-tile"><div class="label">${t.label}</div><div class="value">${t.value}</div></div>`)
      .join("");
  }

  function renderStageFunnel(leads) {
    const buckets = { novo: 0, negociacao: 0, visita: 0, fechado: 0, arquivado: 0 };
    let visitScheduled = 0;
    let visitDone = 0;
    for (const l of leads) {
      buckets[stageOf(l)] += 1;
      if (l.visit) {
        if (l.visit.latest_status === "Em aberto") visitScheduled += 1;
        else visitDone += 1;
      }
    }

    const labels = {
      novo: "Novo",
      negociacao: "Em negociação",
      visita: "Visita",
      fechado: "Negócio fechado",
      arquivado: "Arquivado (perdido)",
    };

    const segments = Object.keys(buckets)
      .map((key) => ({ key, label: labels[key], count: buckets[key], color: STAGE_COLORS[key] }))
      .filter((s) => s.count > 0);

    const barTotal = Math.max(1, segments.reduce((s, r) => s + r.count, 0));

    document.getElementById("stage-seg-bar").innerHTML = segments
      .map((s) => `<div class="funnel-seg" style="flex-grow:${s.count}; background:${s.color}" title="${s.label}: ${s.count}"></div>`)
      .join("");

    document.getElementById("stage-legend").innerHTML = segments
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

    document.getElementById("visit-footnote").textContent =
      visitScheduled + visitDone > 0
        ? `Dentro de "Visita": ${fmtNumber(visitScheduled)} agendada(s) em aberto e ${fmtNumber(visitDone)} já concluída(s) no C2S.`
        : "Nenhum lead com visita agendada registrada no C2S neste período.";
  }

  function renderLostReasons(leads) {
    const archived = leads.filter((l) => l.archived);
    document.getElementById("lost-count").textContent = `${fmtNumber(archived.length)} leads arquivados`;

    const counts = new Map();
    for (const l of archived) {
      const key = l.lost_reason || "z_others";
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    let entries = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    const top = entries.slice(0, 5);
    const restCount = entries.slice(5).reduce((s, [, c]) => s + c, 0);
    if (restCount > 0) top.push(["z_others_grouped", restCount]);

    const segments = top.map(([key, count], i) => ({
      label: key === "z_others_grouped" ? "Outros motivos" : LOST_REASON_LABELS[key] || key,
      count,
      color: LOST_COLORS[i % LOST_COLORS.length],
    }));

    const barTotal = Math.max(1, segments.reduce((s, r) => s + r.count, 0));

    document.getElementById("lost-seg-bar").innerHTML = segments
      .map((s) => `<div class="funnel-seg" style="flex-grow:${s.count}; background:${s.color}" title="${s.label}: ${s.count}"></div>`)
      .join("");

    document.getElementById("lost-legend").innerHTML = segments
      .map((s) => {
        const pct = (s.count / barTotal) * 100;
        return `<div class="funnel-legend-item">
          <span class="funnel-swatch" style="background:${s.color}"></span>
          <div class="funnel-legend-text">
            <div class="funnel-legend-label">${s.label}</div>
            <div class="funnel-legend-value">${fmtNumber(s.count)}</div>
            <div class="funnel-legend-pct">${pct.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% das perdas</div>
          </div>
        </div>`;
      })
      .join("");
  }

  function groupBy(leads, keyFn) {
    const map = new Map();
    for (const l of leads) {
      const key = keyFn(l) || "—";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(l);
    }
    return map;
  }

  function sortRows(rows, sort) {
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      let av = a[sort.key], bv = b[sort.key];
      if (av == null) av = -Infinity;
      if (bv == null) bv = -Infinity;
      if (typeof av === "string") return av.localeCompare(bv) * dir;
      return (av - bv) * dir;
    });
  }

  function renderSellerTable(leads) {
    const grouped = groupBy(leads, (l) => l.seller);
    const rows = Array.from(grouped.entries()).map(([seller, group]) => {
      const won = group.filter((l) => l.done).length;
      const open = group.filter((l) => !l.archived && !l.done).length;
      return { seller, total: group.length, open, won, conversion: group.length > 0 ? (won / group.length) * 100 : 0 };
    });
    document.getElementById("seller-count").textContent = `${fmtNumber(rows.length)} corretor(es)`;
    document.getElementById("seller-tbody").innerHTML = sortRows(rows, sellerSort)
      .map(
        (r) => `<tr>
          <td>${r.seller}</td>
          <td class="num">${fmtNumber(r.total)}</td>
          <td class="num">${fmtNumber(r.open)}</td>
          <td class="num">${fmtNumber(r.won)}</td>
          <td class="num">${fmtPercent(r.conversion)}</td>
        </tr>`
      )
      .join("");
    document.querySelectorAll("#seller-table thead th").forEach((th) => {
      th.classList.remove("sorted-asc", "sorted-desc");
      if (th.dataset.sort === sellerSort.key) th.classList.add(sellerSort.dir === "asc" ? "sorted-asc" : "sorted-desc");
    });
  }

  function renderProductTable(leads) {
    const grouped = groupBy(leads, (l) => l.product);
    const rows = Array.from(grouped.entries()).map(([product, group]) => {
      const wonLeads = group.filter((l) => l.done);
      const sold = wonLeads.reduce((s, l) => s + (l.done_price || 0), 0);
      return { product, total: group.length, won: wonLeads.length, sold };
    });
    document.getElementById("product-count").textContent = `${fmtNumber(rows.length)} empreendimento(s)`;
    document.getElementById("product-tbody").innerHTML = sortRows(rows, productSort)
      .map(
        (r) => `<tr>
          <td>${r.product}</td>
          <td class="num">${fmtNumber(r.total)}</td>
          <td class="num">${fmtNumber(r.won)}</td>
          <td class="num">${r.sold > 0 ? fmtCurrency(r.sold) : "—"}</td>
        </tr>`
      )
      .join("");
    document.querySelectorAll("#product-table thead th").forEach((th) => {
      th.classList.remove("sorted-asc", "sorted-desc");
      if (th.dataset.sort === productSort.key) th.classList.add(productSort.dir === "asc" ? "sorted-asc" : "sorted-desc");
    });
  }

  function renderSourceBars(leads) {
    const grouped = groupBy(leads, (l) => l.source);
    const rows = Array.from(grouped.entries())
      .map(([source, group]) => ({ source, count: group.length }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
    const max = Math.max(1, ...rows.map((r) => r.count));
    document.getElementById("source-bars").innerHTML = rows
      .map(
        (r) => `<div class="rank-row">
          <div class="rank-label">${r.source}</div>
          <div class="rank-track"><div class="rank-fill" style="width:${(r.count / max) * 100}%"></div></div>
          <div class="rank-value">${fmtNumber(r.count)}</div>
        </div>`
      )
      .join("");
  }

  function renderAll() {
    if (loadFailed) return;
    const leads = filteredLeads();
    renderKPIs(leads);
    renderStageFunnel(leads);
    renderLostReasons(leads);
    renderSellerTable(leads);
    renderProductTable(leads);
    renderSourceBars(leads);
  }

  function setupSortableTable(tableId, sortState) {
    document.querySelectorAll(`#${tableId} thead th[data-sort]`).forEach((th) => {
      th.addEventListener("click", () => {
        const key = th.dataset.sort;
        if (sortState.key === key) {
          sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
        } else {
          sortState.key = key;
          sortState.dir = "desc";
        }
        renderAll();
      });
    });
  }

  async function init() {
    setGreeting();
    setupSidebarNav();
    setupSortableTable("seller-table", sellerSort);
    setupSortableTable("product-table", productSort);

    try {
      const payload = await loadC2SData();
      allLeads = payload.leads || [];
      oldestDate = allLeads.reduce(
        (min, l) => (l.created_at && (!min || l.created_at < min) ? l.created_at.slice(0, 10) : min),
        null
      );
      setupRangeFilter(state, oldestDate, renderAll);

      const updatedAt = payload.generated_at ? new Date(payload.generated_at) : null;
      document.getElementById("updated-at").textContent = updatedAt
        ? `Atualizado em ${updatedAt.toLocaleString("pt-BR")}`
        : "";

      renderAll();
    } catch (err) {
      loadFailed = true;
      document.getElementById("kpi-hero").innerHTML = "";
      document.getElementById("kpi-secondary").innerHTML =
        `<p class="muted">Não foi possível carregar os dados do CRM: ${err.message}</p>`;
      console.error(err);
    }
  }

  init();
})();
