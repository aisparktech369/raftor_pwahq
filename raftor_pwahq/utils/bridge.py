"""
raftor_pwahq/utils/bridge.py
Frappe after_request hook — injects PWA assets into matched HTML pages
and fixes Content-Type for the SW and manifest endpoints.
"""
from __future__ import annotations
import html as _html  # aliased to avoid shadowing the local variable 'body' below
import json
import re
import frappe
from raftor_pwahq.utils.config import get_app, build_config, get_config_cached, is_excluded, _norm

# Accepts hex (#rgb / #rrggbb / #rrggbbaa), rgb/rgba, hsl/hsla, and CSS named colours.
# Anything else (including semicolons, quotes, or JS) is rejected.
_COLOR_RE = re.compile(
    r'^#[0-9a-fA-F]{3,8}$'
    r'|^rgba?\(\s*[\d.,\s%]+\)\s*$'
    r'|^hsla?\(\s*[\d.,\s%]+\)\s*$'
    r'|^[a-zA-Z]+$'
)


def _safe_color(value: str, default: str) -> str:
    v = (value or "").strip()
    return v if _COLOR_RE.match(v) else default


def after_request(response, request) -> None:
    path = getattr(request, "path", "") or "/"
    norm = _norm(path)

    # ── Fix Content-Type for SW and manifest before anything else ──────────
    if norm == "/pwahq_sw.js":
        if getattr(response, "status_code", 200) == 200:
            response.headers["Content-Type"]           = "application/javascript; charset=utf-8"
            response.headers["Service-Worker-Allowed"] = "/"
            response.headers["Cache-Control"]          = "no-cache, no-store, must-revalidate"
        return

    if norm in ("/pwahq_manifest.json", "/manifest.json"):
        if getattr(response, "status_code", 200) == 200:
            response.headers["Content-Type"]  = "application/manifest+json; charset=utf-8"
            response.headers["Cache-Control"] = "public, max-age=300, stale-while-revalidate=3600"
        return

    # ── Skip API, assets, and non-HTML paths ───────────────────────────────
    # Desk paths (/app and /app/*) bypass the exclusion check so that
    # deskEnabled can be evaluated after the config is loaded.
    is_desk_path = norm == "/app" or norm.startswith("/app/")
    if not is_desk_path and is_excluded(path):
        return
    if not _is_html_200(response):
        return

    # ── Resolve config — fast path skips frappe.get_doc on cache hit ──────
    user = frappe.session.user or "Guest"
    cfg  = get_config_cached(user)
    if not cfg:
        app = get_app()
        if not app:
            return
        cfg = build_config(app)
        if not cfg:
            return

    if is_desk_path and not cfg.get("deskEnabled"):
        return

    scope_mode = cfg.get("scopeMode", "sitewide")
    if scope_mode != "sitewide" and not _in_scope(norm, cfg):
        return

    # ── Read response body ─────────────────────────────────────────────────
    try:
        body = response.get_data(as_text=True)
    except Exception:
        return

    if "</head>" not in body:
        return
    if "PWAHQ_CONFIG" in body:
        return  # already injected (e.g. by a www/ template directly)

    markup = _build_head_markup(cfg)
    if not markup:
        return

    injected = body.replace("</head>", markup + "\n</head>", 1)
    if injected == body:
        return

    response.set_data(injected)
    response.headers["Content-Length"] = str(len(response.get_data()))
    response.headers["X-PWAHQ"] = "1"


# ── Helpers ────────────────────────────────────────────────────────────────

def _is_html_200(response) -> bool:
    if getattr(response, "status_code", 200) != 200:
        return False
    ct = (getattr(response, "content_type", "") or "").lower()
    return "text/html" in ct or "application/xhtml+xml" in ct


def _in_scope(norm_path: str, cfg: dict) -> bool:
    start = _norm(cfg.get("startUrl", "/"))
    candidates = set()
    if start != "/":
        candidates.add(start)
    for item in (cfg.get("navItems") or []):
        r = _norm(item.get("url", ""))
        if r == "/":
            return True
        candidates.add(r)
    if not candidates:
        return False
    return any(norm_path == c or norm_path.startswith(c + "/") for c in candidates)


