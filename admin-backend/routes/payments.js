const express = require("express");
const { FieldValue } = require("firebase-admin/firestore");
const { getDb, getRtdb, friendlyFirestoreError } = require("../config/firebase");
const { ok, fail, firebaseAuthMiddleware } = require("../middleware/auth");
const { payLimiter } = require("../middleware/rateLimit");

const router = express.Router();

const ZAP_CREATE = "https://pay.zapupi.com/api/create-order";
const ZAP_STATUS = "https://pay.zapupi.com/api/order-status";
const ZAP_SUCCESS_URL = "https://zapupi.com/payment?s=s";
const ZAP_FAILED_URL = "https://zapupi.com/payment?s=f";
const ZAP_TIMEOUT_URL = "https://zapupi.com/payment?s=t";

async function readZapKey(rtdb) {
  const snap = await rtdb.ref("settings/payment").get();
  const v = snap.exists() ? snap.val() : {};
  return v.zapKey || "";
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function postJson(url, body, timeoutMs) {
  const ms = timeoutMs || 30000;
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
  if (!confirmJson) return null;
  const top = String(confirmJson.status || "").trim().toLowerCase();
  if (top !== "success") return null;
  const d = confirmJson.data || {};
  const st = String(d.status || "").trim().toLowerCase();
  if (!["success", "paid", "successful", "completed", "complete", "approved", "test"].includes(st)) return null;
  return d;
}

function isAbortErr(e) {
  return !!e && (e.name === "AbortError" || /abort|timeout/i.test(e.message || ""));
}

function gwCause(e) {
  return (e && e.cause && e.cause.code) || (e && e.message) || "unknown";
}

async function confirmAndCredit(rtdb, orderId, uid, confirmed, fallbackEnv, fallbackTxn, fallbackUtr) {
  const recRef = rtdb.ref("payments/byUid/" + uid + "/" + orderId);
  const env = confirmed.environment || fallbackEnv || "";
  const txn = confirmed.txn_id || fallbackTxn || "";
  const utr = confirmed.utr || fallbackUtr || "";
  if (isTestPayment(env, txn)) {
    await recRef.update({ status: "test", txn_id: txn, utr: utr, updatedAt: new Date().toISOString() });
    return "test";
  }
  let credited = 0;
  await recRef.transaction((cur) => {
    if (!cur || cur.status !== "pending") return;
    credited = Number(cur.amount) || 0;
    cur.status = "success";
    cur.txn_id = txn;
    cur.utr = utr;
    cur.updatedAt = new Date().toISOString();
    return cur;
  });
  if (credited > 0) {
    await getDb().collection("users").doc(uid).update({
      depositCoins: FieldValue.increment(credited),
    });
    return "success";
  }
  try {
    const snap = await recRef.get();
    if (snap.exists()) return String(snap.val().status || "success");
  } catch (e) {}
  return "success";
}

function gatewayLocalStatus(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "pending" || s === "created" || s === "initiated") return "pending";
  if (s === "success" || s === "paid" || s === "successful" || s === "completed" || s === "complete" || s === "approved" || s === "test") return "success";
  if (s === "failed" || s === "fail" || s === "failure" || s === "rejected" || s === "cancelled" || s === "canceled") return "failed";
  return "timeout";
}

