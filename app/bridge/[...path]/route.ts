import type { NextRequest } from "next/server";

type RouteContext = { params: Promise<{ path: string[] }> };

async function proxy(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  if (!path?.length || path[0] !== "api") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const upstreamBase = process.env.CODEX_BRIDGE_UPSTREAM || "http://127.0.0.1:43110";
  const incoming = new URL(request.url);
  const target = new URL(path.map(encodeURIComponent).join("/"), `${upstreamBase.replace(/\/+$/, "")}/`);
  target.search = incoming.search;

  const headers = new Headers(request.headers);
  for (const name of ["host", "origin", "referer", "connection", "content-length"]) headers.delete(name);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: "manual",
    cache: "no-store",
  });

  const responseHeaders = new Headers(upstream.headers);
  for (const name of ["content-encoding", "content-length", "transfer-encoding", "connection"]) responseHeaders.delete(name);
  responseHeaders.set("Cache-Control", "no-store");
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
}

export const dynamic = "force-dynamic";
export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
