import { NextRequest, NextResponse } from "next/server";
import { serverEnv } from "@/lib/env.server";

const SOROSWAP_API_URL = "https://api.soroswap.finance";

/**
 * SoroSwap API proxy (catch-all).
 *
 * Forwards ALL requests — regardless of HTTP method, path, or query — to the
 * SoroSwap REST API with the server-side API key, so the key never appears in
 * the browser bundle.
 *
 * The SoroswapSDK is configured with `baseUrl: "/api/soroswap-proxy"` when
 * no per-user localStorage key exists, so the SDK's internal fetch calls
 * (e.g. GET /api/soroswap-proxy/quote?network=testnet) hit this handler.
 */
export async function GET(req: NextRequest) {
  return proxy(req);
}

export async function POST(req: NextRequest) {
  return proxy(req);
}

export async function PUT(req: NextRequest) {
  return proxy(req);
}

export async function DELETE(req: NextRequest) {
  return proxy(req);
}

async function proxy(req: NextRequest): Promise<NextResponse> {
  const serverApiKey = serverEnv.SOROSWAP_API_KEY;
  if (!serverApiKey) {
    return NextResponse.json(
      { error: "SoroSwap API key not configured on server" },
      { status: 502 }
    );
  }

  try {
    const url = new URL(req.url);
    // Strip the proxy prefix and rebuild the SoroSwap target URL.
    const proxyPrefix = "/api/soroswap-proxy";
    const pathAfterProxy = url.pathname.slice(proxyPrefix.length) || "/";
    const targetUrl = `${SOROSWAP_API_URL}${pathAfterProxy}${url.search}`;

    const headers = new Headers(req.headers);
    // Replace the client's (dummy) Authorization header with the server key.
    headers.set("Authorization", `Bearer ${serverApiKey}`);

    const body =
      req.method !== "GET" && req.method !== "HEAD"
        ? await req.text()
        : undefined;

    const apiRes = await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
    });

    const contentType = apiRes.headers.get("content-type") ?? "";
    const isJson = contentType.includes("application/json");

    if (!apiRes.ok) {
      const data = isJson ? await apiRes.json() : await apiRes.text();
      if (isJson) {
        return NextResponse.json(data, { status: apiRes.status });
      }
      return new NextResponse(data, { status: apiRes.status });
    }

    if (isJson) {
      const data = await apiRes.json();
      return NextResponse.json(data);
    }

    const text = await apiRes.text();
    return new NextResponse(text, {
      headers: { "Content-Type": contentType },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Proxy error" },
      { status: 502 }
    );
  }
}
