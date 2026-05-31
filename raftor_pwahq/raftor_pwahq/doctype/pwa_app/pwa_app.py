import frappe
from frappe.model.document import Document


class PWAApp(Document):
    def validate(self):
        self.short_name = (self.short_name or self.app_name or "App")[:12]

    def on_update(self):
        if self.push_enabled and not self.vapid_public_key:
            self._generate_vapid_keys()
        # Clear config cache so the next request picks up any change
        frappe.cache().delete_keys("pwahq:*")

    def _generate_vapid_keys(self):
        import base64
        from py_vapid import Vapid
        from cryptography.hazmat.primitives.serialization import (
            Encoding, PublicFormat, PrivateFormat, NoEncryption,
        )

        vapid = Vapid()
        vapid.generate_keys()

        pub = base64.urlsafe_b64encode(
            vapid.public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
        ).rstrip(b"=").decode()

        priv_pem = vapid.private_key.private_bytes(
            Encoding.PEM, PrivateFormat.TraditionalOpenSSL, NoEncryption()
        ).decode()

        frappe.db.set_value("PWA App", self.name, "vapid_public_key", pub)
        self.vapid_public_key = pub
        self.set_password("vapid_private_key", priv_pem)


@frappe.whitelist()
def regenerate_vapid_keys(docname):
    """Clear existing VAPID keys and generate fresh ones. Called from form action."""
    frappe.db.set_value("PWA App", docname, "vapid_public_key", "")
    doc = frappe.get_doc("PWA App", docname)
    doc.vapid_public_key = ""
    doc._generate_vapid_keys()
    frappe.db.commit()
    frappe.cache().delete_keys("pwahq:*")
    return frappe.db.get_value("PWA App", docname, "vapid_public_key")


@frappe.whitelist()
def clear_pwa_cache():
    """Flush all PWA config and nav caches site-wide. Called from form toolbar."""
    frappe.only_for("System Manager")
    frappe.cache().delete_keys("pwahq:*")
    return {"ok": True, "message": "PWA cache cleared"}


@frappe.whitelist()
def send_test_push(docname):
    """Send a test push to every subscription of the calling user."""
    frappe.only_for("System Manager")
    from raftor_pwahq.api.push import send_push
    user = frappe.session.user
    send_push(
        user=user,
        title="PWA Test Notification",
        body="Push notifications are working correctly.",
        url="/",
    )
    return {"ok": True, "message": f"Test push sent to {user}"}
