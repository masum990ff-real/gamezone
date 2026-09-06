const express = require("express");
const { getDb, friendlyFirestoreError } = require("../config/firebase");
const { ok, fail, authMiddleware } = require("../middleware/auth");

const router = express.Router();
const DOC = "app";

router.get("/", async (req, res) => {
  try {
    const db = getDb();
    const snap = await db.collection("settings").doc(DOC).get();
    const supportUrl = snap.exists ? (snap.data().supportUrl || "") : "";
    return ok(res, { supportUrl }, "");
  } catch (e) {
    console.error("Settings load failed:", e.message);
    return fail(res, 500, "Failed to load settings: " + friendlyFirestoreError(e));
  }
});

router.put("/", authMiddleware, async (req, res) => {
  try {
    const { supportUrl } = req.body || {};
    if (supportUrl && !/^https:\/\/.+/i.test(supportUrl)) {
      return fail(res, 400, "Support link must start with https://");
    }
    const db = getDb();
    await db.collection("settings").doc(DOC).set({
      supportUrl: supportUrl || "",
      updatedAt: new Date().toISOString(),
      updatedBy: req.admin.email,
    }, { merge: true });
    return ok(res, { supportUrl: supportUrl || "" }, "Settings saved");
  } catch (e) {
    console.error("Settings save failed:", e.message);
    return fail(res, 500, "Failed to save settings: " + friendlyFirestoreError(e));
  }
});

module.exports = router;
