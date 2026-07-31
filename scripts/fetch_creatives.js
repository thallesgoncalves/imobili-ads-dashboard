// Pulls channel/placement and creative-level Meta Ads data for the "Canais &
// Criativos" page: which platform+placement combos perform best, which ads
// (creatives) are driving leads, and which lead form each one uses.
//
// Requires Node 18+ (built-in fetch) and env var META_ACCESS_TOKEN (same
// System User token used by fetch_data.js).

const fs = require("fs");
const path = require("path");

const TOKEN = process.env.META_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("Missing META_ACCESS_TOKEN environment variable.");
  process.exit(1);
}

const API_VERSION = "v21.0";
const DAYS_BACK = 90;
const TOP_CREATIVES_WITH_THUMB = 40;

const AD_ACCOUNTS = [
  { id: "1789689275316145", name: "CA - LANÇAMENTOS" },
  { id: "711764884898637", name: "CA - INSTITUCIONAL" },
];

function dateRange(days) {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - days);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { since: fmt(from), until: fmt(to) };
}

async function fetchAllPages(url) {
  const rows = [];
  let next = url;
  while (next) {
    const res = await fetch(next);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Meta API request failed: ${res.status} ${res.statusText} — ${body.slice(0, 300)}`);
    }
    const body = await res.json();
    rows.push(...(body.data || []));
    next = body.paging && body.paging.next ? body.paging.next : null;
  }
  return rows;
}

function leadsFromActions(actions) {
  if (!Array.isArray(actions)) return 0;
  const byType = new Map(actions.map((a) => [a.action_type, Number(a.value || 0)]));
  if (byType.has("onsite_conversion.lead_grouped")) return byType.get("onsite_conversion.lead_grouped");
  return byType.get("lead") || 0;
}

async function fetchAdRows(account, since, until) {
  const params = new URLSearchParams({
    level: "ad",
    fields: "ad_id,ad_name,campaign_name,adset_name,spend,impressions,clicks,ctr,cpc,actions",
    time_range: JSON.stringify({ since, until }),
    time_increment: "1",
    limit: "500",
    access_token: TOKEN,
  });
  const url = `https://graph.facebook.com/${API_VERSION}/act_${account.id}/insights?${params.toString()}`;
  const rows = await fetchAllPages(url);
  return rows.map((r) => {
    const spend = Number(r.spend || 0);
    const leads = leadsFromActions(r.actions);
    return {
      date: r.date_start,
      account: account.name,
      ad_id: r.ad_id,
      ad_name: r.ad_name || "",
      campaign: r.campaign_name || "",
      adset: r.adset_name || "",
      spend,
      impressions: Number(r.impressions || 0),
      clicks: Number(r.clicks || 0),
      ctr: Number(r.ctr || 0),
      leads,
      cost_per_lead: leads > 0 ? spend / leads : null,
    };
  });
}

async function fetchChannelRows(account, since, until) {
  const params = new URLSearchParams({
    level: "account",
    fields: "spend,impressions,clicks,actions",
    breakdowns: "publisher_platform,platform_position",
    time_range: JSON.stringify({ since, until }),
    time_increment: "1",
    limit: "500",
    access_token: TOKEN,
  });
  const url = `https://graph.facebook.com/${API_VERSION}/act_${account.id}/insights?${params.toString()}`;
  const rows = await fetchAllPages(url);
  return rows.map((r) => {
    const spend = Number(r.spend || 0);
    const leads = leadsFromActions(r.actions);
    return {
      date: r.date_start,
      account: account.name,
      platform: r.publisher_platform || "—",
      position: r.platform_position || "—",
      spend,
      impressions: Number(r.impressions || 0),
      clicks: Number(r.clicks || 0),
      leads,
      cost_per_lead: leads > 0 ? spend / leads : null,
    };
  });
}

function extractFormId(creative) {
  const spec = creative && creative.object_story_spec;
  if (!spec) return null;
  const cta = (spec.video_data && spec.video_data.call_to_action) || (spec.link_data && spec.link_data.call_to_action);
  return (cta && cta.value && cta.value.lead_gen_form_id) || null;
}

async function fetchCreativeDetail(adId) {
  const params = new URLSearchParams({
    fields: "creative{thumbnail_url,object_type,object_story_spec}",
    access_token: TOKEN,
  });
  const url = `https://graph.facebook.com/${API_VERSION}/${adId}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const body = await res.json();
  const creative = body.creative;
  if (!creative) return null;
  return {
    thumbnail_url: creative.thumbnail_url || null,
    object_type: creative.object_type || null,
    lead_gen_form_id: extractFormId(creative),
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const { since, until } = dateRange(DAYS_BACK);
  const adRows = [];
  const channelRows = [];

  for (const account of AD_ACCOUNTS) {
    const ads = await fetchAdRows(account, since, until);
    adRows.push(...ads);
    console.log(`Fetched ${ads.length} ad-day rows for ${account.name}`);

    const channels = await fetchChannelRows(account, since, until);
    channelRows.push(...channels);
    console.log(`Fetched ${channels.length} channel-day rows for ${account.name}`);
  }

  const outPath = path.join(__dirname, "..", "data", "creatives.json");

  // Creative thumbnails/lead-form IDs are effectively static once an ad is
  // live — no point re-fetching them on every 15-minute refresh. Frequent
  // runs (SKIP_CREATIVE_DETAILS=true) carry forward whatever was cached by
  // the last full run instead of hitting the per-ad endpoint again.
  let creatives = {};
  if (process.env.SKIP_CREATIVE_DETAILS === "true") {
    try {
      const previous = JSON.parse(fs.readFileSync(outPath, "utf8"));
      creatives = previous.creatives || {};
      console.log(`Skipping creative detail fetch, carried forward ${Object.keys(creatives).length} cached entries`);
    } catch (err) {
      console.log(`No previous creatives.json to carry forward (${err.message})`);
    }
  } else {
    // Rank ads by total spend over the whole window and fetch creative
    // thumbnails only for the top N — keeps the daily API call volume small.
    const spendByAd = new Map();
    for (const r of adRows) {
      spendByAd.set(r.ad_id, (spendByAd.get(r.ad_id) || 0) + r.spend);
    }
    const topAdIds = Array.from(spendByAd.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_CREATIVES_WITH_THUMB)
      .map(([id]) => id);

    for (const adId of topAdIds) {
      try {
        const detail = await fetchCreativeDetail(adId);
        if (detail) creatives[adId] = detail;
      } catch (err) {
        console.log(`Skipping creative detail for ad ${adId}: ${err.message}`);
      }
      await sleep(150);
    }
    console.log(`Fetched creative detail for ${Object.keys(creatives).length}/${topAdIds.length} top ads`);
  }

  const payload = {
    generated_at: new Date().toISOString(),
    source: "meta-marketing-api",
    days_back: DAYS_BACK,
    ad_rows: adRows,
    channel_rows: channelRows,
    creatives,
  };

  fs.writeFileSync(outPath, JSON.stringify(payload));
  console.log(`Wrote ${adRows.length} ad rows, ${channelRows.length} channel rows to ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
