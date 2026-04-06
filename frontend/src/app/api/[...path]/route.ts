import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const BACKEND_BASE_URL =
  process.env.CALCULATIETOOL_BACKEND_INTERNAL_URL ?? "http://127.0.0.1:8000/api";

type RouteContext = {
  params: Promise<{
    path?: string[];
  }>;
};

async function proxy(request: NextRequest, context: RouteContext) {
  try {
    const resolved = await context.params;
    const path = (resolved.path ?? []).join("/");
    const targetUrl = `${BACKEND_BASE_URL}/${path}${request.nextUrl.search}`;

    // Copy request headers, but strip hop-by-hop + headers that break proxying.
    const headers = new Headers(request.headers);
    headers.delete("host");
    headers.delete("connection");
    headers.delete("keep-alive");
    headers.delete("transfer-encoding");
    headers.delete("upgrade");
    headers.delete("content-length");
    headers.delete("expect");

    const method = request.method.toUpperCase();
    const bodyText = method === "GET" || method === "HEAD" ? undefined : await request.text();

    const response = await fetch(targetUrl, {
      method,
      headers,
      body: bodyText && bodyText.length > 0 ? bodyText : undefined,
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
      typeof headerAny.getSetCookie === "function" ? (headerAny.getSetCookie() as string[]) : [];
    const singleSetCookie = response.headers.get("set-cookie");
    if (singleSetCookie) {
      setCookies.push(singleSetCookie);
    }
    for (const cookie of setCookies) {
      if (cookie) {
        outHeaders.append("set-cookie", cookie);
      }
    }

    return new NextResponse(response.body, {
      status: response.status,
      headers: outHeaders
    });
  } catch (error) {
    const err = error as any;
    const message = error instanceof Error ? error.message : String(error);
    const cause = err?.cause;
    const causeMessage =
      cause instanceof Error
        ? cause.message
        : typeof cause === "string"
          ? cause
          : cause
            ? JSON.stringify(cause)
            : "";
    const details = {
      message,
      cause: causeMessage,
      code: String(cause?.code ?? err?.code ?? ""),
      address: String(cause?.address ?? ""),
      port: String(cause?.port ?? "")
    };
    return NextResponse.json(
      { error: "api_proxy_failed", ...details },
      { status: 500 }
    );
  }
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
