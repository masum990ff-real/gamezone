const express = require("express");
const { FieldValue } = require("firebase-admin/firestore");
const { getDb, getApp, getRtdb, friendlyFirestoreError } = require("../config/firebase");
const { ok, fail, authMiddleware, firebaseAuthMiddleware } = require("../middleware/auth");
const { syncLimiter } = require("../middleware/rateLimit");

const router = express.Router();

router.get("/resolve-refer", syncLimiter, async (req, res) => {
  try {
    const code = String(req.query.code || "").trim();
    if (!code) return fail(res, 400, "Refer code required");
    const db = getDb();
    const snap = await db.collection("users").where("username", "==", code).limit(1).get();
    if (snap.empty) return fail(res, 404, "Invalid refer code");
    return ok(res, { username: code }, "Valid refer code");
  } catch (e) {
    console.error("Resolve refer failed:", e.message);
    return fail(res, 500, "Failed to check refer code: " + friendlyFirestoreError(e));
  }
});

router.post("/sync", firebaseAuthMiddleware, syncLimiter, async (req, res) => {
  try {
    const { username, phone, referCode } = req.body || {};
    if (username && !/^[A-Za-z0-9_]{3,30}$/.test(username)) {
      return fail(res, 400, "Username 3-30 chars, letters/numbers/underscore only");
    }
    const digits = String(phone || "").replace(/\D/g, "");
    if (phone && !/^\d{6,15}$/.test(digits)) {
      return fail(res, 400, "Invalid phone number");
    }
    const db = getDb();
    const usersCol = db.collection("users");
    if (username) {
      const dup = await usersCol.where("username", "==", username).limit(1).get();
      if (!dup.empty && dup.docs[0].id !== req.user.uid) {
        return fail(res, 400, "Username already taken");
      }
    }
    const ref = usersCol.doc(req.user.uid);
    const snap = await ref.get();
    const now = new Date().toISOString();
    if (snap.exists) {
      const update = { lastActive: now };
      if (username) update.username = username;
      if (phone !== undefined) update.phone = digits;
      await ref.set(update, { merge: true });
    } else {
      let bonus = 0;
      let referrerUid = null;
      const code = String(referCode || "").trim();
      const settings = await getRtdb().ref("settings/app").get()
        .then((s) => (s.exists() ? s.val() : {})).catch(() => ({}));
      const referCoins = Math.max(0, parseInt(settings.referCoins) || 0);
      if (code) {
        if (code === username) return fail(res, 400, "You cannot use your own refer code");
        const rq = await usersCol.where("username", "==", code).limit(1).get();
        if (!rq.empty) {
          referrerUid = rq.docs[0].id;
          bonus = referCoins;
        }
      }
      const batch = db.batch();
      batch.set(ref, {
        email: req.user.email || "",
        username: username || "",
        phone: digits,
        coins: bonus,
        banned: false,
        banReason: "",
        createdAt: now,
        lastActive: now,
      });
      if (referrerUid && bonus > 0) {
        batch.update(usersCol.doc(referrerUid), { coins: FieldValue.increment(bonus) });
        batch.set(db.collection("referrals").doc(req.user.uid), {
          by: referrerUid,
          code,
          coins: bonus,
          at: now,
        });
      }
      await batch.commit();
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
