const express = require("express");
const { getRtdb } = require("../config/firebase");
const { ok, fail, authMiddleware } = require("../middleware/auth");

const router = express.Router();

function readSettings(rtdb) {
  return rtdb.ref("settings/app").get().then((snap) => {
    const v = snap.exists() ? snap.val() : {};
    const banners = Array.isArray(v.banners)
      ? v.banners.filter((b) => b && typeof b.img === "string" && /^https:\/\/.+/i.test(b.img)).slice(0, 5)
          .map((b) => ({ img: b.img, link: typeof b.link === "string" ? b.link : "" }))
      : [];
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
      banners: banners,
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
    const { supportUrl, announcement, rules, referCoins, downloadUrl, faq, about, privacy, terms, banners } = req.body || {};
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
    let cleanBanners = [];
    if (banners !== undefined) {
      if (!Array.isArray(banners)) return fail(res, 400, "Banners must be an array");
      if (banners.length > 5) return fail(res, 400, "Banners max 5");
      for (const b of banners) {
        const img = b && typeof b.img === "string" ? b.img.trim() : "";
        const link = b && typeof b.link === "string" ? b.link.trim() : "";
        if (!img) continue;
        if (!/^https:\/\/.+/i.test(img)) return fail(res, 400, "Banner image must start with https://");
        if (img.length > 500) return fail(res, 400, "Banner image max 500 chars");
        if (link && !/^https:\/\/.+/i.test(link)) return fail(res, 400, "Banner link must start with https://");
        if (link.length > 500) return fail(res, 400, "Banner link max 500 chars");
        cleanBanners.push({ img: img, link: link });
      }
    }
    for (const [key, max] of [["faq", 5000], ["about", 5000], ["privacy", 5000], ["terms", 5000]]) {
      if (req.body[key] && req.body[key].length > max) {
        return fail(res, 400, key + " max " + max + " chars");
      }
    }
    const rtdb = getRtdb();
    const update = {
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
    };
    if (banners !== undefined) update.banners = cleanBanners;
    await rtdb.ref("settings/app").update(update);
    const data = await readSettings(rtdb);
    return ok(res, data, "Settings saved");
  } catch (e) {
    console.error("Settings save failed:", e.message);
    return fail(res, 500, "Failed to save settings: " + (e.message || e));
  }
});

module.exports = router;
