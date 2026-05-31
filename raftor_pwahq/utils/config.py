"""
raftor_pwahq/utils/config.py
Builds the PWAHQ_CONFIG dict served to the browser.
"""
from __future__ import annotations
import json
import frappe
from raftor_pwahq.hooks import asset_version as _asset_version

CACHE_KEY_APP   = "pwahq:site_app"
CACHE_KEY_CFG   = "pwahq:cfg:{app}:{user}"
CACHE_TTL_APP   = 600   # 10 min
CACHE_TTL_CFG   = 300   # 5 min

# Paths excluded from shell injection. /app/ (with slash) avoids matching /application etc.
EXCLUDE_PREFIXES = ("/api/", "/assets/", "/app/", "/files/", "/private/files/")
EXCLUDE_EXACT    = frozenset(["/pwahq_sw.js", "/pwahq_manifest.json", "/app"])


# ── Public API ─────────────────────────────────────────────────────────────

def get_config_cached(user: str) -> dict | None:
    """Return config from cache only — zero DB access. None on any cache miss."""
    app_data = _cache_get(CACHE_KEY_APP)
    if not app_data or not app_data.get("name"):
        return None
    return _cache_get(CACHE_KEY_CFG.format(app=app_data["name"], user=user)) or None


def get_app() -> object | None:
    """Return the first enabled PWA App document for this site (cached)."""
    cached = _cache_get(CACHE_KEY_APP)
    if cached is not None:
        if not cached:
            return None
        try:
            return frappe.get_doc("PWA App", cached["name"])
        except Exception:
            pass

    names = frappe.get_all("PWA App", filters={"enabled": 1},
                           fields=["name"], limit=1, order_by="creation asc")
    if not names:
        _cache_set(CACHE_KEY_APP, {}, CACHE_TTL_APP)
        return None

    _cache_set(CACHE_KEY_APP, {"name": names[0].name}, CACHE_TTL_APP)
    try:
        return frappe.get_doc("PWA App", names[0].name)
    except Exception:
        return None


def build_config(app) -> dict:
    """Build the full config dict for the given PWA App document."""
    if not app:
        return {}

    user       = frappe.session.user or "Guest"
    cache_key  = CACHE_KEY_CFG.format(app=app.name, user=user)
    cached     = _cache_get(cache_key)
    if cached:
        return cached

    roles = set(frappe.get_roles(user))
    icons = _build_icons(app)
    cfg = {
        "appName":          app.app_name or "App",
        "shortName":        (app.short_name or app.app_name or "App")[:12],
        "description":      app.description or "",
        "startUrl":         app.start_url   or "/",
        "displayMode":      app.display_mode or "standalone",
        "orientation":      app.orientation  or "portrait-primary",
        "themeColor":       app.theme_color  or "#1a1a2e",
        "bgColor":          app.background_color or "#ffffff",
        "scopeMode":        (app.scope_mode or "sitewide").lower(),
        "cacheVersion":     app.cache_version or "v1",
        "offlineUrl":       app.offline_url   or "/offline",
        "pushEnabled":      bool(app.push_enabled),
        "vapidPublicKey":   app.vapid_public_key or "",
        "showInstall":      bool(app.show_install_prompt),
        "manifestUrl":      "/pwahq_manifest.json",
        "swUrl":            "/pwahq_sw.js",
        "mobileBreakpoint": 768,
        "imageCacheMax":    200,
        "assetVersion":     _asset_version,
        "iconUrl":          icons[0]["src"] if icons else "",
        "navItems":         _build_nav(app, user, roles),
        "deskEnabled":      bool(app.desk_enabled),
        "deskNavItems":     _build_desk_nav(app, roles) if app.desk_enabled else [],
        "icons":            icons,
        "screenshots":      _build_screenshots(app),
        "currentUser":      _build_user(user),
    }

    _cache_set(cache_key, cfg, CACHE_TTL_CFG)
    return cfg


@frappe.whitelist(allow_guest=True)
def get_config_api():
    """JSON endpoint called by boot.js when window.PWAHQ_CONFIG is absent."""
    app = get_app()
    cfg = build_config(app) if app else {}
    return cfg


