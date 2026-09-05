const express = require("express");
const { getDb, getMessaging, friendlyFirestoreError } = require("../config/firebase");
const { ok, fail, authMiddleware } = require("../middleware/auth");

const router = express.Router();
const TOPIC = "all_users";

router.post("/send", authMiddleware, async (req, res) => {
  try {
    const { title, body, imageUrl } = req.body || {};
    if (!title || !body) return fail(res, 400, "Title and body required");
    if (title.length > 100 || body.length > 500) {
      return fail(res, 400, "Title max 100 chars, body max 500 chars");
    }
    if (imageUrl && !/^https:\/\/.+/i.test(imageUrl)) {
      return fail(res, 400, "Image URL must start with https://");
    }

    const notification = { title, body };
    if (imageUrl) notification.imageUrl = imageUrl;

    const message = {
      topic: TOPIC,
      notification,
      android: {
        priority: "high",
        notification: { sound: "default", image: imageUrl || undefined },
      },
      data: { title, body, image: imageUrl || "" },
    };

    const messaging = getMessaging();
    let messageId;
    try {
      messageId = await messaging.send(message);
    } catch (e) {
      console.error("FCM send failed:", e.message);
      return fail(res, 500, "FCM send failed: " + e.message);
    }

    const db = getDb();
    try {
      const countSnap = await db.collection("tokens").count().get();
      const successCount = countSnap.data().count;
      const entry = {
        title,
        body,
        imageUrl: imageUrl || "",
        sentAt: new Date().toISOString(),
        successCount,
        failureCount: 0,
        sentBy: req.admin.email,
        messageId,
      };
      const docRef = await db.collection("notifications_history").add(entry);
      return ok(res, { id: docRef.id, messageId, successCount }, "Notification sent");
    } catch (e) {
      console.error("History save failed:", e.message);
      return fail(res, 500, "Push sent but history save failed: " + friendlyFirestoreError(e));
    }
  } catch (e) {
    console.error("Send error:", e.message);
    return fail(res, 500, "Failed to send notification: " + e.message);
  }
});

router.get("/history", authMiddleware, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const db = getDb();
    const col = db.collection("notifications_history");
    const totalSnap = await col.count().get();
    const total = totalSnap.data().count;
    const snap = await col.orderBy("sentAt", "desc").limit(limit).offset((page - 1) * limit).get();
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return ok(res, { items, page, limit, total, totalPages: Math.ceil(total / limit) }, "");
  } catch (e) {
    console.error("History load failed:", e.message);
    return fail(res, 500, "Failed to load history: " + friendlyFirestoreError(e));
  }
});

router.get("/stats", authMiddleware, async (req, res) => {
  try {
    const db = getDb();
    const [t, n] = await Promise.all([
      db.collection("tokens").count().get(),
      db.collection("notifications_history").count().get(),
    ]);
    return ok(res, { devices: t.data().count, notifications: n.data().count }, "");
  } catch (e) {
    console.error("Stats load failed:", e.message);
    return fail(res, 500, "Failed to load stats: " + friendlyFirestoreError(e));
  }
});

module.exports = router;
