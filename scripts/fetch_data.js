// Pulls Meta Ads (Facebook/Instagram) campaign data from Windsor.ai for all
// connected accounts and writes it to data/campaigns.json for the dashboard.
//
// Requires Node 18+ (built-in fetch) and env var WINDSOR_API_KEY.

const fs = require("fs");
const path = require("path");

const API_KEY = process.env.WINDSOR_API_KEY;
if (!API_KEY) {
  console.error("Missing WINDSOR_API_KEY environment variable.");
  process.exit(1);
}

const FIELDS = [
  "date",
  "account_name",
  "campaign",
  "adset_name",
  "spend",
  "impressions",
  "clicks",
  "ctr",
  "cpc",
  "actions_lead",
  "actions_leadgen_grouped",
].join(",");

const DAYS_BACK = 90;

async function fetchFacebookData() {
  const url =
    `https://connectors.windsor.ai/facebook` +
    `?api_key=${encodeURIComponent(API_KEY)}` +
    `&fields=${FIELDS}` +
    `&date_preset=last_${DAYS_BACK}d` +
    `&_renderer=json`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Windsor.ai request failed: ${res.status} ${res.statusText}`);
  }
  const body = await res.json();
  if (!Array.isArray(body.data)) {
    throw new Error(`Unexpected Windsor.ai response shape: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return body.data;
}

function normalizeRow(row) {
  const leads = Number(row.actions_lead || 0) + Number(row.actions_leadgen_grouped || 0);
  const spend = Number(row.spend || 0);
  return {
    date: row.date,
    account: row.account_name || "",
    campaign: row.campaign || "",
    adset: row.adset_name || "",
    spend,
    impressions: Number(row.impressions || 0),
    clicks: Number(row.clicks || 0),
    ctr: Number(row.ctr || 0),
    cpc: Number(row.cpc || 0),
    leads,
    cost_per_lead: leads > 0 ? spend / leads : null,
  };
}

async function main() {
  const raw = await fetchFacebookData();
  const rows = raw.map(normalizeRow);

  const outPath = path.join(__dirname, "..", "data", "campaigns.json");
  const payload = {
    generated_at: new Date().toISOString(),
    source: "windsor.ai / facebook",
    days_back: DAYS_BACK,
    rows,
  };

  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));
  console.log(`Wrote ${rows.length} rows to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