# ── Internal helpers ────────────────────────────────────────────────────────

def _build_nav(app, user: str, roles: set) -> list[dict]:
    items = []
    for row in (app.get("nav_items") or []):
        allowed_roles = {r.strip() for r in (row.roles or "").split(",") if r.strip()}
        if allowed_roles and not allowed_roles & roles:
            continue
        if not row.guest_ok and user == "Guest":
            continue
        items.append({
            "label": row.label,
            "url":   row.url,
            "icon":  row.icon or "home",
        })
    return items[:5]  # bottom nav supports max 5 items


def _build_desk_nav(app, roles: set) -> list[dict]:
    """Build desk nav items — only for logged-in System Users."""
    items = []
    for row in (app.get("desk_nav_items") or []):
        allowed_roles = {r.strip() for r in (row.roles or "").split(",") if r.strip()}
        if allowed_roles and not allowed_roles & roles:
            continue
        url = (row.url or "").strip()
        if not url:
            continue
        if not url.startswith("/"):
            url = "/app/" + url
        items.append({
            "label": row.label,
            "url":   url,
            "icon":  row.icon or "file",
        })
    return items[:5]


def _build_icons(app) -> list[dict]:
    icons = []
    for ic in (app.get("icons") or []):
        src = getattr(ic, "icon_image", None)
        if not src:
            continue
        icons.append({
            "src":     src,
            "sizes":   (ic.sizes or "any").strip(),
            "type":    _mime(src),
            "purpose": (ic.purpose or "any").strip(),
        })
    if not icons:
        fallback = (frappe.db.get_single_value("Website Settings", "app_logo")
                    or "/assets/frappe/images/frappe-framework-logo.png")
        icons = [
            {"src": fallback, "sizes": "any", "type": _mime(fallback), "purpose": "any"},
            {"src": fallback, "sizes": "any", "type": _mime(fallback), "purpose": "maskable"},
        ]
    return icons


def _build_screenshots(app) -> list[dict]:
    out = []
    for s in (app.get("screenshots") or []):
        src = getattr(s, "image", None)
        if not src:
            continue
        ff    = (s.form_factor or "narrow").strip()
        sizes = (s.sizes or ("1280x720" if ff == "wide" else "720x1280")).strip()
        entry = {"src": src, "type": _mime(src), "form_factor": ff, "sizes": sizes}
        if s.label:
            entry["label"] = s.label
        out.append(entry)
    return out


def _build_user(user: str) -> dict:
    # Roles are filtered server-side in _build_nav; exposing them in the page
    # source would leak the user's privilege level to browser extensions.
    logged_in = user not in ("Guest", "", None)
    user_image = ""
    has_desk_access = False
    if logged_in:
        try:
            row = frappe.db.get_value("User", user, ["user_image", "user_type"], as_dict=True)
            if row:
                user_image      = row.user_image or ""
                has_desk_access = (row.user_type == "System User")
        except Exception:
            pass
    return {
        "user":          user,
        "loggedIn":      logged_in,
        "userImage":     user_image,
        "hasDeskAccess": has_desk_access,
    }


def _mime(src: str) -> str:
    s = (src or "").lower().split("?")[0]
    if s.endswith(".svg"):  return "image/svg+xml"
    if s.endswith(".webp"): return "image/webp"
    if s.endswith((".jpg", ".jpeg")): return "image/jpeg"
    return "image/png"


def is_excluded(path: str) -> bool:
    p = _norm(path)
    if p in EXCLUDE_EXACT:
        return True
    return any(p.startswith(px) for px in EXCLUDE_PREFIXES)


def _norm(path: str) -> str:
    return ("/" + path.strip("/")) if path.strip("/") else "/"


def _cache_get(key: str):
    try:
        raw = frappe.cache().get_value(key)
        return json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        return None


def _cache_set(key: str, value, ttl: int) -> None:
    try:
        frappe.cache().set_value(key, json.dumps(value, default=str), expires_in_sec=ttl)
    except Exception:
        pass
