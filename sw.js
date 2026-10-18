/* Service worker 3D Music Dancer (PWA).
 * Оболочка (html/css/js/иконки/UI) — в precache при установке.
 * Всё остальное (модели, анимации, видео, mp3, Three.js с unpkg) — кэшируется
 * при первом использовании, дальше работает офлайн.
 * Чтобы выкатить обновление: поменяйте VERSION. */
const VERSION = "v13";
const SHELL_CACHE = "md-shell-" + VERSION;
const RUNTIME_CACHE = "md-runtime-" + VERSION;
const CDN = [
  "https://unpkg.com/three@0.160.0/build/three.module.js",
  "https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js",
  "https://unpkg.com/three@0.160.0/examples/jsm/loaders/FBXLoader.js",
  "https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js",
];
const SHELL = [
  "./",
  "index.html",
  "style.css",
  "manifest.webmanifest",
  "js/animationController.js",
  "js/audioAnalyzer.js",
  "js/audioPlayer.js",
  "js/beatDetector.js",
  "js/characterStorage.js",
  "js/discoLights.js",
  "js/i18n.js",
  "js/main.js",
  "js/playlistStorage.js",
  "js/scene.js",
  "js/soundWave.js",
  "js/starTunnel.js",
  "js/waveform.js",
  "assets/ui/ball-shockwave.png",
  "assets/ui/raccoon-avatar.png",
  "assets/ui/squirrel-avatar.png",
  "assets/ui/wave-mode-icon.jpg",
  "assets/icons/apple-touch-icon.png",
  "assets/icons/favicon-32.png",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/maskable-192.png",
  "assets/icons/maskable-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => caches.open(RUNTIME_CACHE))
      // Three.js с CDN — «по возможности» (не ломает установку, если CDN недоступен)
      .then((c) => Promise.all(CDN.map((u) => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((k) => k.startsWith("md-") && k !== SHELL_CACHE && k !== RUNTIME_CACHE)
        .map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Видео/аудио запрашивают Range-ами: отдаём нужный кусок из закэшированного целого файла.
async function rangeResponse(request, cached) {
  const buf = await cached.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(request.headers.get("range") || "");
  if (!m) return cached;
  const size = buf.byteLength;
  let start = m[1] === "" ? size - Number(m[2]) : Number(m[1]);
  let end = m[1] === "" || m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (start > end || start >= size) {
    return new Response(null, { status: 416, headers: { "Content-Range": "bytes */" + size } });
  }
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    statusText: "Partial Content",
    headers: {
      "Content-Type": cached.headers.get("Content-Type") || "application/octet-stream",
      "Content-Length": String(end - start + 1),
      "Content-Range": "bytes " + start + "-" + end + "/" + size,
      "Accept-Ranges": "bytes",
    },
  });
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  const sameOrigin = url.origin === self.location.origin;
  const isCdn = url.hostname === "unpkg.com";
  if (!sameOrigin && !isCdn) return; // blob:, внешние ресурсы — не трогаем

  // Навигация: сеть, при неудаче — закэшированный index.html.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(SHELL_CACHE).then((c) => c.put("index.html", copy));
        return res;
      }).catch(() => caches.match("index.html"))
    );
    return;
  }

  // Плейлист по умолчанию: список (playlist.json) — сначала сеть, офлайн из кэша;
  // сами mp3 не кэшируем — приложение само копирует их в IndexedDB.
  if (sameOrigin && url.pathname.includes("/assets/default-playlist/")) {
    if (url.pathname.endsWith("playlist.json")) {
      event.respondWith(
        fetch(req).then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy)); }
          return res;
        }).catch(() => caches.match(req.url).then((c) => c || new Response('{"tracks":[]}', { headers: { "Content-Type": "application/json" } })))
      );
    }
    return; // mp3 — обычный запрос в сеть, без кэша service worker
  }

  // Код оболочки: stale-while-revalidate (быстро + подтягивает свежее).
  const isShell = sameOrigin && (/\.(?:js|css|html|webmanifest)$/.test(url.pathname));

  event.respondWith((async () => {
    const hasRange = req.headers.has("range");
    const cache = await caches.open(isShell ? SHELL_CACHE : RUNTIME_CACHE);
    const cached = await caches.match(req.url);

    if (cached) {
      if (isShell) {
        fetch(req).then((r) => { if (r.ok) cache.put(req, r); }).catch(() => {});
      }
      return hasRange ? rangeResponse(req, cached) : cached;
    }

    try {
      if (hasRange) {
        // Тянем файл целиком один раз, кладём в кэш, отдаём запрошенный кусок.
        const full = await fetch(req.url);
        if (full.ok) {
          cache.put(req.url, full.clone());
          return rangeResponse(req, full);
        }
        return fetch(req);
      }
      const res = await fetch(req);
      if (res.ok && (res.type === "basic" || res.type === "cors")) cache.put(req, res.clone());
      return res;
    } catch (e) {
      return new Response("Офлайн", { status: 503, statusText: "Offline" });
    }
  })());
});
