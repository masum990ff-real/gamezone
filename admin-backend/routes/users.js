const express = require("express");
const { getDb, getApp, friendlyFirestoreError } = require("../config/firebase");
const { ok, fail, authMiddleware, firebaseAuthMiddleware } = require("../middleware/auth");
const { syncLimiter } = require("../middleware/rateLimit");

const router = express.Router();

router.post("/sync", firebaseAuthMiddleware, syncLimiter, async (req, res) => {
  try {
    const { username, phone } = req.body || {};
    if (username && !/^[A-Za-z0-9_]{3,30}$/.test(username)) {
      return fail(res, 400, "Username 3-30 chars, letters/numbers/underscore only");
    }
    const digits = String(phone || "").replace(/\D/g, "");
    if (phone && !/^\d{6,15}$/.test(digits)) {
      return fail(res, 400, "Invalid phone number");
    }
    const db = getDb();
    const ref = db.collection("users").doc(req.user.uid);
    const snap = await ref.get();
    const now = new Date().toISOString();
    if (snap.exists) {
      const update = { lastActive: now };
      if (username) update.username = username;
      if (phone !== undefined) update.phone = digits;
      await ref.set(update, { merge: true });
    } else {
      await ref.set({
        email: req.user.email || "",
        username: username || "",
        phone: digits,
        coins: 0,
        banned: false,
        banReason: "",
        createdAt: now,
        lastActive: now,
      });
    }
    const profile = (await ref.get()).data();
    if (profile.banned) return fail(res, 403, "This account is banned" + (profile.banReason ? ": " + profile.banReason : ""));
    return ok(res, { uid: req.user.uid, ...profile }, "Profile synced");
  } catch (e) {
    console.error("User sync failed:", e.message);
    return fail(res, 500, "Failed to sync profile: " + friendlyFirestoreError(e));
  }
});

router.get("/me", firebaseAuthMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const snap = await db.collection("users").doc(req.user.uid).get();
    if (!snap.exists) return fail(res, 404, "Profile not found");
    const profile = snap.data();
    if (profile.banned) return fail(res, 403, "This account is banned" + (profile.banReason ? ": " + profile.banReason : ""));
    return ok(res, { uid: req.user.uid, ...profile }, "");
  } catch (e) {
    console.error("User me failed:", e.message);
    return fail(res, 500, "Failed to load profile: " + friendlyFirestoreError(e));
  }
});

router.get("/", authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const db = getDb();
    const snap = await db.collection("users").orderBy("lastActive", "desc").limit(limit).get();
    const items = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    return ok(res, { items, total: items.length }, "");
  } catch (e) {
    console.error("User list failed:", e.message);
    return fail(res, 500, "Failed to load users: " + friendlyFirestoreError(e));
  }
});

router.post("/:uid/ban", authMiddleware, async (req, res) => {
  try {
    const reason = (req.body && req.body.reason) || "";
    const db = getDb();
    await db.collection("users").doc(req.params.uid).set({
      banned: true,
      banReason: String(reason).slice(0, 200),
      bannedAt: new Date().toISOString(),
      bannedBy: req.admin.email,
    }, { merge: true });
    await getApp().auth().updateUser(req.params.uid, { disabled: true });
    return ok(res, {}, "User banned");
  } catch (e) {
    console.error("Ban failed:", e.message);
    return fail(res, 500, "Failed to ban user: " + friendlyFirestoreError(e));
  }
});

router.post("/:uid/unban", authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    await db.collection("users").doc(req.params.uid).set({
      banned: false,
      banReason: "",
    }, { merge: true });
    await getApp().auth().updateUser(req.params.uid, { disabled: false });
    return ok(res, {}, "User unbanned");
  } catch (e) {
    console.error("Unban failed:", e.message);
    return fail(res, 500, "Failed to unban user: " + friendlyFirestoreError(e));
  }
});

module.exports = router;
