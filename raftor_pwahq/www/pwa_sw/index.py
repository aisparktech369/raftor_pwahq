import os, frappe

no_cache = 1
no_sitemap = 1


def get_context(context):
    sw_path = os.path.join(frappe.get_app_path("raftor_pwahq"), "www", "pwa_sw", "sw.js")
    try:
        with open(sw_path) as f:
            context.sw_content = f.read()
    except Exception:
        context.sw_content = "// raftor_pwahq: service worker source not found"
