import type { VercelRequest, VercelResponse } from "@vercel/node";

/**
 * CoinGecko proxy for Vercel only. Browser calls CoinGecko direct first;
 * this handler adds a User-Agent and optional API key when the upstream
 * blocks datacenter IPs (403) or free-tier limits bite.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.setHeader("Allow", "GET, HEAD");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const segments = req.query.path;
  const pathPart = Array.isArray(segments) ? segments.join("/") : (segments ?? "");
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(req.query)) {
    if (key === "path") continue;
    if (Array.isArray(value)) {
      for (const v of value) qs.append(key, String(v));
    } else if (value != null) {
      qs.set(key, String(value));
    }
  }

  const upstream = `https://api.coingecko.com/api/v3/${pathPart}${
    qs.toString() ? `?${qs}` : ""
  }`;

  const headers: Record<string, string> = {
    accept: "application/json",
    "User-Agent": "ProjectCrossBar/1.0 (+https://projectcrossbar.vercel.app)",
  };

  const proKey = process.env.COINGECKO_PRO_API_KEY ?? process.env.COINGECKO_API_KEY;
  const demoKey = process.env.COINGECKO_DEMO_API_KEY;
  if (proKey) headers["x-cg-pro-api-key"] = proKey;
  else if (demoKey) headers["x-cg-demo-api-key"] = demoKey;

  try {
    const upstreamRes = await fetch(upstream, {
      method: req.method,
      headers,
    });

    res.setHeader("Content-Type", upstreamRes.headers.get("content-type") ?? "application/json");
    res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");

    if (req.method === "HEAD") {
      return res.status(upstreamRes.status).end();
    }

    const body = await upstreamRes.text();
    return res.status(upstreamRes.status).send(body);
  } catch (e) {
    return res.status(502).json({ error: String(e) });
  }
}
