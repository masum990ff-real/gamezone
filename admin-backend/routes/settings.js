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
      referCoins: v.referCoins !== undefined ? v.referCoins : 5,
      downloadUrl: v.downloadUrl || "",
      faq: v.faq || "",
      about: v.about || "",
      privacy: v.privacy || "",
      terms: v.terms || "",
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
    const { supportUrl, announcement, rules, referCoins, downloadUrl, faq, about, privacy, terms } = req.body || {};
    if (supportUrl && !/^https:\/\/.+/i.test(supportUrl)) {
      return fail(res, 400, "Support link must start with https://");
    }
    if (announcement && announcement.length > 200) {
      return fail(res, 400, "Announcement max 200 chars");
    }
    if (rules && rules.length > 5000) {
      return fail(res, 400, "Rules max 5000 chars");
    }
    const coins = Math.max(0, Math.min(10000, parseInt(referCoins) || 0));
    for (const [key, max] of [["faq", 5000], ["about", 5000], ["privacy", 5000], ["terms", 5000]]) {
      if (req.body[key] && req.body[key].length > max) {
        return fail(res, 400, key + " max " + max + " chars");
      }
    }
    const rtdb = getRtdb();
    await rtdb.ref("settings/app").update({
      supportUrl: supportUrl || "",
      announcement: announcement || "",
      rules: rules || "",
      referCoins: coins,
      downloadUrl: downloadUrl || "",
      faq: faq || "",
      about: about || "",
      privacy: privacy || "",
      terms: terms || "",
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
