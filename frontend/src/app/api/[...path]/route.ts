import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const BACKEND_BASE_URL =
  process.env.CALCULATIETOOL_BACKEND_INTERNAL_URL ?? "http://localhost:8000/api";

type RouteContext = {
  params: Promise<{
    path?: string[];
  }>;
};

async function proxy(request: NextRequest, context: RouteContext) {
  const resolved = await context.params;
  const path = (resolved.path ?? []).join("/");
  const targetUrl = `${BACKEND_BASE_URL}/${path}${request.nextUrl.search}`;

  const headers = new Headers(request.headers);
  headers.delete("host");
  headers.delete("content-length");

  const method = request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();

  const response = await fetch(targetUrl, {
    method,
    headers,
    body: body && body.byteLength > 0 ? body : undefined,
    redirect: "manual"
  });

  const outHeaders = new Headers(response.headers);
  // Avoid leaking backend-specific compression headers through the proxy.
  outHeaders.delete("content-encoding");
  outHeaders.delete("content-length");

  // `set-cookie` is special: it may contain multiple values and isn't reliably copied by `new Headers()`.
  // Forward it explicitly so browser sessions are established correctly.
  outHeaders.delete("set-cookie");
  const headerAny = response.headers as any;
  const setCookies: string[] =
    typeof headerAny.getSetCookie === "function"
      ? (headerAny.getSetCookie() as string[])
      : [];
  const singleSetCookie = response.headers.get("set-cookie");
  if (singleSetCookie) {
    setCookies.push(singleSetCookie);
  }
  for (const cookie of setCookies) {
    if (cookie) {
      outHeaders.append("set-cookie", cookie);
    }
  }

  const nextResponse = new NextResponse(response.body, {
    status: response.status,
    headers: outHeaders
  });

  return nextResponse;
}

export function GET(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export function POST(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export function PUT(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export function PATCH(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export function DELETE(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}

export function OPTIONS(request: NextRequest, context: RouteContext) {
  return proxy(request, context);
}
