/**
 * Pyth Benchmarks proxy — caches intraday history at the edge.
 */
export const config = {
  runtime: "edge",
};

const UPSTREAM = "https://benchmarks.pyth.network";
const PREFIX = "/api/pyth/";

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(PREFIX)) {
    return new Response("Not found", { status: 404 });
  }

  const pythPath = url.pathname.slice(PREFIX.length);
  const target = `${UPSTREAM}/${pythPath}${url.search}`;

  const upstream = await fetch(target, {
    headers: {
      accept: "application/json",
      "user-agent": "ProjectCrossBar/1.0",
    },
  });

  const body = await upstream.text();
  const cacheSeconds = upstream.ok ? 120 : 15;

  return new Response(body, {
    status: upstream.status,
    headers: {
      "content-type": "application/json",
      "cache-control": `public, s-maxage=${cacheSeconds}, stale-while-revalidate=300`,
    },
  });
}
