app_name        = "raftor_pwahq"
app_title       = "Raftor PWA HQ"
app_publisher   = "Raftor"
app_description = "Production-grade PWA mobile shell for any Frappe site"
app_email       = "dev@raftor.io"
app_license     = "MIT"
app_version     = "1.0.0"

# Bump on every JS/CSS change to invalidate the service-worker STATIC_CACHE
asset_version = "20260528.2"

after_request = ["raftor_pwahq.utils.bridge.after_request"]

website_route_rules = [
    {"from_route": "/pwahq_sw.js",        "to_route": "pwa_sw"},
    {"from_route": "/pwahq_manifest.json", "to_route": "pwa_manifest"},
    {"from_route": "/manifest.json",       "to_route": "pwa_manifest"},
    {"from_route": "/offline",             "to_route": "pwa_offline"},
]
