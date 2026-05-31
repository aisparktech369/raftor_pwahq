/* ═══════════════════════════════════════════════════════════════════
   raftor_pwahq/public/js/pwahq_boot.js
   Mobile shell: header · bottom nav · side drawer · install prompt
   Activates on: mobile viewport (<769px) OR standalone mode OR
                 localStorage.pwahq_force = "1" (dev override)
   ═══════════════════════════════════════════════════════════════════ */
(function (W) {
  "use strict";

  /* ── Constants ──────────────────────────────────────────────────── */
  var _bp         = (W.PWAHQ_CONFIG && W.PWAHQ_CONFIG.mobileBreakpoint) || 768;
  var MOBILE_MQ   = "(max-width: " + _bp + "px)";
  var STANDALONE  = "(display-mode: standalone)";
  var DISMISS_KEY = "pwahq_install_dismissed";
  var DISMISS_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

  /* ── State ──────────────────────────────────────────────────────── */
  var _cfg             = null;
  var _swReg           = null;
  var _installPrompt   = null;
  var _drawerOpen      = false;
  var _toastContainer  = null;
  var _offlineBar      = null;
  var _booted          = false;
  var _lastNavScrape   = null;
  var _dbg             = false;
  var _pageViews       = 0;
  var _installCfg      = null;
  var _skipWaitingSent = false;  // tracks whether we sent SKIP_WAITING to the SW
  var _progressBar     = null;   // page-transition progress bar element

  function dbg() {
    if (_dbg) try { console.log.apply(console, ["[PWAHQ]"].concat(Array.prototype.slice.call(arguments))); } catch (_) {}
  }

  /* ── Safe HTML escape ───────────────────────────────────────────── */
  function escHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  /* ── Native-feel utilities ──────────────────────────────────────── */

  // 8 ms vibration on interactive taps — imperceptible as sound, tactile on device
  function haptic(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms || 8); } catch (_) {}
  }

  // Append viewport-fit=cover so the shell extends behind the notch / Dynamic Island
  function applyViewportFit() {
    var vp = document.querySelector('meta[name="viewport"]');
    if (vp && vp.content.indexOf("viewport-fit") === -1) {
      vp.content = vp.content + ", viewport-fit=cover";
    }
  }

  // Page-transition progress bar — shows on navigate(), hides when boot() runs on new page
  function _showProgress() {
    if (!_progressBar) {
      _progressBar = el("div", { id: "pwahq-progress" });
      document.body.appendChild(_progressBar);
    }
    _progressBar.className = "";
    void _progressBar.offsetWidth;   // force reflow so CSS transition restarts
    _progressBar.className = "running";
  }

  function _hideProgress() {
    if (_progressBar) _progressBar.className = "done";
  }

  // Web App Badge API — clear unread count when the app is opened
  function _clearBadge() {
    try { if (navigator.clearAppBadge) navigator.clearAppBadge(); } catch (_) {}
  }

  // Scroll-position persistence across full-page navigations
  function _saveScroll() {
    try {
      sessionStorage.setItem("pwahq_sy_" + normPath(W.location.pathname), String(W.scrollY));
    } catch (_) {}
  }

  function _restoreScroll() {
    try {
      var y = sessionStorage.getItem("pwahq_sy_" + normPath(W.location.pathname));
      if (y != null) W.scrollTo(0, parseInt(y, 10));
    } catch (_) {}
  }

  /* ═══════════════════════════════════════════════════════════════
     1. Activation check
     ═══════════════════════════════════════════════════════════════ */
  function isMobile()     { return mq(MOBILE_MQ); }
  function isStandalone() { return mq(STANDALONE); }
  function mq(q) { try { return W.matchMedia && W.matchMedia(q).matches; } catch (_) { return false; } }

  function isDesk() {
    var p = W.location.pathname;
    return p === "/app" || p.startsWith("/app/");
  }

  function shouldActivate() {
    try {
      if (W.localStorage && localStorage.getItem("pwahq_force") === "1") return true;
    } catch (_) {}
    return isMobile() || isStandalone();
  }

  function initDebug() {
    try { _dbg = W.localStorage && localStorage.getItem("pwahq_debug") === "1"; } catch (_) {}
  }

  /* ═══════════════════════════════════════════════════════════════
     2. SVG icon library (inline — no network request)
     ═══════════════════════════════════════════════════════════════ */
  var ICONS = {
    menu:           '<path d="M3 12h18M3 6h18M3 18h18"/>',
    home:           '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    "shopping-bag": '<path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    "shopping-cart":'<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>',
    user:           '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    search:         '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
    heart:          '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
    bell:           '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    book:           '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    package:        '<line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>',
    star:           '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    settings:       '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
    calendar:       '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    truck:          '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
    file:           '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>',
    filter:         '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
    close:          '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    wifi_off:       '<line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.56 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
    download:       '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    share:          '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
    "arrow-left":   '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  };

  function icon(name, size) {
    size = size || 22;
    var d = ICONS[name] || ICONS["home"];
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
           '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
           'stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
  }

  /* ═══════════════════════════════════════════════════════════════
     3. DOM helpers
     ═══════════════════════════════════════════════════════════════ */
  function el(tag, attrs, html) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (k === "className") node.className = attrs[k];
        else node.setAttribute(k, attrs[k]);
      }
    }
    if (html !== undefined) node.innerHTML = html;
    return node;
  }

  function currentPath() { return W.location.pathname; }

  function normPath(p) {
    p = (p || "/").trim();
    return ("/" + p.replace(/^\/+|\/+$/g, "")) || "/";
  }

  function isActivePath(url) {
    var cur    = normPath(currentPath());
    var target = normPath(url.split("?")[0]);
    if (target === "/") return cur === "/";
    return cur === target || cur.startsWith(target + "/");
  }

  /* ═══════════════════════════════════════════════════════════════
     4. Theme colour
     ═══════════════════════════════════════════════════════════════ */
  function applyTheme(cfg) {
    var theme = cfg.themeColor;
    document.documentElement.style.setProperty("--pwahq-theme", theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme;
  }

  /* ═══════════════════════════════════════════════════════════════
     5. Header
     ═══════════════════════════════════════════════════════════════ */
  function buildHeader(cfg) {
    if (document.getElementById("pwahq-header")) return;

    var header  = el("header", { id: "pwahq-header" });
    var menuBtn = el("button", { class: "pwahq-hbtn", "aria-label": "Open menu" });
    menuBtn.innerHTML = icon("menu");
    menuBtn.addEventListener("click", function () {
      haptic();
      // In desk mode, behave as a back button when there is history to go back to
      if (isDesk() && _deskCanGoBack()) { _deskGoBack(); } else { openDrawer(); }
    });

    var title = el("div", { id: "pwahq-title" });
    title.textContent = cfg.appName || "App";

    var actions = el("div", { id: "pwahq-header-actions" });

    header.appendChild(menuBtn);
    header.appendChild(title);
    header.appendChild(actions);
    document.body.insertBefore(header, document.body.firstChild);
  }

  function updateTitle() {
    var t = document.getElementById("pwahq-title");
    if (!t) return;
    var pageTitle = document.title.split(" - ")[0] || (_cfg && _cfg.appName) || "App";
    t.textContent = pageTitle;
  }

  /* ═══════════════════════════════════════════════════════════════
     6. Bottom navigation
     ═══════════════════════════════════════════════════════════════ */
  function buildNav(cfg, items) {
    items = items || cfg.navItems || [];
    if (!items.length) return;

    var existing = document.getElementById("pwahq-nav");
    if (existing) existing.parentNode.removeChild(existing);

    var nav = el("nav", { id: "pwahq-nav", "aria-label": "Main navigation" });

    items.forEach(function (item) {
      var a = el("a", {
        class:       "pwahq-nav-item" + (isActivePath(item.url) ? " active" : ""),
        href:        item.url,
        "aria-label": item.label,
      });
      a.innerHTML = icon(item.icon || "home") + "<span>" + escHtml(item.label) + "</span>";
      a.addEventListener("click", function (e) {
        if (normPath(item.url) === normPath(currentPath())) { e.preventDefault(); return; }
        haptic();
        setNavActive(a);
        navigate(item.url, e);
      });
      nav.appendChild(a);
    });

    document.body.appendChild(nav);
  }

  function setNavActive(activeEl) {
    var nav = document.getElementById("pwahq-nav");
    if (!nav) return;
    nav.querySelectorAll(".pwahq-nav-item").forEach(function (e) {
      e.classList.toggle("active", e === activeEl);
    });
  }

  function syncNavActive() {
    var nav = document.getElementById("pwahq-nav");
    if (!nav) return;
    nav.querySelectorAll(".pwahq-nav-item").forEach(function (a) {
      a.classList.toggle("active", isActivePath(a.getAttribute("href") || ""));
    });
  }

  // Update active classes on existing drawer items — no DOM rebuild needed
  function _syncDrawerActive() {
    var drawer = document.getElementById("pwahq-drawer");
    if (!drawer) return;
    drawer.querySelectorAll("a.pwahq-drawer-item[href], a.pwahq-drawer-subitem[href]").forEach(function (a) {
      a.classList.toggle("active", isActivePath(a.getAttribute("href") || ""));
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     7. Drawer
     ═══════════════════════════════════════════════════════════════ */
  function scrapeWebsiteNav() {
    var results  = [];
    var seenUrls = {};

    function isSkip(href) {
      if (!href) return true;
      var h = href.trim();
      return h.charAt(0) === "#" ||
        h.indexOf("javascript") === 0 ||
        /^https?:\/\//i.test(h) ||
        /^\/(api|assets|files|private|app|login|logout)/.test(h);
    }

    function cleanText(node) {
      var clone = node.cloneNode(true);
      clone.querySelectorAll("svg, img, i, use, .badge, .sr-only, .visually-hidden")
           .forEach(function (n) { try { n.parentNode.removeChild(n); } catch (_) {} });
      return (clone.textContent || "").trim().replace(/\s+/g, " ");
    }

    var nav = (
      document.querySelector("nav.navbar")             ||
      document.querySelector("header nav")             ||
      document.querySelector("[role='navigation']")    ||
      document.querySelector(".navbar")                ||
      document.querySelector("header")
    );
    dbg("nav element:", nav ? nav.tagName + (nav.id ? "#" + nav.id : "") + " ." + nav.className : "NOT FOUND");
    if (!nav) return results;

    var menuById = {};
    var menuSet  = [];
    var SUB_SELS = [".dropdown-menu", "[role='menu']", ".sub-menu", ".submenu"];
    SUB_SELS.forEach(function (sel) {
      try {
        Array.prototype.forEach.call(document.querySelectorAll(sel), function (m) {
          menuSet.push(m);
          var labelledBy = m.getAttribute("aria-labelledby");
          if (labelledBy) menuById[labelledBy] = m;
        });
      } catch (_) {}
    });
    dbg("menuSet count:", menuSet.length, "menuById keys:", Object.keys(menuById));

    function getMenuFor(e) {
      var elId = e.getAttribute("id");
      if (elId && menuById[elId]) return menuById[elId];
      var dataTarget = e.getAttribute("data-target") || e.getAttribute("data-bs-target") || "";
      if (!dataTarget && e.tagName === "A") dataTarget = e.getAttribute("href") || "";
      if (dataTarget && dataTarget.charAt(0) === "#") {
        var targetId = dataTarget.slice(1);
        if (targetId) { var targeted = document.getElementById(targetId); if (targeted) return targeted; }
      }
      var controls = e.getAttribute("aria-controls");
      if (controls) { var ctrl = document.getElementById(controls); if (ctrl) return ctrl; }
      var parent = e.parentNode;
      if (parent) {
        for (var i = 0; i < SUB_SELS.length; i++) {
          var m = parent.querySelector(SUB_SELS[i]);
          if (m) return m;
        }
      }
      return null;
    }

    function isInMenu(node) {
      for (var i = 0; i < menuSet.length; i++) {
        if (menuSet[i] === node || (menuSet[i].compareDocumentPosition &&
            menuSet[i].compareDocumentPosition(node) & 16)) return true;
      }
      return false;
    }

    var allLis  = Array.prototype.slice.call(nav.querySelectorAll("li"));
    var topLis  = allLis.filter(function (li) { return !isInMenu(li); });
    dbg("allLis:", allLis.length, "topLis:", topLis.length);

    if (!topLis.length) {
      dbg("No topLis — fallback to flat link scan");
      Array.prototype.forEach.call(nav.querySelectorAll("a[href]"), function (a) {
        if (isInMenu(a)) return;
        var href = (a.getAttribute("href") || "").trim();
        if (isSkip(href) || seenUrls[href]) return;
        seenUrls[href] = true;
        var label = cleanText(a);
        if (label && label.length < 60) results.push({ label: label, url: href, children: [] });
      });
      dbg("Fallback results:", results.length);
      return results;
    }

    topLis.forEach(function (li) {
      var toggle = (
        li.querySelector("[data-toggle='dropdown'],[data-bs-toggle='dropdown']") ||
        li.querySelector("[aria-haspopup='true']") ||
        li.querySelector(".dropdown-toggle")
      );
      var menu = toggle ? getMenuFor(toggle) : null;
      dbg("li:", cleanText(li).slice(0, 30), "| toggle:", toggle ? cleanText(toggle) : "none", "| menu:", menu ? "found" : "null");

      if (menu) {
        var groupLabel = cleanText(toggle);
        if (!groupLabel) { dbg("  group skipped: empty label"); return; }
        var children = [];
        Array.prototype.forEach.call(menu.querySelectorAll("a[href]"), function (a) {
          var href = (a.getAttribute("href") || "").trim();
          if (isSkip(href) || seenUrls[href]) return;
          seenUrls[href] = true;
          var label = cleanText(a);
          if (label && label.length < 60) children.push({ label: label, url: href });
        });
        dbg("  group '" + groupLabel + "': " + children.length + " children");
        if (children.length) results.push({ label: groupLabel, url: null, children: children });
      } else {
        var link = null;
        Array.prototype.forEach.call(li.querySelectorAll("a[href]"), function (a) {
          if (link || isInMenu(a)) return;
          var href = (a.getAttribute("href") || "").trim();
          if (!isSkip(href)) link = a;
        });
        if (!link) { dbg("  flat: no link found"); return; }
        var href = (link.getAttribute("href") || "").trim();
        if (seenUrls[href]) { dbg("  flat: dup", href); return; }
        seenUrls[href] = true;
        var label = cleanText(link);
        dbg("  flat:", label, "->", href);
        if (label && label.length < 60) results.push({ label: label, url: href, children: [] });
      }
    });

    dbg("scrape total results:", results.length, results.map(function (r) { return r.label; }));
    return results;
  }

  function hideNativeNav() {
    var selectors = [
      "nav.navbar", "header.web-header", ".web-header",
      "body > header:not(#pwahq-header)", "footer", ".web-footer", "footer.web-footer",
    ];
    selectors.forEach(function (sel) {
      try {
        document.querySelectorAll(sel).forEach(function (node) {
          if (node.id === "pwahq-header") return;
          node.setAttribute("data-pwahq-hidden", "1");
          node.style.display = "none";
        });
      } catch (_) {}
    });
  }

  function buildDrawer(cfg, extraNav, force) {
    var existing = document.getElementById("pwahq-drawer");
    if (existing && !force) return;
    if (existing) {
      existing.parentNode && existing.parentNode.removeChild(existing);
      var existingScrim = document.getElementById("pwahq-drawer-scrim");
      existingScrim && existingScrim.parentNode && existingScrim.parentNode.removeChild(existingScrim);
      _drawerOpen = false;
    }

    var configPaths = {};
    (cfg.navItems || []).forEach(function (item) {
      configPaths[normPath((item.url || "").split("?")[0])] = true;
    });
    ["/login", "/logout", "/me"].forEach(function (p) { configPaths[p] = true; });

    function isConfigPath(url) {
      return configPaths[normPath((url || "").split("?")[0])];
    }

    var extras = (extraNav || []).reduce(function (acc, item) {
      if (item.children && item.children.length) {
        var kids = item.children.filter(function (c) { return !isConfigPath(c.url); });
        if (kids.length) acc.push({ label: item.label, url: null, children: kids });
      } else {
        if (!isConfigPath(item.url)) acc.push(item);
      }
      return acc;
    }, []);

    var scrim = el("div", { id: "pwahq-drawer-scrim" });
    scrim.addEventListener("click", closeDrawer);

    var drawer = el("div", {
      id:           "pwahq-drawer",
      role:         "dialog",
      "aria-modal": "true",
      "aria-label": "Navigation menu",
    });

    // ── Drawer header with Frappe user avatar ─────────────────────
    var user    = cfg.currentUser || {};
    var initials = (user.user || "G").charAt(0).toUpperCase();
    var drawerHeader = el("div", { id: "pwahq-drawer-header" });
    var avatar       = el("div", { class: "pwahq-drawer-avatar" });
    if (user.userImage) {
      var avatarImg = el("img", { src: user.userImage, alt: "" });
      avatarImg.onerror = function () { this.parentNode.textContent = initials; };
      avatar.appendChild(avatarImg);
    } else {
      avatar.textContent = initials;
    }

    var userInfo = el("div", { class: "pwahq-drawer-user" });
    var userName = el("div", { class: "pwahq-drawer-name" });
    userName.textContent = user.loggedIn ? (user.user || "User") : "Guest";
    var userRole = el("div", { class: "pwahq-drawer-role" });
    userRole.textContent = user.loggedIn ? "Logged in" : "Not signed in";
    userInfo.appendChild(userName);
    userInfo.appendChild(userRole);
    drawerHeader.appendChild(avatar);
    drawerHeader.appendChild(userInfo);
    drawer.appendChild(drawerHeader);

    var body = el("div", { id: "pwahq-drawer-body" });

    function makeDrawerLink(item, iconName) {
      var a = el("a", {
        class: "pwahq-drawer-item" + (isActivePath(item.url) ? " active" : ""),
        href:  item.url,
      });
      a.innerHTML = icon(iconName || "file") + "<span>" + escHtml(item.label) + "</span>";
      a.addEventListener("click", function (e) {
        haptic();
        closeDrawer();
        if (normPath(item.url) !== normPath(currentPath())) {
          navigate(item.url, e);
        } else {
          e.preventDefault();
        }
      });
      return a;
    }

    (cfg.navItems || []).forEach(function (item) {
      body.appendChild(makeDrawerLink(item, item.icon));
    });

    if (extras.length) {
      body.appendChild(el("div", { class: "pwahq-drawer-divider" }));
      body.appendChild(el("div", { class: "pwahq-drawer-section-label" }, "More"));

      extras.forEach(function (item) {
        if (item.children && item.children.length) {
          var chevronSvg = '<svg class="pwahq-chevron" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
          var groupBtn = el("button", { class: "pwahq-drawer-item pwahq-drawer-group" });
          groupBtn.innerHTML = icon("filter") + "<span>" + escHtml(item.label) + "</span>" + chevronSvg;

          var subList = el("div", { class: "pwahq-drawer-subitems" });
          item.children.forEach(function (child) {
            var sub = el("a", {
              class: "pwahq-drawer-subitem" + (isActivePath(child.url) ? " active" : ""),
              href:  child.url,
            });
            sub.innerHTML = "<span>" + escHtml(child.label) + "</span>";
            sub.addEventListener("click", function (e) {
              haptic();
              closeDrawer();
              if (normPath(child.url) !== normPath(currentPath())) {
                navigate(child.url, e);
              } else {
                e.preventDefault();
              }
            });
            subList.appendChild(sub);
          });

          groupBtn.addEventListener("click", function () {
            haptic();
            var open = groupBtn.classList.toggle("open");
            subList.classList.toggle("open", open);
          });

          body.appendChild(groupBtn);
          body.appendChild(subList);
        } else {
          body.appendChild(makeDrawerLink(item, "file"));
        }
      });
    }

    body.appendChild(el("div", { class: "pwahq-drawer-divider" }));
    if (user.loggedIn) {
      if (user.hasDeskAccess) {
        var deskLink = el("a", { class: "pwahq-drawer-item", href: "/app" });
        deskLink.innerHTML = icon("settings") + "<span>Desk</span>";
        body.appendChild(deskLink);
      }
      var logout = el("button", { class: "pwahq-drawer-item", type: "button", style: "width:100%;text-align:left;" });
      logout.innerHTML = icon("close") + "<span>Sign out</span>";
      logout.addEventListener("click", function () {
        haptic();
        closeDrawer();
        fetch("/api/method/logout", {
          method: "POST",
          credentials: "same-origin",
          headers: { "X-Frappe-CSRF-Token": _csrfToken(), "Content-Type": "application/json" },
        }).then(function () {
          W.location.href = "/login";
        }).catch(function () {
          W.location.href = "/login";
        });
      });
      body.appendChild(logout);
    } else {
      var login = el("a", { class: "pwahq-drawer-item", href: "/login" });
      login.innerHTML = icon("user") + "<span>Sign in</span>";
      body.appendChild(login);
    }

    drawer.appendChild(body);
    document.body.appendChild(scrim);
    document.body.appendChild(drawer);
  }

  function openDrawer() {
    var scrim  = document.getElementById("pwahq-drawer-scrim");
    var drawer = document.getElementById("pwahq-drawer");
    if (!drawer) return;
    _drawerOpen = true;
    document.body.classList.add("pwahq-scroll-locked");
    scrim  && scrim.classList.add("open");
    drawer.classList.add("open");
    drawer.focus();
  }

  function closeDrawer() {
    var scrim  = document.getElementById("pwahq-drawer-scrim");
    var drawer = document.getElementById("pwahq-drawer");
    _drawerOpen = false;
    document.body.classList.remove("pwahq-scroll-locked");
    scrim  && scrim.classList.remove("open");
    drawer && drawer.classList.remove("open");
  }

  /* ═══════════════════════════════════════════════════════════════
     8. Touch gesture — swipe to open / close drawer
     ═══════════════════════════════════════════════════════════════ */
  function installSwipeGestures() {
    if (W.__pwahqSwipeInstalled) return;
    W.__pwahqSwipeInstalled = true;

    var startX = 0, startY = 0;

    document.addEventListener("touchstart", function (e) {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }, { passive: true });

    document.addEventListener("touchend", function (e) {
      var dx = e.changedTouches[0].clientX - startX;
      var dy = Math.abs(e.changedTouches[0].clientY - startY);
      if (dy > 80) return;  // too vertical — not a horizontal swipe

      if (_drawerOpen && dx < -50) {
        closeDrawer();                                    // swipe left to close
      } else if (!_drawerOpen && startX < 24 && dx > 60) {
        openDrawer();                                     // swipe right from left edge to open
      }
    }, { passive: true });
  }

  /* ═══════════════════════════════════════════════════════════════
     9. Pull-to-refresh
     ═══════════════════════════════════════════════════════════════ */
  function buildPullToRefresh() {
    if (document.getElementById("pwahq-ptr")) return;

    var ptr = el("div", { id: "pwahq-ptr" });
    ptr.innerHTML = '<div class="pwahq-ptr-icon"></div>';
    // Insert after the header so it sits in the content flow
    var header = document.getElementById("pwahq-header");
    if (header && header.nextSibling) {
      document.body.insertBefore(ptr, header.nextSibling);
    } else {
      document.body.appendChild(ptr);
    }

    var startY = 0, pulling = false, THRESHOLD = 72;

    document.addEventListener("touchstart", function (e) {
      // Only trigger when at the very top and the drawer is closed
      if (W.scrollY === 0 && !_drawerOpen) {
        startY  = e.touches[0].clientY;
        pulling = true;
      }
    }, { passive: true });

    document.addEventListener("touchmove", function (e) {
      if (!pulling) return;
      var dy = e.touches[0].clientY - startY;
      if (dy <= 0) { pulling = false; ptr.style.height = "0"; return; }
      ptr.style.height = Math.min(dy * 0.5, THRESHOLD) + "px";
      ptr.classList.toggle("ready", dy >= THRESHOLD);
    }, { passive: true });

    document.addEventListener("touchend", function () {
      if (!pulling) return;
      pulling = false;
      if (ptr.classList.contains("ready")) {
        ptr.classList.remove("ready");
        ptr.classList.add("refreshing");
        // Desk SPA: soft-refresh the current page without a full reload
        if (isDesk() && W.frappe && W.frappe.get_route && W.frappe.set_route) {
          try {
            var _r = W.frappe.get_route();
            W.frappe.set_route(_r);
            setTimeout(function () { ptr.style.height = "0"; ptr.classList.remove("refreshing"); }, 600);
          } catch (_) { W.location.reload(); }
        } else {
          W.location.reload();
        }
      } else {
        ptr.style.height = "0";
        ptr.classList.remove("ready");
      }
    }, { passive: true });
  }

  /* ═══════════════════════════════════════════════════════════════
     10. Offline bar
     ═══════════════════════════════════════════════════════════════ */
  function buildOfflineBar() {
    _offlineBar = el("div", { id: "pwahq-offline-bar" });
    _offlineBar.innerHTML = "<span>You’re offline</span><button class=\"pwahq-offline-retry\" onclick=\"window.location.reload()\">Retry</button>";
    document.body.appendChild(_offlineBar);
    W.addEventListener("online",  function () { _offlineBar.classList.remove("visible"); });
    W.addEventListener("offline", function () { _offlineBar.classList.add("visible"); });
    if (!W.navigator.onLine) _offlineBar.classList.add("visible");
  }

  /* ═══════════════════════════════════════════════════════════════
     11. Toast
     ═══════════════════════════════════════════════════════════════ */
  function showToast(msg, type, duration) {
    if (!_toastContainer) {
      _toastContainer = el("div", { id: "pwahq-toasts" });
      document.body.appendChild(_toastContainer);
    }
    var toast = el("div", { class: "pwahq-toast " + (type || "") });
    toast.textContent = msg;  // textContent — toasts are always plain text
    _toastContainer.appendChild(toast);
    setTimeout(function () {
      toast.classList.add("hiding");
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 250);
    }, duration || 3000);
    return toast;
  }

  /* ═══════════════════════════════════════════════════════════════
     12. Install prompt (engagement-gated)
     ═══════════════════════════════════════════════════════════════ */
  function _trackPageView() {
    try {
      var v = parseInt(sessionStorage.getItem("pwahq_pv") || "0", 10) + 1;
      sessionStorage.setItem("pwahq_pv", String(v));
      _pageViews = v;
    } catch (_) {
      _pageViews += 1;
    }
  }

  function initInstall(cfg) {
    if (!cfg.showInstall) return;
    _installCfg = cfg;

    if (!W.__pwahqInstallBound) {
      W.__pwahqInstallBound = true;
      W.addEventListener("beforeinstallprompt", function (e) {
        e.preventDefault();
        _installPrompt = e;
        if (shouldActivate() && !isStandalone() && !_isDismissed() && _pageViews >= 2) {
          showInstallBanner(cfg);
        }
      });
      W.addEventListener("appinstalled", function () {
        _installPrompt = null;
        hideBanner();
        showToast(cfg.appName + " installed!", "success");
      });
    }

    _trackPageView();
  }

  function _isDismissed() {
    try {
      var raw = localStorage.getItem(DISMISS_KEY);
      if (!raw) return false;
      return Date.now() - Number(raw) < DISMISS_TTL;
    } catch (_) { return false; }
  }

  function showInstallBanner(cfg) {
    if (document.getElementById("pwahq-install-banner")) return;
    if (isStandalone()) return;

    var icons  = cfg.icons || [];
    var iconEl = icons.length
      ? '<img src="' + icons[0].src + '" style="width:100%;height:100%;object-fit:cover;">'
      : '<div style="width:100%;height:100%;background:var(--pwahq-primary);border-radius:12px;"></div>';

    var banner = el("div", { id: "pwahq-install-banner" });
    banner.innerHTML =
      '<div class="pwahq-install-icon">' + iconEl + '</div>' +
      '<div class="pwahq-install-text">' +
        '<div class="pwahq-install-title">Install ' + escHtml(cfg.appName || "App") + '</div>' +
        '<div class="pwahq-install-sub">Add to home screen for the full experience</div>' +
        '<div class="pwahq-install-actions">' +
          '<button class="pwahq-btn-primary" id="pwahq-install-ok">Install</button>' +
          '<button class="pwahq-btn-ghost"    id="pwahq-install-no">Not now</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(banner);

    document.getElementById("pwahq-install-ok").addEventListener("click", function () {
      haptic();
      if (_installPrompt) {
        _installPrompt.prompt();
        _installPrompt.userChoice.then(function (r) {
          if (r.outcome === "accepted") hideBanner();
          _installPrompt = null;
        });
      }
    });
    document.getElementById("pwahq-install-no").addEventListener("click", function () {
      haptic();
      try { localStorage.setItem(DISMISS_KEY, Date.now()); } catch (_) {}
      hideBanner();
    });
  }

  function hideBanner() {
    var b = document.getElementById("pwahq-install-banner");
    if (b) b.setAttribute("hidden", "hidden");
  }

  /* ═══════════════════════════════════════════════════════════════
     13. Push notifications
     ═══════════════════════════════════════════════════════════════ */
  function _csrfToken() {
    try {
      if (W.frappe && W.frappe.csrf_token) return W.frappe.csrf_token;
      var m = document.cookie.match(/csrf_token=([^;]+)/);
      return m ? decodeURIComponent(m[1]) : "";
    } catch (_) { return ""; }
  }

  function _vapidBytes(b64url) {
    var s = b64url.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    var raw = W.atob(s);
    var arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  function _pushFetch(method, body) {
    return fetch("/api/method/raftor_pwahq.api.push." + method, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type":        "application/json",
        "X-Frappe-CSRF-Token": _csrfToken(),
      },
      body: JSON.stringify(body),
    });
  }

  function enablePush() {
    if (!_swReg || !_cfg) return Promise.reject("pwahq not ready");
    if (!_cfg.pushEnabled || !_cfg.vapidPublicKey) return Promise.reject("push not configured");
    if (!("PushManager" in W)) return Promise.reject("PushManager not supported");
    if (!_cfg.currentUser || !_cfg.currentUser.loggedIn) return Promise.reject("sign in required");

    return Notification.requestPermission().then(function (perm) {
      if (perm !== "granted") return false;
      return _swReg.pushManager.getSubscription().then(function (existing) {
        if (existing) return existing;
        return _swReg.pushManager.subscribe({
          userVisibleOnly:      true,
          applicationServerKey: _vapidBytes(_cfg.vapidPublicKey),
        });
      }).then(function (sub) {
        return _pushFetch("subscribe", { subscription_info: JSON.stringify(sub.toJSON()) })
          .then(function () { return true; })
          .catch(function () { return false; });
      });
    });
  }

  function disablePush() {
    if (!_swReg) return Promise.resolve(true);
    return _swReg.pushManager.getSubscription().then(function (sub) {
      if (!sub) return true;
      var ep = sub.endpoint;
      return sub.unsubscribe().then(function () {
        return _pushFetch("unsubscribe", { endpoint: ep });
      }).then(function () { return true; }).catch(function () { return true; });
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     14. Service worker (always registered — not gated by mobile)
     ═══════════════════════════════════════════════════════════════ */
  function registerSW(cfg) {
    if (!("serviceWorker" in navigator) || W.__pwahqSwBound) return;
    W.__pwahqSwBound = true;

    var swUrl = (cfg.swUrl || "/pwahq_sw.js")
      + "?v="       + encodeURIComponent(cfg.cacheVersion  || "v1")
      + "&av="      + encodeURIComponent(cfg.assetVersion  || "1")
      + "&icon="    + encodeURIComponent(cfg.iconUrl        || "")
      + "&offline=" + encodeURIComponent(cfg.offlineUrl     || "/offline")
      + "&imgmax="  + encodeURIComponent(cfg.imageCacheMax  || 200);

    navigator.serviceWorker.register(swUrl, { scope: "/" }).then(function (reg) {
      _swReg = reg;
      reg.addEventListener("updatefound", function () {
        var sw = reg.installing;
        if (!sw) return;
        sw.addEventListener("statechange", function () {
          if (sw.state === "installed" && navigator.serviceWorker.controller) {
            var toast = showToast("Update available — tap to reload.", "info", 12000);
            if (toast) toast.style.cursor = "pointer";
            if (toast) toast.addEventListener("click", function () {
              if (reg.waiting) {
                _skipWaitingSent = true;
                reg.waiting.postMessage({ type: "SKIP_WAITING" });
              }
              W.location.reload();
            });
            // Only reload when the SW takes control if *we* triggered SKIP_WAITING —
            // guards against unrelated SW updates reloading the page mid-session.
            navigator.serviceWorker.addEventListener("controllerchange", function () {
              if (_skipWaitingSent) W.location.reload();
            }, { once: true });
          }
        });
      });
    }).catch(function (e) {
      console.warn("[PWAHQ] SW registration failed:", e);
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     15. Activate shell
     ═══════════════════════════════════════════════════════════════ */
  function activateShell(cfg) {
    if (_booted) { _refresh(cfg); return; }
    _booted = true;

    initDebug();
    applyViewportFit();               // extend behind notch / Dynamic Island
    applyTheme(cfg);
    var extraNav = scrapeWebsiteNav();
    _lastNavScrape = extraNav;
    hideNativeNav();
    buildHeader(cfg);
    buildNav(cfg);
    buildDrawer(cfg, extraNav);
    buildOfflineBar();
    installSwipeGestures();           // swipe-to-close / edge-swipe-to-open
    buildPullToRefresh();             // pull-down-to-refresh

    document.body.classList.add("pwahq-active");

    document.documentElement.removeAttribute("data-pwahq");
    document.body.removeAttribute("data-pwahq");

    var splash = document.getElementById("pwahq-splash");
    if (splash) {
      splash.classList.add("hiding");
      setTimeout(function () {
        if (splash.parentNode) splash.parentNode.removeChild(splash);
      }, 240);
    }

    W.dispatchEvent(new CustomEvent("pwahq:ready", { detail: cfg }));
  }

  function _refresh(cfg) {
    applyTheme(cfg);
    buildNav(cfg);
    syncNavActive();
    updateTitle();
  }

  /* ═══════════════════════════════════════════════════════════════
     16. Desk shell (Frappe /app/* SPA)
     ═══════════════════════════════════════════════════════════════ */

  // Poll for window.frappe.ready() then activate the desk shell (max 8 s)
  function waitForFrappeAndActivate(cfg) {
    var waited = 0;
    var MAX    = 8000;
    var TICK   = 100;
    function check() {
      if (W.frappe && W.frappe.ready) {
        W.frappe.ready(function () { activateDeskShell(cfg); });
        return;
      }
      waited += TICK;
      if (waited < MAX) setTimeout(check, TICK);
      // If Frappe never boots within 8 s, silently bail — do not break the desk
    }
    check();
  }

  // Read the current Frappe route and return a human title string
  function _deskRouteTitle() {
    try {
      var route = W.frappe && W.frappe.get_route ? W.frappe.get_route() : [];
      if (route && route.length) {
        var first = (route[0] || "").toLowerCase();
        // Workspace root → show app name
        if (!first || first === "home" || first === "workspaces") {
          return (_cfg && _cfg.appName) || "Home";
        }
        if (route[0] === "Form"   && route[2]) return route[2];
        if (route[0] === "List"   && route[1]) return route[1];
        if (route[0] === "Module" && route[1]) return route[1];
        // Fallback: read from Frappe's page-head title element (even if hidden)
        try {
          var el = document.querySelector(".page-head .title-text");
          if (el) { var t2 = (el.textContent || "").trim(); if (t2) return t2; }
        } catch (_) {}
        return String(route[0]).replace(/-/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); });
      }
    } catch (_) {}
    var raw = document.title || "";
    return raw.split(" \xb7 ")[0].split(" | ")[0].split(" – ")[0].trim() || (_cfg && _cfg.appName) || "Desk";
  }

  // Update the PWA header title and, for forms, show the status indicator as a badge
  function _updateDeskTitle() {
    var titleEl = document.getElementById("pwahq-title");
    if (!titleEl) return;
    titleEl.textContent = _deskRouteTitle();

    // Form status badge (Draft / Submitted / Cancelled / etc.)
    try {
      var pill = document.querySelector(".page-head .indicator-pill:not(.d-none):not([hidden])");
      var status = pill ? (pill.textContent || "").trim() : "";
      var badge  = document.getElementById("pwahq-status-badge");
      if (status && status.length < 20) {
        if (!badge) {
          badge = document.createElement("span");
          badge.id = "pwahq-status-badge";
          titleEl.appendChild(badge);
        }
        badge.textContent = status;
        // Map Frappe indicator colour classes → CSS colour
        var COLORS = { red:"#e53e3e", green:"#38a169", orange:"#ed8936",
                       yellow:"#d69e2e", blue:"#3182ce", purple:"#805ad5",
                       grey:"#718096", gray:"#718096" };
        var bg = "#718096";
        if (pill) pill.classList.forEach(function (c) { if (COLORS[c]) bg = COLORS[c]; });
        badge.style.cssText = "font-size:10px;padding:1px 6px;border-radius:99px;margin-left:8px;" +
                              "background:" + bg + ";color:#fff;vertical-align:middle;white-space:nowrap;";
      } else if (badge) {
        badge.parentNode.removeChild(badge);
      }
    } catch (_) {}
  }

  // Hide Frappe's own top navbar so the PWA header can take its place
  function _suppressFrappeNavbar() {
    try {
      ["#navbar-main", ".frappe-app > .navbar", "body > .sticky-top"].forEach(function (sel) {
        document.querySelectorAll(sel).forEach(function (el) { el.style.display = "none"; });
      });
    } catch (_) {}
  }

  // True when the current Frappe route is NOT the root home/workspace page
  function _deskCanGoBack() {
    try {
      var route = W.frappe && W.frappe.get_route ? W.frappe.get_route() : null;
      if (!route || !route.length) return W.history.length > 1;
      var first = (route[0] || "").toLowerCase().trim();
      return first !== "" && first !== "home" && first !== "workspaces";
    } catch (_) {}
    return W.history.length > 1;
  }

  // Navigate back inside the Frappe SPA, falling back to browser history
  function _deskGoBack() {
    try {
      if (W.frappe && W.frappe.router && typeof W.frappe.router.back === "function") {
        W.frappe.router.back(); return;
      }
    } catch (_) {}
    W.history.back();
  }

  // Swap the header button icon between ☰ (menu) and ← (back) to match context
  function _updateDeskHeaderBtn() {
    var btn = document.querySelector("#pwahq-header .pwahq-hbtn");
    if (!btn) return;
    if (_deskCanGoBack()) {
      btn.innerHTML = icon("arrow-left");
      btn.setAttribute("aria-label", "Go back");
    } else {
      btn.innerHTML = icon("menu");
      btn.setAttribute("aria-label", "Open menu");
    }
  }

  // Hide the bottom nav while the virtual keyboard is open so it doesn't overlap inputs
  function _installKeyboardAvoidance() {
    if (!W.visualViewport || W.__pwahqKbInstalled) return;
    W.__pwahqKbInstalled = true;
    W.visualViewport.addEventListener("resize", function () {
      var nav = document.getElementById("pwahq-nav");
      if (!nav) return;
      var kbH = Math.round(W.innerHeight - W.visualViewport.height);
      nav.style.transform = kbH > 100 ? "translateY(-" + kbH + "px)" : "";
    });
  }

  // Collect workspace navigation items for the drawer.
  // Prefers frappe.workspace_map (populated at boot, always available after frappe.ready)
  // and falls back to DOM-scraping the desk sidebar.
  function _scrapeDeskSidebar() {
    var items = [];
    var seen  = {};

    // Primary: Frappe workspace_map — keyed by workspace name, value has .route and .title
    try {
      var wmap = W.frappe && W.frappe.workspace_map;
      if (wmap && Object.keys(wmap).length) {
        Object.keys(wmap).forEach(function (key) {
          var ws   = wmap[key] || {};
          var route = (ws.route || key || "").toLowerCase().replace(/\s+/g, "-");
          if (!route) return;
          var href  = route.startsWith("/") ? route : "/app/" + route;
          if (seen[href]) return;
          seen[href] = true;
          var label = ((ws.title || ws.label || ws.name || key) + "").trim();
          if (label) items.push({ label: label, url: href });
        });
        dbg("_scrapeDeskSidebar workspace_map:", items.length);
        if (items.length) return items;
      }
    } catch (_) {}

    // Fallback: DOM scrape — try desk/app sidebar only (not .layout-side-section
    // which is the per-page content panel, not workspace navigation)
    try {
      var SELS = [".desk-sidebar", ".standard-sidebar", ".app-sidebar"];
      var container = null;
      for (var i = 0; i < SELS.length; i++) {
        var c = document.querySelector(SELS[i]);
        if (c) { container = c; break; }
      }
      dbg("_scrapeDeskSidebar DOM container:", container ? container.className : "none");
      if (!container) return items;
      Array.prototype.forEach.call(container.querySelectorAll("a[href]"), function (a) {
        var href = (a.getAttribute("href") || "").trim();
        if (!href || !href.startsWith("/app/") || seen[href]) return;
        seen[href] = true;
        var clone = a.cloneNode(true);
        clone.querySelectorAll("svg,img,i,use,.badge,.sr-only,.visually-hidden")
             .forEach(function (n) { try { n.parentNode.removeChild(n); } catch (_) {} });
        var label = (clone.textContent || "").trim().replace(/\s+/g, " ");
        if (label && label.length < 50) items.push({ label: label, url: href });
      });
      dbg("_scrapeDeskSidebar DOM scrape:", items.length);
    } catch (_) {}
    return items;
  }

  // Drawer shown when the user is inside /app — no web-scrape, just desk items + back link
  function buildDeskDrawer(cfg, sidebarItems) {
    var existing = document.getElementById("pwahq-drawer");
    if (existing) {
      existing.parentNode && existing.parentNode.removeChild(existing);
      var es = document.getElementById("pwahq-drawer-scrim");
      es && es.parentNode && es.parentNode.removeChild(es);
      _drawerOpen = false;
    }

    var scrim = el("div", { id: "pwahq-drawer-scrim" });
    scrim.addEventListener("click", closeDrawer);

    var drawer = el("div", {
      id: "pwahq-drawer", role: "dialog",
      "aria-modal": "true", "aria-label": "Navigation menu",
    });

    // Header
    var user     = cfg.currentUser || {};
    var initials = (user.user || "G").charAt(0).toUpperCase();
    var dHeader  = el("div", { id: "pwahq-drawer-header" });
    var avatar   = el("div", { class: "pwahq-drawer-avatar" });
    if (user.userImage) {
      var img = el("img", { src: user.userImage, alt: "" });
      img.onerror = function () { this.parentNode.textContent = initials; };
      avatar.appendChild(img);
    } else {
      avatar.textContent = initials;
    }
    var uInfo = el("div", { class: "pwahq-drawer-user" });
    var uName = el("div", { class: "pwahq-drawer-name" });
    uName.textContent = user.loggedIn ? (user.user || "User") : "Guest";
    var uRole = el("div", { class: "pwahq-drawer-role" });
    uRole.textContent = "Frappe Desk";
    uInfo.appendChild(uName);
    uInfo.appendChild(uRole);
    dHeader.appendChild(avatar);
    dHeader.appendChild(uInfo);
    drawer.appendChild(dHeader);

    var body = el("div", { id: "pwahq-drawer-body" });

    function makeDeskLink(item) {
      var a = el("a", {
        class: "pwahq-drawer-item" + (isActivePath(item.url) ? " active" : ""),
        href:  item.url,
      });
      a.innerHTML = icon(item.icon || "file") + "<span>" + escHtml(item.label) + "</span>";
      a.addEventListener("click", function (e) {
        haptic();
        closeDrawer();
        navigate(item.url, e);
      });
      return a;
    }

    (cfg.deskNavItems || []).forEach(function (item) { body.appendChild(makeDeskLink(item)); });

    // Sidebar workspaces merged from Frappe's left nav
    if (sidebarItems && sidebarItems.length) {
      body.appendChild(el("div", { class: "pwahq-drawer-divider" }));
      body.appendChild(el("div", { class: "pwahq-drawer-section-label" }, "Workspaces"));
      sidebarItems.forEach(function (item) { body.appendChild(makeDeskLink(item)); });
    }

    // Back to Site
    body.appendChild(el("div", { class: "pwahq-drawer-divider" }));
    var backLink = el("a", { class: "pwahq-drawer-item", href: cfg.startUrl || "/" });
    backLink.innerHTML = icon("home") + "<span>Back to Site</span>";
    backLink.addEventListener("click", function () { haptic(); closeDrawer(); });
    body.appendChild(backLink);

    // Sign out
    body.appendChild(el("div", { class: "pwahq-drawer-divider" }));
    if (user.loggedIn) {
      var logout = el("button", { class: "pwahq-drawer-item", type: "button", style: "width:100%;text-align:left;" });
      logout.innerHTML = icon("close") + "<span>Sign out</span>";
      logout.addEventListener("click", function () {
        haptic();
        closeDrawer();
        fetch("/api/method/logout", {
          method: "POST", credentials: "same-origin",
          headers: { "X-Frappe-CSRF-Token": _csrfToken(), "Content-Type": "application/json" },
        }).then(function () { W.location.href = "/login"; })
          .catch(function ()  { W.location.href = "/login"; });
      });
      body.appendChild(logout);
    }

    drawer.appendChild(body);
    document.body.appendChild(scrim);
    document.body.appendChild(drawer);
  }

  function activateDeskShell(cfg) {
    if (_booted) { _refreshDesk(cfg); return; }
    _booted = true;

    initDebug();
    applyViewportFit();
    applyTheme(cfg);
    _suppressFrappeNavbar();

    // ── Critical path: paint the visible chrome first ─────────────
    buildHeader(cfg);
    buildNav(cfg, cfg.deskNavItems);
    document.body.classList.add("pwahq-active", "pwahq-desk-active");

    document.documentElement.removeAttribute("data-pwahq");
    document.body.removeAttribute("data-pwahq");
    var splash = document.getElementById("pwahq-splash");
    if (splash) {
      splash.classList.add("hiding");
      setTimeout(function () { if (splash.parentNode) splash.parentNode.removeChild(splash); }, 240);
    }
    _updateDeskTitle();
    _updateDeskHeaderBtn();

    // Install route hooks immediately — must be ready before the user's first tap
    if (!W.__pwahqDeskHooks) {
      W.__pwahqDeskHooks = true;
      document.addEventListener("before_route_change", _showProgress);
      document.addEventListener("page-change", function () {
        _hideProgress();
        _suppressFrappeNavbar();
        syncNavActive();
        _syncDrawerActive();
        _updateDeskHeaderBtn();
        setTimeout(_updateDeskTitle, 50);
      });
    }

    // ── Deferred: build non-visible DOM after the first paint ─────
    setTimeout(function () {
      var sidebarItems = _scrapeDeskSidebar();
      buildDeskDrawer(cfg, sidebarItems);
      if (!sidebarItems.length) {
        setTimeout(function () {
          if (_cfg && !_drawerOpen) buildDeskDrawer(_cfg, _scrapeDeskSidebar());
        }, 600);
      }
      buildOfflineBar();
      buildPullToRefresh();
      installSwipeGestures();
      _installKeyboardAvoidance();
    }, 0);

    W.dispatchEvent(new CustomEvent("pwahq:ready", { detail: cfg }));
  }

  function _refreshDesk(cfg) {
    applyTheme(cfg);
    syncNavActive();
    _updateDeskTitle();
  }

  /* ═══════════════════════════════════════════════════════════════
     17. Navigation (web full-page + desk SPA router)
     ═══════════════════════════════════════════════════════════════ */
  function navigate(url, e) {
    if (e) e.preventDefault();
    // Reject absolute URLs, protocol-relative URLs, and javascript: hrefs
    if (!url || !url.startsWith("/") || url.startsWith("//")) return;

    // Inside the Frappe desk SPA use the Frappe router — no full page reload
    if (isDesk() && W.frappe && W.frappe.set_route) {
      var deskPath = url.replace(/^\/app\/?/, "");
      if (deskPath) {
        try {
          haptic();
          _showProgress();  // immediate feedback on tap, before before_route_change fires
          W.frappe.set_route(deskPath.split("/").filter(Boolean));
          return;
        } catch (_) {}
      }
    }

    _showProgress();
    W.location.href = url;
  }

  /* ═══════════════════════════════════════════════════════════════
     18. Popstate / route change
     ═══════════════════════════════════════════════════════════════ */
  function installRouteHooks() {
    if (W.__pwahqRouteHooks) return;
    W.__pwahqRouteHooks = true;

    if (!isDesk()) {
      // Web pages: hook popstate for back/forward and pagehide for scroll save
      W.addEventListener("popstate", function () { syncNavActive(); updateTitle(); });
      W.addEventListener("pagehide", _saveScroll);
    }
    // Desk SPA: route hooks are installed in activateDeskShell via page-change event
  }

  /* ═══════════════════════════════════════════════════════════════
     19. Config resolution
     ═══════════════════════════════════════════════════════════════ */
  function resolveConfig() {
    if (W.PWAHQ_CONFIG && W.PWAHQ_CONFIG.appName) {
      return Promise.resolve(W.PWAHQ_CONFIG);
    }
    var apiFetch = fetch("/api/method/raftor_pwahq.utils.config.get_config_api", {
      credentials: "same-origin",
    }).then(function (r) { return r.json(); })
      .then(function (d) { return d.message || null; })
      .catch(function () { return null; });

    var timeout = new Promise(function (resolve) {
      setTimeout(function () { resolve(null); }, 1500);
    });

    return Promise.race([apiFetch, timeout]);
  }

  /* ═══════════════════════════════════════════════════════════════
     20. Boot entry point
     ═══════════════════════════════════════════════════════════════ */
  function boot() {
    _hideProgress();   // complete any in-progress bar from the previous navigate()
    _clearBadge();     // clear OS home-screen badge when app is opened

    resolveConfig().then(function (cfg) {
      if (!cfg || !cfg.appName) return;
      _cfg = cfg;

      registerSW(cfg);
      initInstall(cfg);
      installRouteHooks();

      if (!shouldActivate()) return;

      if (isDesk() && cfg.deskEnabled) {
        waitForFrappeAndActivate(cfg);
      } else if (!isDesk()) {
        activateShell(cfg);
      }
    });
  }

  /* ── Kick off ───────────────────────────────────────────────── */
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  var _resizeTimer = null;
  W.addEventListener("resize", function () {
    if (!shouldActivate() || !_cfg || _booted) return;
    clearTimeout(_resizeTimer);
    _resizeTimer = setTimeout(function () { if (!_booted) boot(); }, 200);
  });

  W.addEventListener("pageshow", function (e) {
    if (_cfg) {
      syncNavActive();
      if (isDesk()) { _updateDeskTitle(); } else { updateTitle(); }
      if (e.persisted) _restoreScroll();  // restore scroll on bfcache restore
    }
  });

  /* ── Public API ─────────────────────────────────────────────── */
  W.pwahq = {
    openDrawer:  openDrawer,
    closeDrawer: closeDrawer,
    showToast:   showToast,
    navigate:    navigate,
    getConfig:   function () { return _cfg; },
    enablePush:  enablePush,
    disablePush: disablePush,

    // Native OS share sheet via Web Share API
    share: function (opts) {
      if (!navigator.share) return Promise.reject(new Error("Web Share not supported"));
      return navigator.share({
        title: (opts && opts.title) || (_cfg && _cfg.appName) || document.title,
        url:   (opts && opts.url)   || W.location.href,
        text:  (opts && opts.text)  || "",
      }).catch(function (e) {
        if (!e || e.name !== "AbortError") throw e;  // ignore user cancellation
      });
    },

    // Debug helpers
    debugNav: function () {
      console.group("[PWAHQ] Last nav scrape (" + (_lastNavScrape || []).length + " items)");
      (_lastNavScrape || []).forEach(function (item) {
        if (item.children && item.children.length) {
          console.group("GROUP: " + item.label + " (" + item.children.length + " children)");
          item.children.forEach(function (c) { console.log("  " + c.label + " -> " + c.url); });
          console.groupEnd();
        } else {
          console.log("FLAT: " + item.label + " -> " + item.url);
        }
      });
      console.groupEnd();
      return _lastNavScrape;
    },

    rescrape: function () {
      if (!_cfg) { console.warn("[PWAHQ] Not yet booted"); return; }
      if (isDesk()) {
        var fresh = _scrapeDeskSidebar();
        buildDeskDrawer(_cfg, fresh);
        console.log("[PWAHQ] Desk rescrape done:", fresh.length, "items");
        return fresh;
      }
      var fresh = scrapeWebsiteNav();
      _lastNavScrape = fresh;
      buildDrawer(_cfg, fresh, true);
      console.log("[PWAHQ] Rescrape done:", fresh.length, "items");
      return fresh;
    },

    clearCache: function () {
      var promises = [];
      if ("serviceWorker" in navigator) {
        promises.push(
          navigator.serviceWorker.getRegistrations().then(function (regs) {
            return Promise.all(regs.map(function (r) { return r.unregister(); }));
          })
        );
      }
      if ("caches" in W) {
        promises.push(
          caches.keys().then(function (keys) {
            return Promise.all(keys.map(function (k) { return caches.delete(k); }));
          })
        );
      }
      Promise.all(promises).then(function () {
        console.log("[PWAHQ] Cache cleared — reloading…");
        W.location.reload(true);
      });
    },
  };

}(window));
