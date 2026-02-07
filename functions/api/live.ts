// functions/api/live.ts
//
// Live feed endpoint consumed by the homepage + /live/ directory.
// Returns: { ok: true, performers: [...], count, page, size, filters... }
//
// Key goals:
// - NEVER depend on generated/imported allowlists (prevents /api/live build failures).
// - Pass through brands/gender filters to upstream.
// - Optional topic filter (tag-based) with fallback mode.
// - Stable JSON shape for the frontend.

export interface Env {
  CRAK_TOKEN?: string;
  CRAK_API_KEY?: string;
  CRAK_KEY?: string; // backward compat
  CRAK_UA?: string;
}

const UPSTREAM_BASE = "https://performersext-api.pcvdaa.com/performers-ext";

function safeInt(n: unknown, def: number, min: number, max: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return def;
  return Math.max(min, Math.min(max, Math.trunc(v)));
}

function asBool(v: string | null, def: boolean) {
  if (v == null) return def;
  const s = v.trim().toLowerCase();
  if (["1", "true", "yes", "y"].includes(s)) return true;
  if (["0", "false", "no", "n"].includes(s)) return false;
  return def;
}

function corsHeaders(extra?: HeadersInit) {
  const h = new Headers(extra);
  h.set("content-type", "application/json; charset=utf-8");
  h.set("access-control-allow-origin", "*");
  h.set("access-control-allow-methods", "GET, OPTIONS");
  h.set("access-control-allow-headers", "*");
  return h;
}

function json(data: unknown, init: ResponseInit = {}) {
  const headers = corsHeaders(init.headers);
  return new Response(JSON.stringify(data, null, 2), { ...init, headers });
}

// Keep payload small and stable for the front-end renderer.
function pick(p: any) {
  return {
    itemId: p?.itemId ?? "",
    systemSource: p?.systemSource ?? p?.source ?? p?.brand ?? "",
    name: p?.name ?? "",
    nameClean: p?.nameClean ?? p?.name ?? "",
    gender: p?.gender ?? p?.characteristic?.gender ?? p?.characteristic?.genderCode ?? "",
    live: p?.live ?? false,
    roomUrl: p?.roomUrl ?? p?.roomURL ?? p?.url ?? "",
    iframeFeedURL: p?.iframeFeedURL ?? p?.iframeFeedUrl ?? "",
    thumbnailUrl: p?.thumbnailUrl ?? p?.thumbnail ?? p?.thumb ?? "",
    tags: p?.tags ?? p?.characteristic ?? {},
  };
}

function extractTagTokens(p: any): string[] {
  const out: string[] = [];
  const t = p?.tags ?? p?.characteristic ?? {};

  // tags as object: { bdsm: true, cosplay: true }
  if (t && typeof t === "object" && !Array.isArray(t)) {
    for (const [k, v] of Object.entries(t)) {
      if (v) out.push(String(k).toLowerCase());
    }
    return out;
  }

  // tags as array: ["bdsm","cosplay"]
  if (Array.isArray(t)) {
    for (const x of t) out.push(String(x).toLowerCase());
    return out;
  }

  return out;
}

function matchesTopic(p: any, topic: string): boolean {
  const wants = String(topic || "")
    .toLowerCase()
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  if (!wants.length) return true;

  const tags = extractTagTokens(p);
  return wants.some(w => tags.includes(w));
}

