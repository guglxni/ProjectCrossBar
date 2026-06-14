/**
 * CoinGecko proxy for the dashboard. Browsers share one IP and hit the free-tier
 * rate limit quickly; this route centralizes calls and caches responses at the edge.
 */
export const config = {
  runtime: "edge",
};

const UPSTREAM = "https://api.coingecko.com/api/v3";
const PREFIX = "/api/coingecko/";

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(PREFIX)) {
    return new Response("Not found", { status: 404 });
  }

  const cgPath = url.pathname.slice(PREFIX.length);
  const target = `${UPSTREAM}/${cgPath}${url.search}`;

  const upstream = await fetch(target, {
    headers: {
      accept: "application/json",
      "user-agent": "ProjectCrossBar/1.0",
      ...(process.env.COINGECKO_API_KEY
        ? { "x-cg-demo-api-key": process.env.COINGECKO_API_KEY }
        : {}),
    },
  });

  const body = await upstream.text();
  const cacheSeconds = upstream.ok ? 90 : 15;

  return new Response(body, {
    status: upstream.status,
    headers: {
      "content-type": "application/json",
      "cache-control": `public, s-maxage=${cacheSeconds}, stale-while-revalidate=180`,
    },
  });
}
