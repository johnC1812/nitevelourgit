// functions/api/performer.ts
//
// Fetch a single performer (used by static profile pages to refresh live status + URLs).
// Query params:
// - brand (or brands): required
// - name: required
//
// Returns:
//   { ok: true, performer: {...} }   OR   { ok: true, performer: null, notFound: true }

export interface Env {
  CRAK_API_KEY?: string;
  CRAK_KEY?: string; // backward compat
  CRAK_TOKEN?: string;
  CRAK_UA?: string;
}

const UPSTREAM_BASE = "https://performersext-api.pcvdaa.com/performers-ext";

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

function pick(p: any) {
  return {
    itemId: p?.itemId ?? "",
    name: p?.name ?? "",
    nameClean: p?.nameClean ?? p?.name ?? "",
    live: p?.live ?? false,
    thumbnailUrl: p?.thumbnailUrl ?? p?.thumbnail ?? p?.thumb ?? "",
    roomUrl: p?.roomUrl ?? p?.roomURL ?? p?.url ?? "",
    iframeFeedURL: p?.iframeFeedURL ?? p?.iframeFeedUrl ?? "",
    systemSource: p?.systemSource ?? p?.source ?? p?.brand ?? "",
    stars: p?.stars ?? null,
    characteristic: p?.characteristic ?? {},
  };
}

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, { status: 204, headers: corsHeaders() });
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);

  const brand = (url.searchParams.get("brand") || url.searchParams.get("brands") || "").trim();
  const name = (url.searchParams.get("name") || "").trim();
  const debug = (url.searchParams.get("debug") || "").trim() === "1";

  if (!brand || !name) {
    return json({ ok: false, error: "Missing brand and/or name" }, { status: 400, headers: { "cache-control": "no-store" } });
  }

  const token = (env?.CRAK_TOKEN || "").trim();
  const apiKey = (env?.CRAK_API_KEY || env?.CRAK_KEY || "").trim();
  const ua = (env?.CRAK_UA || url.hostname || "nitevelour").trim();

  if (!token || !apiKey) {
    return json(
      { ok: false, error: "Missing secrets. Set CRAK_TOKEN and CRAK_API_KEY in Cloudflare Pages env vars." },
      { status: 500, headers: { "cache-control": "no-store" } }
    );
  }

  const upstream = new URL(UPSTREAM_BASE);
  upstream.searchParams.set("token", token);
  upstream.searchParams.set("brands", brand);
  upstream.searchParams.set("name", name);
  upstream.searchParams.set("page", "1");
  upstream.searchParams.set("size", "1");

  const headers = new Headers({
    accept: "application/json",
    authorization: `Bearer ${token}`,
    "x-api-key": apiKey,
    "user-agent": ua,
  });

  const res = await fetch(upstream.toString(), { headers, cf: { cacheTtl: 0 } as any });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return json(
      { ok: false, error: `Upstream ${res.status}`, detail: txt.slice(0, 400) },
      { status: 502, headers: { "cache-control": "no-store" } }
    );
  }

  const data = await res.json().catch(() => null);
  const list = Array.isArray((data as any)?.data)
    ? (data as any).data
    : Array.isArray((data as any)?.performers)
      ? (data as any).performers
      : [];

  const first = Array.isArray(list) && list.length ? pick(list[0]) : null;

  return json(
    { ok: true, performer: first, notFound: !first, ...(debug ? { debug: { brand, name } } : {}) },
    { status: 200, headers: { "cache-control": "no-store" } }
  );
};