async function fetchUpstream(url: URL, headers: Headers, timeoutMs: number) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url.toString(), {
      headers,
      signal: controller.signal,
      cf: { cacheTtl: 0 } as any,
    });
  } finally {
    clearTimeout(t);
  }
}

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, { status: 204, headers: corsHeaders() });
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);

  const page = safeInt(url.searchParams.get("page"), 1, 1, 500);
  const size = safeInt(url.searchParams.get("size"), 24, 1, 60);
  const liveOnly = asBool(url.searchParams.get("live"), true);

  // Frontend sends these:
  const brands = (url.searchParams.get("brands") || "").trim(); // comma-separated
  const gender = (url.searchParams.get("gender") || "").trim(); // upstream-dependent
  const sorting = (url.searchParams.get("sorting") || "score").trim();

  // Topic is local filtering (tag-based), because upstream support varies.
  const topic = (url.searchParams.get("topic") || "").trim();
  const strictTopic = asBool(url.searchParams.get("strictTopic"), false);
  const debug = asBool(url.searchParams.get("debug"), false);

  const token = (env?.CRAK_TOKEN || "").trim();
  const apiKey = (env?.CRAK_API_KEY || env?.CRAK_KEY || "").trim();
  const ua = (env?.CRAK_UA || url.hostname || "nitevelour").trim();

  if (!token || !apiKey) {
    return json(
      { ok: false, error: "Missing secrets. Set CRAK_TOKEN and CRAK_API_KEY in Cloudflare Pages env vars." },
      { status: 500, headers: { "cache-control": "no-store" } }
    );
  }

  const headers = new Headers({
    accept: "application/json",
    authorization: `Bearer ${token}`,
    "x-api-key": apiKey,
    "user-agent": ua,
  });

  // Fast path: no topic filtering, just proxy page/size through.
  if (!topic) {
    const u = new URL(UPSTREAM_BASE);
    u.searchParams.set("token", token); // keep both styles for compatibility
    u.searchParams.set("page", String(page));
    u.searchParams.set("size", String(size));
    u.searchParams.set("sorting", sorting || "score");
    if (liveOnly) u.searchParams.set("live", "true");
    if (brands) u.searchParams.set("brands", brands);
    if (gender) u.searchParams.set("gender", gender);

    const res = await fetchUpstream(u, headers, 8000);
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return json(
        { ok: false, error: `Upstream ${res.status}`, detail: txt.slice(0, 300) },
        { status: 502, headers: { "cache-control": "no-store" } }
      );
    }

    const data = await res.json().catch(() => null);
    const items = Array.isArray((data as any)?.performers)
      ? (data as any).performers
      : Array.isArray((data as any)?.data)
        ? (data as any).data
        : [];

    const performers = items.map(pick);

    return json(
      {
        ok: true,
        performers,
        count: performers.length,
        page,
        size,
        filters: { live: liveOnly, brands, gender, sorting },
      },
      {
        status: 200,
        headers: {
          "cache-control": debug ? "no-store" : "public, max-age=0, s-maxage=10, stale-while-revalidate=20",
        },
      }
    );
  }

  // Topic mode: scan a few upstream pages to find matches.
  const wantCount = page * size;
  const maxScanPages = 10; // keep it bounded
  const upstreamPageSize = 100;

  const all: any[] = [];
  const hits: any[] = [];
  const seen = new Set<string>();

  for (let p = 1; p <= maxScanPages && (strictTopic ? hits.length : all.length) < wantCount; p++) {
    const u = new URL(UPSTREAM_BASE);
    u.searchParams.set("token", token);
    u.searchParams.set("page", String(p));
    u.searchParams.set("size", String(upstreamPageSize));
    u.searchParams.set("sorting", sorting || "score");
    if (liveOnly) u.searchParams.set("live", "true");
    if (brands) u.searchParams.set("brands", brands);
    if (gender) u.searchParams.set("gender", gender);

    const res = await fetchUpstream(u, headers, 9000);
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return json(
        { ok: false, error: `Upstream ${res.status}`, detail: txt.slice(0, 300) },
        { status: 502, headers: { "cache-control": "no-store" } }
      );
    }

    const data = await res.json().catch(() => null);
    const items = Array.isArray((data as any)?.performers)
      ? (data as any).performers
      : Array.isArray((data as any)?.data)
        ? (data as any).data
        : [];

    for (const it of items) {
      const id = String(it?.itemId || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);

      all.push(it);
      if (matchesTopic(it, topic)) hits.push(it);
    }
  }

  const baseList = strictTopic
    ? hits
    : (hits.length ? hits : all); // fallback to unfiltered if no hits (non-strict)

  const start = (page - 1) * size;
  const performers = baseList.slice(start, start + size).map(pick);

  return json(
    {
      ok: true,
      performers,
      count: performers.length,
      page,
      size,
      filters: { live: liveOnly, brands, gender, sorting, topic, strictTopic },
      topicApplied: Boolean(topic && (strictTopic ? true : hits.length > 0)),
      topicFallback: Boolean(topic && !strictTopic && hits.length === 0),
      ...(debug ? { debug: { scannedPages: maxScanPages, seen: seen.size, total: all.length, hits: hits.length } } : {}),
    },
    {
      status: 200,
      headers: {
        "cache-control": debug ? "no-store" : "public, max-age=0, s-maxage=10, stale-while-revalidate=20",
      },
    }
  );
};
