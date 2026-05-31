/* raftor_pwahq service worker */
var _p            = new URL(self.location.href).searchParams;
var CACHE_VERSION = _p.get("v")       || "v1";   // doctype cache_version — admin controlled
var ASSET_VERSION = _p.get("av")      || "1";    // hooks.py asset_version — bumped on every deploy
var SW_ICON       = _p.get("icon")    || "";
var OFFLINE_URL   = _p.get("offline") || "/offline";
var IMAGE_MAX     = parseInt(_p.get("imgmax") || "200", 10);

// Shell assets + boot JS: keyed by ASSET_VERSION — purged on every code deploy
// Nav HTML:               keyed by ASSET_VERSION — purged on every code deploy
// Images:                 keyed by CACHE_VERSION — persists across code deploys,
//                         only reset when admin bumps cache_version in the doctype
// Offline page:           keyed by CACHE_VERSION — refreshes when admin changes branding
var STATIC_CACHE  = "pwahq-static-"  + ASSET_VERSION;
var NAV_CACHE     = "pwahq-nav-"     + ASSET_VERSION;
var IMAGE_CACHE   = "pwahq-img-"     + CACHE_VERSION;
var OFFLINE_CACHE = "pwahq-offline-" + CACHE_VERSION;

var PRECACHE_URLS = [
  "/assets/raftor_pwahq/css/pwahq_shell.css",
  "/assets/raftor_pwahq/js/pwahq_boot.js",
];

var NEVER_CACHE = [
  "/api/", "/pwahq_sw.js", "/pwahq_manifest.json",
  "/login", "/logout", "/update-password",
];

/* ── Install ─────────────────────────────────────────────────────── */
self.addEventListener("install", function (e) {
  e.waitUntil((async function () {
    const staticCache  = await caches.open(STATIC_CACHE);
    await staticCache.addAll(PRECACHE_URLS).catch(function () {});
    // Offline page in its own version-keyed cache so branding changes are
    // picked up when the admin bumps cache_version, independent of JS deploys.
    const offlineCache = await caches.open(OFFLINE_CACHE);
    await offlineCache.add(OFFLINE_URL).catch(function () {});
    await self.skipWaiting();
  })());
});

/* ── Activate ────────────────────────────────────────────────────── */
self.addEventListener("activate", function (e) {
  const keep = [STATIC_CACHE, NAV_CACHE, IMAGE_CACHE, OFFLINE_CACHE];
  e.waitUntil((async function () {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(function (k) { return keep.indexOf(k) === -1; })
          .map(function (k) { return caches.delete(k); })
    );
    await self.clients.claim();
  })());
});

/* ── Message ─────────────────────────────────────────────────────── */
self.addEventListener("message", function (e) {
  if (e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

/* ── Helpers ─────────────────────────────────────────────────────── */
async function hasStorageHeadroom() {
  try {
    if (!navigator.storage || !navigator.storage.estimate) return true;
    const est  = await navigator.storage.estimate();
    const free = (est.quota || 0) - (est.usage || 0);
    return free > 10 * 1024 * 1024;
  } catch (_) { return true; }
}

async function trimImageCache(cache) {
  const keys = await cache.keys();
  if (keys.length > IMAGE_MAX) {
    // Remove all excess entries in one pass so a burst of images can't grow
    // the cache indefinitely by outpacing one-at-a-time deletion.
    const excess = keys.slice(0, keys.length - IMAGE_MAX);
    await Promise.all(excess.map(function (k) { return cache.delete(k); }));
  }
}

/* ── Fetch ───────────────────────────────────────────────────────── */
self.addEventListener("fetch", function (e) {
  var req = e.request;
  var url;
  try { url = new URL(req.url); } catch (_) { return; }

  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  var path = url.pathname;

  if (NEVER_CACHE.some(function (p) { return path.startsWith(p); })) return;

  // ── Static assets: cache-first ────────────────────────────────────
  // Frappe and esbuild version by hash/query so cache-first is always safe.
  // STATIC_CACHE is keyed by ASSET_VERSION so old entries are purged on deploy.
  if (path.startsWith("/assets/")) {
    e.respondWith((async function () {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res && res.status === 200) {
        const cache = await caches.open(STATIC_CACHE);
        cache.put(req, res.clone());
      }
      return res;
    })());
    return;
  }

  // ── Images: cache-first, rolling limit, storage-aware ────────────
  // /files/ is intentionally excluded — Frappe serves both public and private
  // file attachments from that path; caching them without session scope would
  // leak private files to other users on shared devices.
  if (/\.(png|jpe?g|webp|gif|svg|ico)$/i.test(path)) {
    e.respondWith((async function () {
      const cache = await caches.open(IMAGE_CACHE);
      const hit   = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res && res.status === 200 && await hasStorageHeadroom()) {
          cache.put(req, res.clone());
          trimImageCache(cache);
        }
        return res;
      } catch (_) {
        return new Response("", { status: 503 });
      }
    })());
    return;
  }

  // ── HTML: network-first with offline fallback ─────────────────────
  // Network-first guarantees authenticated pages always reflect server state
  // and prevents one user's cached HTML from being served to another user on
  // the same device after a login switch.
  // Falls back to the cached version when offline, then to the offline page.
  if (req.headers.get("Accept") && req.headers.get("Accept").includes("text/html")) {
    e.respondWith((async function () {
      const cache = await caches.open(NAV_CACHE);
      try {
        const res = await fetch(req);
        if (res && res.status === 200) cache.put(req, res.clone());
        return res;
      } catch (_) {
        const cached  = await cache.match(req);
        const offline = await caches.match(OFFLINE_URL);
        return cached || offline || new Response("Offline", { status: 503 });
      }
    })());
    return;
  }
});

/* ── Push notifications ─────────────────────────────────────────── */
self.addEventListener("push", function (e) {
  var data = {};
  try { data = e.data.json(); } catch (_) {}

  // Validate the click-through URL before storing it in notification.data so
  // notificationclick never receives an external URL.
  var url = data.url || "/";
  if (!url.startsWith("/") || url.startsWith("//")) url = "/";

  e.waitUntil((async function () {
    await self.registration.showNotification(data.title || "Notification", {
      body:    data.body    || "",
      icon:    data.icon    || SW_ICON || "",
      badge:   data.badge   || "",
      data:    { url: url },
      actions: data.actions || [],
    });
    try {
      if (self.navigator && self.navigator.setAppBadge) {
        const notes = await self.registration.getNotifications();
        await self.navigator.setAppBadge(notes.length);
      }
    } catch (_) {}
  })());
});

self.addEventListener("notificationclick", function (e) {
  e.notification.close();
  var target = (e.notification.data && e.notification.data.url) || "/";
  // Accept only same-origin relative paths — reject absolute and protocol-relative URLs.
  if (!target.startsWith("/") || target.startsWith("//")) target = "/";
  e.waitUntil((async function () {
    const clients = await self.clients.matchAll({ type: "window" });
    for (var i = 0; i < clients.length; i++) {
      if (clients[i].url === target && "focus" in clients[i]) return clients[i].focus();
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  })());
});
