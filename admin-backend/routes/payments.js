const express = require("express");
const { FieldValue } = require("firebase-admin/firestore");
const { getDb, getRtdb, friendlyFirestoreError } = require("../config/firebase");
const { ok, fail, firebaseAuthMiddleware } = require("../middleware/auth");
const { payLimiter } = require("../middleware/rateLimit");

const router = express.Router();

const ZAP_CREATE = "https://pay.zapupi.com/api/create-order";
const ZAP_STATUS = "https://pay.zapupi.com/api/order-status";

async function readZapKey(rtdb) {
  const snap = await rtdb.ref("settings/payment").get();
  const v = snap.exists() ? snap.val() : {};
  return v.zapKey || "";
}

async function postJson(url, body, timeoutMs) {
  const ms = timeoutMs || 25000;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    try {
      return { http: res.status, json: JSON.parse(text), raw: text.slice(0, 500) };
    } catch (e) {
      return { http: res.status, json: {}, raw: text.slice(0, 500) };
    }
  } finally {
    clearTimeout(timer);
  }
}

function isTestPayment(environment, txnId) {
  return environment === "test" || String(txnId || "").startsWith("DUMMY");
}

function confirmedPaid(confirmJson) {
  if (!confirmJson || confirmJson.status !== "success") return null;
  const d = confirmJson.data || {};
  const st = String(d.status || "");
  if (!["Success", "success", "paid", "PAID"].includes(st)) return null;
  return d;
}

router.post("/create-order", firebaseAuthMiddleware, payLimiter, async (req, res) => {
  try {
    const amount = parseInt(req.body && req.body.amount);
    if (!Number.isInteger(amount) || amount < 10 || amount > 1000) {
      return fail(res, 400, "Amount must be an integer between 10 and 1000");
    }
    const rtdb = getRtdb();
    const t0 = Date.now();
    const zapKey = await readZapKey(rtdb);
    console.error("[create-order] start uid=" + uid + " amount=" + amount + " keyPresent=" + (!!zapKey));
    if (!zapKey) {
      console.error("[create-order] no zap_key in RTDB settings/payment");
      return fail(res, 400, "Payment gateway not configured");
    }
    const uid = req.user.uid;
    const orderId = "ORD" + Date.now() + uid.slice(-4);
    let phone = "";
    try {
      const usnap = await getDb().collection("users").doc(uid).get();
      if (usnap.exists) phone = String(usnap.data().phone || "");
    } catch (e) {
      console.error("Create-order phone lookup failed:", e.message);
    }
    const base = (process.env.BACKEND_URL || "https://gamezone-sa5x.onrender.com").replace(/\/+$/, "");
    const gwBody = {
      zap_key: zapKey,
      order_id: orderId,
      amount: String(amount),
      remark: "GAMEZONE|" + uid,
      webhook_url: base + "/api/payments/webhook",
    };
    if (phone) gwBody.customer_mobile = phone;
    console.error("[create-order] gateway POST start order=" + orderId + " webhook=" + gwBody.webhook_url + " hasPhone=" + (!!phone));
    let gw;
    try {
      gw = await postJson(ZAP_CREATE, gwBody, 25000);
    } catch (e) {
      console.error("[create-order] gateway fetch threw after " + (Date.now() - t0) + "ms: " + (e && e.name) + ": " + (e && e.message));
      if (e && (e.name === "AbortError" || /abort|timeout/i.test(e.message || ""))) {
        return fail(res, 504, "Payment gateway timeout, try again");
      }
      return fail(res, 502, "Payment gateway unreachable, try again");
    }
    console.error("[create-order] gateway done in " + (Date.now() - t0) + "ms http=" + gw.http + " status=" + (gw.json && gw.json.status));
    if (gw.json.status !== "success" || !gw.json.payment_url) {
      console.error("[create-order] gateway rejected order=" + orderId + " http=" + gw.http + " body=" + (gw.raw || ""));
      const gm = String((gw.json && gw.json.message) || "").slice(0, 200);
      return fail(res, 502, "Payment failed: " + (gm || ("gateway HTTP " + gw.http)));
    }
    const now = new Date().toISOString();
    await rtdb.ref("payments/byUid/" + uid + "/" + orderId).set({
      uid,
      amount,
      status: "pending",
      createdAt: now,
    });
    await rtdb.ref("payments/byOrder/" + orderId).set({ uid });
    return ok(res, { payment_url: gw.json.payment_url, order_id: orderId }, "");
  } catch (e) {
    console.error("Create-order failed:", e.message);
    return fail(res, 500, "Failed to create order: " + friendlyFirestoreError(e));
  }
});

router.post("/webhook", async (req, res) => {
  try {
    const { order_id, status, txn_id, utr, environment } = req.body || {};
    if (!order_id) {
      return res.status(200).json({ status: "ok" });
    }
    const rtdb = getRtdb();
    const ptr = await rtdb.ref("payments/byOrder/" + order_id).get();
    if (!ptr.exists()) {
      console.error("Webhook unknown order:", order_id);
      return res.status(200).json({ status: "ok" });
    }
    const uid = ptr.val().uid;
    const recRef = rtdb.ref("payments/byUid/" + uid + "/" + order_id);
    if (status === "Success") {
      let zapKey = "";
      try {
        zapKey = await readZapKey(rtdb);
      } catch (e) {
        console.error("Webhook key read failed:", e.message);
      }
      let confirmed = null;
      if (zapKey) {
        try {
          const gw = await postJson(ZAP_STATUS, { zap_key: zapKey, order_id }, 25000);
          confirmed = confirmedPaid(gw.json);
          if (!confirmed) console.error("Webhook confirm not-paid order=" + order_id + " http=" + gw.http + " body=" + (gw.raw || ""));
        } catch (e) {
          console.error("Webhook confirm failed:", e.message);
        }
      }
      if (!confirmed) {
        console.error("Webhook unconfirmed success:", order_id);
        return res.status(200).json({ status: "ok" });
      }
      const env = confirmed.environment || environment || "";
      const txn = confirmed.txn_id || txn_id || "";
      if (isTestPayment(env, txn)) {
        await recRef.update({ status: "test", txn_id: txn, utr: confirmed.utr || utr || "", updatedAt: new Date().toISOString() });
        return res.status(200).json({ status: "ok" });
      }
      let credited = 0;
      await recRef.transaction((cur) => {
        if (!cur || cur.status !== "pending") return;
        credited = Number(cur.amount) || 0;
        cur.status = "success";
        cur.txn_id = txn;
        cur.utr = confirmed.utr || utr || "";
        cur.updatedAt = new Date().toISOString();
        return cur;
      });
      if (credited > 0) {
        await getDb().collection("users").doc(uid).update({
          depositCoins: FieldValue.increment(credited),
        });
      }
      return res.status(200).json({ status: "ok" });
    }
    if (status === "Failed") {
      await recRef.update({
        status: "failed",
        txn_id: txn_id || "",
        utr: utr || "",
        updatedAt: new Date().toISOString(),
      });
      return res.status(200).json({ status: "ok" });
    }
    return res.status(200).json({ status: "ok" });
  } catch (e) {
    console.error("Webhook failed:", e.message);
    return res.status(200).json({ status: "ok" });
  }
});

module.exports = router;
