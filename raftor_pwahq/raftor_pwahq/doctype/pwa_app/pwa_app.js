frappe.ui.form.on("PWA App", {
    refresh(frm) {
        if (frm.doc.__islocal) return;

        frm.add_custom_button(__("Clear PWA Cache"), function () {
            frappe.call({
                method: "raftor_pwahq.raftor_pwahq.doctype.pwa_app.pwa_app.clear_pwa_cache",
                callback(r) {
                    if (!r.exc) frappe.msgprint(__("PWA cache cleared successfully."));
                },
            });
        }, __("Actions"));

        if (frm.doc.push_enabled && frm.doc.vapid_public_key) {
            frm.add_custom_button(__("Send Test Push"), function () {
                frappe.call({
                    method: "raftor_pwahq.raftor_pwahq.doctype.pwa_app.pwa_app.send_test_push",
                    args: { docname: frm.doc.name },
                    callback(r) {
                        if (!r.exc) frappe.msgprint(r.message && r.message.message || __("Test push sent."));
                    },
                });
            }, __("Actions"));

            frm.add_custom_button(__("Regenerate VAPID Keys"), function () {
                frappe.confirm(
                    __("Regenerating VAPID keys will invalidate all existing push subscriptions. Continue?"),
                    function () {
                        frappe.call({
                            method: "raftor_pwahq.raftor_pwahq.doctype.pwa_app.pwa_app.regenerate_vapid_keys",
                            args: { docname: frm.doc.name },
                            callback(r) {
                                if (!r.exc) {
                                    frappe.msgprint(__("VAPID keys regenerated. All users must re-subscribe to push notifications."));
                                    frm.reload_doc();
                                }
                            },
                        });
                    }
                );
            }, __("Actions"));
        }
    },

    push_enabled(frm) {
        // Auto-save triggers on_update which generates VAPID keys when first enabled
        if (frm.doc.push_enabled && !frm.doc.vapid_public_key) {
            frappe.msgprint(__("Save the document to auto-generate VAPID keys."));
        }
    },
});
