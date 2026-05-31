import frappe

no_cache   = 1
no_sitemap = 1


def get_context(context):
    from raftor_pwahq.utils.config import get_config_cached, get_app, build_config

    user = frappe.session.user or "Guest"
    cfg  = get_config_cached(user) or {}
    if not cfg:
        app = get_app()
        cfg = build_config(app) if app else {}

    if not cfg:
        cfg = {
            "appName": "App", "shortName": "App",
            "themeColor": "#1a1a2e", "bgColor": "#ffffff",
            "startUrl": "/", "displayMode": "standalone",
            "orientation": "portrait-primary",
            "icons": [], "screenshots": [],
        }

    start_url = cfg.get("startUrl", "/")

    manifest = {
        "id":               start_url,
        "name":             cfg.get("appName", "App"),
        "short_name":       cfg.get("shortName", "App"),
        "description":      cfg.get("description", ""),
        "start_url":        start_url,
        "scope":            "/",
        "display":          cfg.get("displayMode", "standalone"),
        "orientation":      cfg.get("orientation", "portrait-primary"),
        "theme_color":      cfg.get("themeColor", "#1a1a2e"),
        "background_color": cfg.get("bgColor", "#ffffff"),
        "lang":             frappe.local.lang or "en",
        "icons":            cfg.get("icons") or [],
        "screenshots":      cfg.get("screenshots") or [],
        "categories":       ["productivity", "utilities"],
        "prefer_related_applications": False,
        "shortcuts":        _build_shortcuts(cfg.get("navItems") or []),
    }

    context.manifest_json = frappe.as_json(manifest)


def _build_shortcuts(nav_items):
    """Convert the first 4 nav items into PWA app shortcuts."""
    shortcuts = []
    for item in nav_items[:4]:
        url  = item.get("url", "")
        name = item.get("label", "")
        if not url or not name:
            continue
        shortcut = {"name": name, "url": url}
        icon = item.get("icon", "")
        if icon and icon.startswith("/"):
            shortcut["icons"] = [{"src": icon, "sizes": "any"}]
        shortcuts.append(shortcut)
    return shortcuts
