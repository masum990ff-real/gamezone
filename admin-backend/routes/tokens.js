const express = require("express");
const { getDb } = require("../config/firebase");
const { ok, fail, authMiddleware } = require("../middleware/auth");

const router = express.Router();

router.post("/register-token", async (req, res) => {
  try {
    const { token, deviceInfo } = req.body || {};
    if (!token || typeof token !== "string" || token.length < 20) {
      return fail(res, 400, "Valid token required");
    }
    const db = getDb();
    const docId = token.replace(/\//g, "_");
    const ref = db.collection("tokens").doc(docId);
    const snap = await ref.get();
    const now = new Date().toISOString();
    if (snap.exists) {
      await ref.set({ lastActive: now, deviceInfo: deviceInfo || "" }, { merge: true });
    } else {
      await ref.set({ token, deviceInfo: deviceInfo || "", createdAt: now, lastActive: now });
    }
    return ok(res, {}, "Token registered");
  } catch (e) {
    return fail(res, 500, "Failed to register token");
  }
});

router.delete("/tokens/invalid", authMiddleware, async (req, res) => {
  try {
    const { tokens } = req.body || {};
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return fail(res, 400, "tokens array required");
    }
    const db = getDb();
    const batch = db.batch();
    let count = 0;
    for (const t of tokens.slice(0, 500)) {
      batch.delete(db.collection("tokens").doc(String(t).replace(/\//g, "_")));
      count++;
    }
    await batch.commit();
    return ok(res, { deletedCount: count }, "Invalid tokens removed");
  } catch (e) {
    return fail(res, 500, "Cleanup failed");
  }
});

module.exports = router;
