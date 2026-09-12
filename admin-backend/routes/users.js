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

router.get("/resolve-username", syncLimiter, async (req, res) => {
  try {
    const name = String(req.query.u || "").trim();
    if (!/^(?=.*[A-Za-z])[A-Za-z0-9_]{6,30}$/.test(name)) {
      return fail(res, 400, "Username 6-30 chars, must include a letter");
    }
    const db = getDb();
    const snap = await db.collection("users").where("username", "==", name).limit(1).get();
    if (!snap.empty) return fail(res, 409, "Username already taken");
    return ok(res, { username: name }, "Username available");
  } catch (e) {
    console.error("Resolve username failed:", e.message);
    return fail(res, 500, "Failed to check username: " + friendlyFirestoreError(e));
  }
});

router.post("/resolve-login", syncLimiter, async (req, res) => {
  try {
    const identifier = String((req.body && req.body.identifier) || "").trim();
    if (!identifier) return fail(res, 400, "Account not found");
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
      return ok(res, { email: identifier }, "");
    }
    const db = getDb();
    if (/^\d{10}$/.test(identifier)) {
      const snap = await db.collection("users").where("phone", "==", identifier).limit(1).get();
      if (snap.empty) return fail(res, 404, "Account not found");
      return ok(res, { email: snap.docs[0].data().email || "" }, "");
    }
    const snap = await db.collection("users").where("username", "==", identifier).limit(1).get();
    if (snap.empty) return fail(res, 404, "Account not found");
    return ok(res, { email: snap.docs[0].data().email || "" }, "");
  } catch (e) {
    console.error("Resolve login failed:", e.message);
    return fail(res, 500, "Failed to resolve login: " + friendlyFirestoreError(e));
  }
});

router.post("/sync", firebaseAuthMiddleware, syncLimiter, async (req, res) => {
  try {
    const { username, phone, referCode } = req.body || {};
    const db = getDb();
    const usersCol = db.collection("users");
    const ref = usersCol.doc(req.user.uid);
    const snap = await ref.get();
    const isNew = !snap.exists;
    if (isNew) {
      if (!/^(?=.*[A-Za-z])[A-Za-z0-9_]{6,30}$/.test(username || "")) {
        return fail(res, 400, "Username 6-30 chars, must include a letter");
      }
      if (!/^\d{10}$/.test(String(phone || "").replace(/\D/g, ""))) {
        return fail(res, 400, "Phone number must be exactly 10 digits");
      }
    } else if (username && !/^(?=.*[A-Za-z])[A-Za-z0-9_]{6,30}$/.test(username)) {
      return fail(res, 400, "Username 6-30 chars, must include a letter");
    }
    const digits = String(phone || "").replace(/\D/g, "");
    if (phone && !/^\d{10}$/.test(digits)) {
      return fail(res, 400, "Phone number must be exactly 10 digits");
    }
    if (username) {
      const dup = await usersCol.where("username", "==", username).limit(1).get();
      if (!dup.empty && dup.docs[0].id !== req.user.uid) {
        return fail(res, 400, "Username already taken");
      }
    }
    const now = new Date().toISOString();
    if (snap.exists) {
      const update = { lastActive: now };
      if (username) update.username = username;
      if (digits) update.phone = digits;
      const old = snap.data() || {};
      if (old.bonusCoins === undefined && (old.coins || 0) > 0) {
        update.bonusCoins = old.coins;
        update.coins = 0;
      }
      await ref.set(update, { merge: true });
    } else {
      let bonus = 0;
      let referrerUid = null;
      const code = String(referCode || "").trim();
      const settings = await getRtdb().ref("settings/app").get()
        .then((s) => (s.exists() ? s.val() : {})).catch(() => ({}));
      const parsed = parseInt(settings.referCoins);
      const referCoins = isNaN(parsed) ? 5 : Math.max(0, Math.min(10000, parsed));
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
        coins: 0,
        bonusCoins: bonus,
        depositCoins: 0,
        winCoins: 0,
        lifetimeWin: 0,
        banned: false,
        banReason: "",
        createdAt: now,
        lastActive: now,
      });
      if (referrerUid && bonus > 0) {
        batch.update(usersCol.doc(referrerUid), { bonusCoins: FieldValue.increment(bonus) });
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
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const q = String(req.query.q || "").trim();
    const db = getDb();
    const col = db.collection("users");
    if (q) {
      const base = col.orderBy("username").startAt(q).endAt(q + "\uf8ff");
      const totalSnap = await base.count().get();
      const total = totalSnap.data().count;
      const snap = await base.limit(limit).offset((page - 1) * limit).get();
      const items = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
      return ok(res, { items, page, limit, total, totalPages: Math.ceil(total / limit) }, "");
    }
    const totalSnap = await col.count().get();
    const total = totalSnap.data().count;
    const snap = await col.orderBy("lastActive", "desc").limit(limit).offset((page - 1) * limit).get();
    const items = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    return ok(res, { items, page, limit, total, totalPages: Math.ceil(total / limit) }, "");
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
