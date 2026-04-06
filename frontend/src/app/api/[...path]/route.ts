import { NextRequest, NextResponse } from "next/server";

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

  const response = await fetch(targetUrl, {
    method: request.method,
    headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual"
  });

  const outHeaders = new Headers(response.headers);
  // Avoid leaking backend-specific compression headers through the proxy.
  outHeaders.delete("content-encoding");
  outHeaders.delete("content-length");

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