router.post("/create-order", firebaseAuthMiddleware, payLimiter, async (req, res) => {
  try {
    const uid = req.user.uid;
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
    const orderId = "ORD" + Date.now() + String(uid).slice(-4);
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
      success_url: ZAP_SUCCESS_URL,
      failed_url: ZAP_FAILED_URL,
      timeout_url: ZAP_TIMEOUT_URL,
    };
    if (phone) gwBody.customer_mobile = phone;
    console.error("[create-order] gateway POST start order=" + orderId + " webhook=" + gwBody.webhook_url + " hasPhone=" + (!!phone));
    let gw = null;
    let lastErr = null;
    const waits = [0, 3000, 8000];
    for (let i = 0; i < 3; i++) {
      if (waits[i] > 0) await sleep(waits[i]);
      try {
        gw = await postJson(ZAP_CREATE, gwBody, 30000);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        console.error("[create-order] gateway attempt " + (i + 1) + " threw after " + (Date.now() - t0) + "ms: " + (e && e.name) + ": " + gwCause(e));
      }
    }
    if (!gw) {
      try {
        const chk = await postJson(ZAP_STATUS, { zap_key: zapKey, order_id: orderId }, 30000);
        const d = (chk.json && chk.json.data) || {};
        const gs = String(d.status || "");
        const gl = gs.trim().toLowerCase();
        if (chk.json && String(chk.json.status || "").trim().toLowerCase() === "success" && gatewayLocalStatus(gs) !== "timeout") {
          const now = new Date().toISOString();
          try {
            const ex = await rtdb.ref("payments/byUid/" + uid + "/" + orderId).get();
            if (!ex.exists()) {
              await rtdb.ref("payments/byUid/" + uid + "/" + orderId).set({ uid, amount, status: "pending", createdAt: now });
            }
          } catch (e) {}
          try {
            await rtdb.ref("payments/byOrder/" + orderId).set({ uid });
          } catch (e) {}
          const paymentUrl = d.payment_url || d.paymentUrl || d.url || chk.json.payment_url || "";
          console.error("[create-order] timeout-recovery found order=" + orderId + " gwStatus=" + gs + " hasUrl=" + (!!paymentUrl));
          if (paymentUrl) {
            return ok(res, { payment_url: paymentUrl, order_id: orderId, recovered: true, status: gl }, "");
          }
          if (gatewayLocalStatus(gs) === "success") {
            const result = await confirmAndCredit(rtdb, orderId, uid, d, "", "", "");
            return ok(res, { payment_url: "", order_id: orderId, recovered: true, status: result }, "");
          }
          if (gatewayLocalStatus(gs) === "failed") {
            try {
              await rtdb.ref("payments/byUid/" + uid + "/" + orderId).update({ status: "failed", updatedAt: now });
            } catch (e) {}
            return ok(res, { payment_url: "", order_id: orderId, recovered: true, status: "failed" }, "");
          }
          return ok(res, { payment_url: "", order_id: orderId, recovered: true, status: "pending" }, "");
        }
      } catch (e) {
        console.error("[create-order] timeout-recovery status check failed:", gwCause(e));
      }
      const cause = gwCause(lastErr);
      if (isAbortErr(lastErr)) {
        return fail(res, 504, "Payment gateway timeout, try again");
      }
      return fail(res, 502, "Payment gateway unreachable (" + String(cause).slice(0, 60) + "), try again");
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

router.post("/:orderId/refresh", firebaseAuthMiddleware, payLimiter, async (req, res) => {
  try {
    const uid = req.user.uid;
    const orderId = String(req.params.orderId || "");
    if (!orderId) return fail(res, 404, "Order not found");
    const rtdb = getRtdb();
    const ptr = await rtdb.ref("payments/byOrder/" + orderId).get();
    if (!ptr.exists() || !ptr.val() || ptr.val().uid !== uid) {
      return fail(res, 404, "Order not found");
    }
    let zapKey = "";
    try {
      zapKey = await readZapKey(rtdb);
    } catch (e) {
      console.error("Refresh key read failed:", e.message);
    }
    if (!zapKey) return fail(res, 400, "Payment gateway not configured");
    let gw;
    try {
      gw = await postJson(ZAP_STATUS, { zap_key: zapKey, order_id: orderId }, 30000);
    } catch (e) {
      console.error("Refresh status fetch failed:", gwCause(e));
      return fail(res, 502, "Payment gateway unreachable (" + String(gwCause(e)).slice(0, 60) + "), try again");
    }
    const d = (gw.json && gw.json.data) || {};
    const gs = String(d.status || "");
    const local = gatewayLocalStatus(gs);
    console.error("[refresh] order=" + orderId + " http=" + gw.http + " top=" + String(gw.json && gw.json.status) + " gs=" + gs + " local=" + local + " raw=" + (gw.raw || ""));
    const recRef = rtdb.ref("payments/byUid/" + uid + "/" + orderId);
    const now = new Date().toISOString();
    if (local === "pending") {
      try {
        await recRef.update({ status: "pending", updatedAt: now });
      } catch (e) {}
      return ok(res, { status: "pending" }, "");
    }
    if (local === "success") {
      const confirmed = confirmedPaid(gw.json) || d;
      const result = await confirmAndCredit(rtdb, orderId, uid, confirmed, "", "", "");
      return ok(res, { status: result }, "");
    }
    if (local === "failed") {
      try {
        await recRef.update({ status: "failed", txn_id: d.txn_id || "", utr: d.utr || "", updatedAt: now });
      } catch (e) {}
      return ok(res, { status: "failed" }, "");
    }
    try {
      await recRef.update({ status: "timeout", updatedAt: now });
    } catch (e) {}
    return ok(res, { status: "timeout" }, "");
  } catch (e) {
    console.error("Refresh failed:", e.message);
    return fail(res, 500, "Failed to refresh order: " + friendlyFirestoreError(e));
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
    const wst = String(status || "").trim().toLowerCase();
    if (wst === "success" || wst === "paid" || wst === "successful" || wst === "completed" || wst === "approved" || wst === "test") {
      let zapKey = "";
      try {
        zapKey = await readZapKey(rtdb);
      } catch (e) {
        console.error("Webhook key read failed:", e.message);
      }
      let confirmed = null;
      if (zapKey) {
        try {
          const gw = await postJson(ZAP_STATUS, { zap_key: zapKey, order_id }, 30000);
          confirmed = confirmedPaid(gw.json);
          if (!confirmed) console.error("Webhook confirm not-paid order=" + order_id + " http=" + gw.http + " body=" + (gw.raw || ""));
        } catch (e) {
          console.error("Webhook confirm failed:", gwCause(e));
        }
      }
      if (!confirmed) {
        console.error("Webhook unconfirmed success:", order_id);
        return res.status(200).json({ status: "ok" });
      }
      await confirmAndCredit(rtdb, order_id, uid, confirmed, environment, txn_id, utr);
      return res.status(200).json({ status: "ok" });
    }
    if (wst === "failed" || wst === "fail" || wst === "failure" || wst === "rejected" || wst === "cancelled" || wst === "canceled") {
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