def _build_head_markup(cfg: dict) -> str:
    from raftor_pwahq.hooks import asset_version

    # Validate colours against a strict allowlist — rejects anything that could
    # break out of a CSS value or JS string literal.
    theme    = _safe_color(cfg.get("themeColor"),  "#1a1a2e")
    bg       = _safe_color(cfg.get("bgColor"),     "#ffffff")
    name     = cfg.get("shortName") or "App"
    icon_src = cfg.get("iconUrl", "")
    bp       = cfg.get("mobileBreakpoint", 768)

    splash_icon = (
        f'<img src="{_html.escape(icon_src, quote=True)}" alt="" '
        'style="width:72px;height:72px;border-radius:16px;object-fit:cover;">'
        if icon_src else
        '<svg viewBox="0 0 24 24" fill="white" width="72" height="72">'
        '<rect x="3" y="3" width="7" height="7" rx="1.5"/>'
        '<rect x="14" y="3" width="7" height="7" rx="1.5"/>'
        '<rect x="3" y="14" width="7" height="7" rx="1.5"/>'
        '<rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>'
    )

    # bg has already been validated as a safe CSS colour, safe to interpolate directly.
    pre_flash = f"""<script>
(function(){{
  try{{
    var mq=window.matchMedia;
    var active=mq&&(mq("(max-width:{bp}px)").matches||mq("(display-mode:standalone)").matches);
    if(!active)return;
    document.documentElement.setAttribute("data-pwahq","loading");
    setTimeout(function(){{
      document.documentElement.removeAttribute("data-pwahq");
      document.body&&document.body.removeAttribute("data-pwahq");
      var s=document.getElementById("pwahq-splash");
      if(s&&s.parentNode)s.parentNode.removeChild(s);
    }},4000);
    document.addEventListener("DOMContentLoaded",function(){{
      if(document.documentElement.getAttribute("data-pwahq")!=="loading")return;
      document.body.setAttribute("data-pwahq","loading");
      if(!document.getElementById("pwahq-splash")){{
        var s=document.createElement("div");
        s.id="pwahq-splash";
        s.innerHTML={json.dumps(f'<div class="pwahq-splash-icon">{splash_icon}</div><div class="pwahq-splash-name">{_html.escape(name)}</div><div class="pwahq-splash-spinner"></div>')};
        s.style.cssText="position:fixed;inset:0;z-index:99999;display:flex;flex-direction:column;align-items:center;justify-content:center;background:{bg};gap:16px;";
        document.body.insertBefore(s,document.body.firstChild);
      }}
    }},{{once:true}});
  }}catch(e){{}}
}})();
</script>"""

    # json.dumps does not escape </script>; the replacement prevents the HTML
    # parser from closing this script tag early if any field value contains it.
    config_json   = json.dumps(cfg, default=str, ensure_ascii=False).replace("</", "<\\/")
    config_script = f"<script>window.PWAHQ_CONFIG = {config_json};</script>"

    v = asset_version
    tags = [
        pre_flash,
        '<meta name="mobile-web-app-capable" content="yes">',
        '<meta name="apple-mobile-web-app-capable" content="yes">',
        '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
        f'<meta name="theme-color" content="{_html.escape(theme, quote=True)}">',
        f'<meta name="apple-mobile-web-app-title" content="{_html.escape(name, quote=True)}">',
        '<link rel="manifest" href="/pwahq_manifest.json">',
        *([f'<link rel="apple-touch-icon" href="{_html.escape(icon_src, quote=True)}">'] if icon_src else []),
        config_script,
        f'<link rel="stylesheet" href="/assets/raftor_pwahq/css/pwahq_shell.css?v={v}">',
        f'<script defer src="/assets/raftor_pwahq/js/pwahq_boot.js?v={v}"></script>',
    ]
    return "\n".join(t for t in tags if t)
