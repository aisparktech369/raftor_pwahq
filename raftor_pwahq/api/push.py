"""
raftor_pwahq/api/push.py
Push-notification API: subscribe, unsubscribe, and server-side send helper.
"""
import json
import frappe


# ── Rate-limit helper ───────────────────────────────────────────────────────

def _rate_limit(user: str, action: str, limit: int = 10, window: int = 60) -> None:
    """Raise PermissionError if *user* exceeds *limit* calls within *window* seconds."""
    key = f"pwahq:rl:{action}:{user}"
    count = int(frappe.cache().get_value(key) or 0)
    if count >= limit:
        frappe.throw("Too many requests. Please try again later.", frappe.PermissionError)
    frappe.cache().set_value(key, count + 1, expires_in_sec=window)


# ── Client-facing endpoints ─────────────────────────────────────────────────

@frappe.whitelist()
def subscribe(subscription_info):
    """Save (or replace) a Web Push subscription for the current user."""
    user = frappe.session.user
    if user == "Guest":
        frappe.throw("Sign in to enable push notifications", frappe.PermissionError)

    _rate_limit(user, "subscribe")

    if isinstance(subscription_info, str):
        subscription_info = json.loads(subscription_info)

    endpoint = subscription_info.get("endpoint", "")
    keys     = subscription_info.get("keys", {})
    if not endpoint:
        frappe.throw("Invalid subscription: missing endpoint")

    # Upsert scoped to the current user — never touch another user's record
    frappe.db.delete("PWA Push Subscription", {"user": user, "endpoint": endpoint})
    frappe.get_doc({
        "doctype": "PWA Push Subscription",
        "user":     user,
        "endpoint": endpoint,
        "p256dh":   keys.get("p256dh", ""),
        "auth":     keys.get("auth",   ""),
    }).insert(ignore_permissions=True)
    frappe.db.commit()
    return {"ok": True}


@frappe.whitelist()
def unsubscribe(endpoint):
    """Remove a push subscription for the current user."""
    user = frappe.session.user
    if user != "Guest":
        _rate_limit(user, "unsubscribe")
        frappe.db.delete("PWA Push Subscription", {"user": user, "endpoint": endpoint})
        frappe.db.commit()
    return {"ok": True}


# ── Server-side send helper (call from background jobs, webhooks, etc.) ─────

def send_push(user, title, body, url="/", icon=None):
    """
    Send a push notification to every registered subscription for *user*.
    Silently removes subscriptions that the push service reports as expired.
    Safe to call from background workers.
    """
    from pywebpush import webpush, WebPushException
    from raftor_pwahq.utils.config import get_app

    app = get_app()
    if not app or not app.push_enabled:
        return

    priv_pem = app.get_password("vapid_private_key") if app.vapid_public_key else None
    if not priv_pem:
        return

    # Only relative paths are safe to open on notification click
    if not url or not url.startswith("/") or url.startswith("//"):
        url = "/"

    sender = frappe.conf.get("vapid_sender") or frappe.conf.get("developer_email") or "admin@localhost"
    if not sender.startswith("mailto:"):
        sender = "mailto:" + sender

    payload = json.dumps({
        "title": title,
        "body":  body,
        "url":   url,
        "icon":  icon or "",
        "badge": "",
    })

    sub_records = frappe.get_all(
        "PWA Push Subscription",
        filters={"user": user},
        fields=["name", "endpoint"],
    )

    stale = []
    for rec in sub_records:
        try:
            doc = frappe.get_doc("PWA Push Subscription", rec.name)
            webpush(
                subscription_info={
                    "endpoint": doc.endpoint,
                    "keys": {
                        "p256dh": doc.get_password("p256dh"),
                        "auth":   doc.get_password("auth"),
                    },
                },
                data=payload,
                vapid_private_key=priv_pem,
                vapid_claims={"sub": sender},
            )
        except WebPushException as exc:
            resp = getattr(exc, "response", None)
            if resp is not None and resp.status_code in (404, 410):
                stale.append(rec.endpoint)
        except Exception:
            frappe.log_error(frappe.get_traceback(), "PWA push failed")

    for ep in stale:
        frappe.db.delete("PWA Push Subscription", {"endpoint": ep})
    if stale:
        frappe.db.commit()
