"""
scripts/setup_example.py — NOT part of the distributable runtime package.

Example site-setup script showing how to create a PWA App record
programmatically for a specific tenant.  Adapt and run once per site:

    bench --site <your-site> execute raftor_pwahq.scripts.setup_example.setup

All fields here are site-specific (app name, icon URLs, nav items, etc.).
Do not import this module from application code.
"""
import frappe


def _register_file(file_path_on_disk: str, file_name: str, is_private: bool = False) -> str:
    """Register a file that already exists on disk and return its URL."""
    # Check if already registered
    existing = frappe.db.get_value("File", {"file_name": file_name}, "file_url")
    if existing:
        return existing

    public_prefix = "/files/pwahq/"
    file_url = public_prefix + file_name

    doc = frappe.get_doc({
        "doctype": "File",
        "file_name": file_name,
        "file_url": file_url,
        "is_private": 0,
        "content_hash": "",
    })
    doc.insert(ignore_permissions=True)
    frappe.db.commit()
    return file_url


def setup():
    # --- Register image files ---
    icon_url        = _register_file("", "ao_icon_512.png")
    narrow_url      = _register_file("", "ao_screenshot_narrow.png")
    wide_url        = _register_file("", "ao_screenshot_wide.png")

    print(f"icon_url={icon_url}, narrow_url={narrow_url}, wide_url={wide_url}")

    # --- Delete stale record if it exists under old name ---
    target_name = "Ability Outfits"
    for old_name in ["My App"]:
        if frappe.db.exists("PWA App", old_name) and old_name != target_name:
            frappe.delete_doc("PWA App", old_name, force=True, ignore_permissions=True)
            frappe.db.commit()
            print(f"Deleted old PWA App record: {old_name}")

    # --- Create or reload ---
    if frappe.db.exists("PWA App", target_name):
        doc = frappe.get_doc("PWA App", target_name)
    else:
        doc = frappe.new_doc("PWA App")

    # Core fields — app_name = name since autoname = "field:app_name"
    doc.app_name        = target_name
    doc.enabled         = 1
    doc.short_name      = "AbilityOut"
    doc.theme_color     = "#1a1a2e"
    doc.background_color= "#ffffff"
    doc.start_url       = "/"
    doc.display_mode    = "standalone"
    doc.orientation     = "portrait-primary"
    doc.description     = "Shop the latest fashion at Ability Outfits"
    doc.scope_mode      = "sitewide"
    doc.cache_version   = "v2"
    doc.offline_url     = "/offline"
    doc.push_enabled    = 0
    doc.show_install_prompt = 1

    # Icons — clear and add fresh rows
    doc.set("icons", [
        {"icon_image": icon_url, "sizes": "512x512", "purpose": "any"},
        {"icon_image": icon_url, "sizes": "512x512", "purpose": "maskable"},
    ])

    # Screenshots — one narrow + one wide (needed for Richer Install UI)
    doc.set("screenshots", [
        {
            "image": narrow_url,
            "label": "Shop on mobile",
            "form_factor": "narrow",
            "sizes": "390x844",
        },
        {
            "image": wide_url,
            "label": "Shop on desktop",
            "form_factor": "wide",
            "sizes": "1280x800",
        },
    ])

    # Nav items — bottom navigation
    doc.set("nav_items", [
        {"label": "Home",     "url": "/",          "icon": "home",         "guest_ok": 1},
        {"label": "Shop",     "url": "/shop",      "icon": "shopping-bag", "guest_ok": 1},
        {"label": "Cart",     "url": "/cart",      "icon": "shopping-cart","guest_ok": 1},
        {"label": "Account",  "url": "/me",        "icon": "user",         "guest_ok": 0},
    ])

    doc.save(ignore_permissions=True)
    frappe.db.commit()
    print(f"PWA App '{doc.name}' saved successfully.")

    # --- Ensure raftor_pwa old app is disabled ---
    if frappe.db.exists("Raftor App", {"enabled": 1}):
        frappe.db.sql("UPDATE `tabRaftor App` SET enabled=0")
        frappe.db.commit()
        print("Disabled all Raftor App records to prevent double injection.")
    else:
        print("No enabled Raftor App records found (already clean).")

    # --- Clear config cache so next request picks up the new app ---
    frappe.cache().delete_keys("pwahq_app_*")
    frappe.cache().delete_keys("pwahq_cfg_*")
    print("Cache cleared.")
