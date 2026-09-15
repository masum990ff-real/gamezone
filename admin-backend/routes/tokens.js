const express = require("express");
const { getDb, getApp, friendlyFirestoreError } = require("../config/firebase");
const { ok, fail, authMiddleware, firebaseAuthMiddleware } = require("../middleware/auth");
const { registerLimiter } = require("../middleware/rateLimit");

const router = express.Router();

router.post("/register-token", registerLimiter, firebaseAuthMiddleware, async (req, res) => {
  try {
    const { token, deviceInfo } = req.body || {};
    if (!token || typeof token !== "string" || token.length < 20 || token.length > 500) {
      return fail(res, 400, "Valid token required");
    }
    if (deviceInfo && (typeof deviceInfo !== "string" || deviceInfo.length > 200)) {
      return fail(res, 400, "Device info too long");
    }
    let uid = "";
    const authHeader = req.headers.authorization || "";
    if (authHeader.startsWith("Bearer ")) {
      try {
        const idToken = authHeader.slice(7).trim();
        if (idToken) {
          const decoded = await getApp().auth().verifyIdToken(idToken);
          uid = decoded.uid || "";
        }
      } catch (e) {}
    }
    if (!uid && req.body && typeof req.body.uid === "string") {
      uid = String(req.body.uid).trim().slice(0, 128);
    }
    const db = getDb();
    const docId = token.replace(/\//g, "_");
    const ref = db.collection("tokens").doc(docId);
    const snap = await ref.get();
    const now = new Date().toISOString();
    const base = { lastActive: now, deviceInfo: deviceInfo || "" };
    if (uid) base.uid = uid;
    if (snap.exists) {
      await ref.set(base, { merge: true });
      if (!snap.data().token) await ref.set({ token }, { merge: true });
    } else {
      await ref.set({ token, deviceInfo: deviceInfo || "", createdAt: now, lastActive: now, ...(uid ? { uid } : {}) });
    }
    return ok(res, {}, "Token registered");
  } catch (e) {
    console.error("Token register failed:", e.message);
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
