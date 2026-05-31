import frappe

no_cache   = 0   # cacheable — SW caches this for offline fallback
no_sitemap = 1


def get_context(context):
    from raftor_pwahq.utils.config import get_config_cached, get_app, build_config

    user = frappe.session.user or "Guest"
    cfg  = get_config_cached(user) or {}
    if not cfg:
        app = get_app()
        cfg = build_config(app) if app else {}

    context.app_name    = cfg.get("appName", "App")
    context.theme_color = cfg.get("themeColor", "#1a1a2e")
    context.icon_url    = cfg.get("iconUrl", "")
