const express = require("express");
const { getDb, getRtdb } = require("../config/firebase");
const { ok, fail, authMiddleware } = require("../middleware/auth");

const router = express.Router();

router.get("/", authMiddleware, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const onlyUid = String(req.query.uid || "").trim().slice(0, 64);
    const rtdb = getRtdb();
    const all = [];
    // Fast path: ?uid= reads only that user's node instead of the whole tree.
    const collect = (userSnap) => {
      userSnap.forEach((orderSnap) => {
        const v = orderSnap.val() || {};
        all.push({
          orderId: orderSnap.key,
          uid: userSnap.key,
          amount: v.amount || 0,
          status: v.status || "pending",
          txnId: v.txn_id || "",
          utr: v.utr || "",
          createdAt: v.createdAt || "",
        });
      });
    };
    if (onlyUid) {
      const one = await rtdb.ref("payments/byUid/" + onlyUid).get();
      if (one.exists()) collect(one);
    } else {
      // Load only recent payments across all users (max 200) instead of the full tree.
      const snap = await rtdb.ref("payments/byUid").orderByKey().limitToLast(200).get();
      if (snap.exists()) snap.forEach(collect);
    }
    all.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const total = all.length;
    const items = all.slice((page - 1) * limit, page * limit);
    const db = getDb();
    const refs = [...new Set(items.map((i) => i.uid))].map((uid) => db.collection("users").doc(uid));
    const docs = refs.length ? await db.getAll(...refs) : [];
    const users = {};
    docs.forEach((d) => {
      if (d.exists) users[d.id] = d.data();
    });
    items.forEach((i) => {
      const u = users[i.uid] || {};
      i.username = u.username || "";
      i.email = u.email || "";
      i.phone = u.phone || "";
    });
    return ok(res, { items, page, limit, total, totalPages: Math.ceil(total / limit) }, "");
  } catch (e) {
    console.error("Deposit list failed:", e.message);
    return fail(res, 500, "Failed to load deposits: " + (e.message || e));
  }
});

module.exports = router;
