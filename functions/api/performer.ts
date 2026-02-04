// /api/performer — server-side proxy to fetch a single performer by brand+name.
// Used by static profile pages to refresh live status + room/iframe URLs without exposing CRAK secrets.
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
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);

  const brand = (url.searchParams.get("brand") || url.searchParams.get("brands") || "").trim();
  const name = (url.searchParams.get("name") || "").trim();

  if (!brand || !name) {
    return new Response(JSON.stringify({ ok: false, error: "Missing brand and/or name" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" }
    });
  }

  if (!env?.CRAK_API_KEY || !env?.CRAK_TOKEN) {
    return new Response(JSON.stringify({ ok: false, error: "Missing CRAK env vars" }), {
      status: 500,
      headers: { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" }
    });
  }

  const api = new URL("https://performersext-api.pcvdaa.com/performers-ext");
  api.searchParams.set("token", env.CRAK_TOKEN);
  api.searchParams.set("brands", brand);
  api.searchParams.set("name", name);
  api.searchParams.set("page", "1");
  api.searchParams.set("size", "1");

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
    // The upstream API caches performers for 30s; keep this lightweight but fresh.
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
  const first = Array.isArray(list) && list.length ? pick(list[0]) : null;

  if (!first) {
    return new Response(JSON.stringify({ ok: false, notFound: true }), { status: 200, headers });
  }

  return new Response(JSON.stringify({ ok: true, performer: first }), { status: 200, headers });
};
