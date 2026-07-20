// Pulls leads from the Contact2Sale (C2S) CRM API and writes a summarized
// version to data/c2s.json for the dashboard's sales funnel section.
//
// Requires Node 18+ (built-in fetch) and env var C2S_API_TOKEN.

const fs = require("fs");
const path = require("path");

const TOKEN = process.env.C2S_API_TOKEN;
if (!TOKEN) {
  console.error("Missing C2S_API_TOKEN environment variable.");
  process.exit(1);
}

const BASE_URL = "https://api.contact2sale.com/integration";
const DAYS_BACK = 90;
const PER_PAGE = 50;

function isoDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().replace(/\.\d+Z$/, "Z");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchPage(page, createdGte, attempt = 1) {
  const url =
    `${BASE_URL}/leads?page=${page}&perpage=${PER_PAGE}` +
    `&sort=-created_at&created_gte=${encodeURIComponent(createdGte)}`;
  const res = await fetch(url, { headers: { Authorization: TOKEN } });

  if (res.status === 429 && attempt <= 5) {
    const retryAfter = Number(res.headers.get("retry-after")) || attempt * 5;
    console.log(`Rate limited on page ${page}, retrying in ${retryAfter}s (attempt ${attempt})`);
    await sleep(retryAfter * 1000);
    return fetchPage(page, createdGte, attempt + 1);
  }

  if (!res.ok) {
    throw new Error(`C2S request failed: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

function normalizeLead(item) {
  const a = item.attributes || {};
  return {
    id: item.id,
    created_at: a.created_at,
    status_alias: a.lead_status && a.lead_status.alias,
    status_name: a.lead_status && a.lead_status.name,
    archived: !!(a.archive_details && a.archive_details.archived),
    done: !!(a.done_details && a.done_details.done),
    done_price: a.done_details ? a.done_details.done_price : null,
    company: a.company && a.company.name,
    seller: a.seller && a.seller.name,
    source: a.lead_source && a.lead_source.name,
    channel: a.channel && a.channel.name,
    product: a.product && a.product.description,
    lost_reason: a.lost_reasons && a.lost_reasons.name,
  };
}

async function main() {
  const createdGte = isoDaysAgo(DAYS_BACK);
  const leads = [];
  let page = 1;
  let totalPages = 1;

  do {
    const body = await fetchPage(page, createdGte);
    const items = body.data || [];
    for (const item of items) leads.push(normalizeLead(item));
    const pagination = body.pagination;
    totalPages = pagination ? pagination.total_pages : items.length < PER_PAGE ? page : page + 1;
    page += 1;
    if (page <= totalPages) await sleep(300);
  } while (page <= totalPages);

  const outPath = path.join(__dirname, "..", "data", "c2s.json");
  const payload = {
    generated_at: new Date().toISOString(),
    source: "contact2sale",
    days_back: DAYS_BACK,
    leads,
  };

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${leads.length} leads to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
