import { defineConfig } from "vite";
import { createHash } from "node:crypto";

function pwaServiceWorker() {
  return {
    name: "stock-insight-pwa",
    apply: "build",
    generateBundle(_, bundle) {
      const files = Object.values(bundle)
        .map((item) => `/${item.fileName}`)
        .filter((file) => !file.endsWith(".map") && file !== "/sw.js")
        .sort();
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: serviceWorkerSource(files, bundle),
      });
    },
  };
}

function serviceWorkerSource(files, bundle) {
  const version = createHash("sha256").update(Object.values(bundle).map((item) =>
    `${item.fileName}:${item.type === "asset" ? String(item.source) : item.code}`).join("|")).digest("hex").slice(0, 16);
  return `const SHELL_CACHE = ${JSON.stringify(`stock-insight-shell-${version}`)};
const DATA_CACHE = "stock-insight-market-v1";
const APP_SHELL = ${JSON.stringify(["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", ...files])};

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith("stock-insight-shell-") && key !== SHELL_CACHE)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

const cachedFallback = async (request, cacheName) => {
  const cached = await caches.match(request, { cacheName });
  if (!cached) throw new Error("No cached response");
  const headers = new Headers(cached.headers);
  headers.set("X-PWA-Cache", "fallback");
  return new Response(cached.body, { status: cached.status, statusText: cached.statusText, headers });
};

const trimCache = async (cache, limit = 160) => {
  const keys = (await cache.keys()).filter((key) => /^\\/api\\/market\\/[a-z0-9-]+\\/\\d+$/.test(new URL(key.url).pathname));
  await Promise.all(keys.slice(0, Math.max(0, keys.length - limit)).map((key) => cache.delete(key)));
};

const networkFirst = async (request, cacheName) => {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      await cache.put(request, response.clone());
      if (cacheName === DATA_CACHE) await trimCache(cache);
    }
    return response;
  } catch {
    return cachedFallback(request, cacheName);
  }
};

const cacheFirst = async (request, cacheName) => {
  const cached = await caches.match(request, { cacheName });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(cacheName);
    await cache.put(request, response.clone());
    if (cacheName === DATA_CACHE) await trimCache(cache);
  }
  return response;
};

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/api/presence") return;
  if (url.pathname === "/api/market" || url.pathname.startsWith("/api/stocks/")) {
    event.respondWith(networkFirst(request, DATA_CACHE));
    return;
  }
  if (/^\\/api\\/market\\/[a-z0-9-]+\\/\\d+$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request, DATA_CACHE));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request, SHELL_CACHE).catch(() => caches.match("/")));
    return;
  }
  event.respondWith(cacheFirst(request, SHELL_CACHE));
});
`;
}

export default defineConfig(({ mode }) => ({
  plugins: [pwaServiceWorker()],
  define: {
    "import.meta.env.VITE_DATA_MODE": JSON.stringify(mode === "cloudflare" ? "api" : "demo"),
  },
}));
