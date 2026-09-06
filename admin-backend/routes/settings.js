const express = require("express");
const { getRtdb } = require("../config/firebase");
const { ok, fail, authMiddleware } = require("../middleware/auth");

const router = express.Router();

function readSettings(rtdb) {
  return rtdb.ref("settings/app").get().then((snap) => {
    const v = snap.exists() ? snap.val() : {};
    return {
      supportUrl: v.supportUrl || "",
      announcement: v.announcement || "",
      rules: v.rules || "",
    };
  });
}

router.get("/", async (req, res) => {
  try {
    const data = await readSettings(getRtdb());
    return ok(res, data, "");
  } catch (e) {
    console.error("Settings load failed:", e.message);
    return fail(res, 500, "Failed to load settings: " + (e.message || e));
  }
});

router.put("/", authMiddleware, async (req, res) => {
  try {
    const { supportUrl, announcement, rules } = req.body || {};
    if (supportUrl && !/^https:\/\/.+/i.test(supportUrl)) {
      return fail(res, 400, "Support link must start with https://");
    }
    if (announcement && announcement.length > 200) {
      return fail(res, 400, "Announcement max 200 chars");
    }
    if (rules && rules.length > 5000) {
      return fail(res, 400, "Rules max 5000 chars");
    }
    const rtdb = getRtdb();
    await rtdb.ref("settings/app").update({
      supportUrl: supportUrl || "",
      announcement: announcement || "",
      rules: rules || "",
      updatedAt: new Date().toISOString(),
      updatedBy: req.admin.email,
    });
    const data = await readSettings(rtdb);
    return ok(res, data, "Settings saved");
  } catch (e) {
    console.error("Settings save failed:", e.message);
    return fail(res, 500, "Failed to save settings: " + (e.message || e));
  }
});

module.exports = router;
