const express = require("express");
const { getRtdb } = require("../config/firebase");
const { ok, fail, authMiddleware } = require("../middleware/auth");

const router = express.Router();

function mask(key) {
  if (!key) return "";
  const s = String(key);
  return "****" + s.slice(-4);
}

function webhookUrl() {
  const base = (process.env.BACKEND_URL || "https://gamezone-sa5x.onrender.com").replace(/\/+$/, "");
  return base + "/api/payments/webhook";
}

router.get("/", authMiddleware, async (req, res) => {
  try {
    const snap = await getRtdb().ref("settings/payment").get();
    const v = snap.exists() ? snap.val() : {};
    const zapKey = v.zapKey || "";
    return ok(res, { configured: !!zapKey, masked: mask(zapKey), webhookUrl: webhookUrl() }, "");
  } catch (e) {
    console.error("Payment config load failed:", e.message);
    return fail(res, 500, "Failed to load payment config");
  }
});

router.put("/", authMiddleware, async (req, res) => {
  try {
    const zapKey = String((req.body && req.body.zapKey) || "").trim();
    if (!zapKey || zapKey.length < 10 || zapKey.length > 200) {
      return fail(res, 400, "Gateway key must be 10-200 characters");
    }
    const rtdb = getRtdb();
    await rtdb.ref("settings/payment").update({
      zapKey,
      updatedAt: new Date().toISOString(),
      updatedBy: req.admin.email,
    });
    return ok(res, { configured: true, masked: mask(zapKey), webhookUrl: webhookUrl() }, "Payment key saved");
  } catch (e) {
    console.error("Payment config save failed:", e.message);
    return fail(res, 500, "Failed to save payment key");
  }
});

module.exports = router;
