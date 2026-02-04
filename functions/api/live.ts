import { CATALOG_SET } from "../_generated/catalog";
// /api/live — server-side proxy to the CrakRevenue performers API
// This avoids exposing your CRAK_TOKEN to the browser.
export interface Env {
  CRAK_API_KEY: string;
  CRAK_TOKEN: string;
  CRAK_UA?: string;
}

function pick(p: any) {
  return {
    itemId: p.itemId,
    name: p.name,
    nameClean: p.nameClean || p.name,
    live: p.live,
    thumbnailUrl: p.thumbnailUrl || p.thumbnail || p.thumb,
    roomUrl: p.roomUrl || p.roomURL || p.url,
    iframeFeedURL: p.iframeFeedURL || p.iframeFeedUrl,
    systemSource: p.systemSource || p.source || p.brand,
    stars: p.stars,
    characteristic: p.characteristic || {},
  };


function isLiveVal(v: any): boolean {
  if (v === true || v === 1 || v === "1") return true;
  const s = String(v ?? "").toLowerCase();
  return s === "true" || s === "live";
}

function normToken(s: any): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractTags(p: any): string[] {
  const out: string[] = [];
  const add = (arr: any) => {
    if (Array.isArray(arr)) for (const x of arr) if (typeof x === "string") out.push(x);
  };
  add(p?.customTags);
  add(p?.characteristicsTags);
  add(p?.autoTags);
  add(p?.tags);
  add(p?.characteristic?.tags);
  return out;
}

function hasTopic(p: any, topic: string): boolean {
  const raw = String(topic || "").trim();
  if (!raw) return true;
  const wants = raw.split(",").map(x => normToken(x)).filter(Boolean);
  if (!wants.length) return true;
  const tags = extractTags(p).map(normToken).filter(Boolean).join(" ");
  if (!tags) return false;
  return wants.some(w => tags.includes(w));
}
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);

  const page = url.searchParams.get("page") || "1";
  const size = url.searchParams.get("size") || "24";
  const gender = url.searchParams.get("gender") || "";
  const brands = url.searchParams.get("brands") || "";
  const live = url.searchParams.get("live") || "true";
  const topic = url.searchParams.get("topic") || "";

  if (!env?.CRAK_API_KEY || !env?.CRAK_TOKEN) {
    return new Response(JSON.stringify({ ok: false, error: "Missing CRAK env vars" }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }

  const api = new URL("https://performersext-api.pcvdaa.com/performers-ext");
  api.searchParams.set("token", env.CRAK_TOKEN);
  api.searchParams.set("page", page);
  api.searchParams.set("size", size);
  api.searchParams.set("sorting", "score");
  if (brands) api.searchParams.set("brands", brands);
  if (gender) api.searchParams.set("gender", gender);
  if (live) api.searchParams.set("live", live);

  const ua = env.CRAK_UA || (new URL("https://nitevelour.com")).hostname;

  const res = await fetch(api.toString(), {
    headers: {
      "x-api-key": env.CRAK_API_KEY,
      "User-Agent": ua,
      "accept": "application/json"
    }
  });

  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "cache-control": "no-store"
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return new Response(JSON.stringify({ ok: false, status: res.status, error: txt.slice(0, 400) }), {
      status: 502,
      headers
    });
  }

  const data = await res.json();
  const list = Array.isArray(data?.data) ? data.data : (Array.isArray(data?.performers) ? data.performers : []);

  const wantLive = !["false","0","no","off"].includes(String(live || "").toLowerCase());

  // Always filter to IDs that exist in our generated catalog so profiles resolve.
  let rawList = list.filter((p: any) => p?.itemId && CATALOG_SET.has(String(p.itemId)));

  // Hard filter by live status when requested (the upstream API can be laggy).
  if (wantLive) rawList = rawList.filter((p: any) => isLiveVal(p?.live));

  let topicApplied = false;
  if (topic) {
    const filtered = rawList.filter((p: any) => hasTopic(p, topic));
    if (filtered.length) {
      rawList = filtered;
      topicApplied = true;
    }
  }

  const performers = rawList.map(pick);
  const topicFallback = Boolean(topic) && !topicApplied;

  return new Response(JSON.stringify({ ok: true, performers, topicApplied, topicFallback }), { status: 200, headers });
};
