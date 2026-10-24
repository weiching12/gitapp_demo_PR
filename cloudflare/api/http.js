export function json(request, body, status = 200, cache = "no-store", headers = {}) {
  return new Response(request.method === "HEAD" ? null : JSON.stringify(body), {
    status, headers: { "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": cache, "X-Content-Type-Options": "nosniff", ...headers },
  });
}
export function error(request, versioned, code, message, status, headers) {
  return json(request, versioned ? { error: { code, message } } : { error: message }, status, "no-store", headers);
}
