const express = require("express");
const { getRtdb } = require("../config/firebase");
const { ok, fail, authMiddleware } = require("../middleware/auth");
const { catLimiter } = require("../middleware/rateLimit");

const router = express.Router();

function validateBannerUrl(v) {
  const t = String(v || "").trim();
  if (!/^https:\/\/.+/i.test(t)) return null;
  if (t.length > 500) return null;
  return t;
}
function validateTitle(v) {
  const t = String(v || "").trim();
  if (t.length < 2 || t.length > 80) return null;
  return t;
}
function validateMatchNumber(v) {
  const t = String(v || "").trim();
  if (t.length < 1 || t.length > 20) return null;
  if (!/^[a-zA-Z0-9]+$/.test(t)) return null;
  return t;
}
function validateTimeDate(v) {
  const t = String(v || "").trim();
  if (!t) return null;
  const d = new Date(t);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}
function validateInt(v, min, max) {
  const n = Number(v);
  if (!Number.isInteger(n)) return null;
  if (n < min || n > max) return null;
  return n;
}
function validateMap(v) {
  const t = String(v || "").trim();
  if (t.length < 2 || t.length > 30) return null;
  return t;
}

function validatePayload(body, isUpdate) {
  const e = [];
  const out = {};
  if (!isUpdate || body.bannerUrl !== undefined) {
    const v = validateBannerUrl(body.bannerUrl);
    if (v === null) e.push("Banner URL must start with https:// and max 500 chars");
    else out.bannerUrl = v;
  }
  if (!isUpdate || body.title !== undefined) {
    const v = validateTitle(body.title);
    if (v === null) e.push("Title must be 2-80 characters");
    else out.title = v;
  }
  if (!isUpdate || body.matchNumber !== undefined) {
    const v = validateMatchNumber(body.matchNumber);
    if (v === null) e.push("Match number must be alphanumeric 1-20 chars");
    else out.matchNumber = v;
  }
  if (!isUpdate || body.timeDate !== undefined) {
    const v = validateTimeDate(body.timeDate);
    if (v === null) e.push("Time & Date must be valid ISO datetime");
    else out.timeDate = v;
  }
  let prizeType = null;
  if (body.prizeType !== undefined) {
    const t = String(body.prizeType || "").trim().toLowerCase();
    if (t !== "all" && t !== "survival") e.push("prizeType must be all or survival");
    else { out.prizeType = t; prizeType = t; }
  } else if (!isUpdate) {
    prizeType = "all";
    out.prizeType = "all";
  } else {
    prizeType = null;
  }
  if (body.prizeSurvival !== undefined) {
    const ps = body.prizeSurvival;
    if (typeof ps !== "object" || ps === null) e.push("prizeSurvival must be object");
    else {
      const surv = {};
      for (let i = 1; i <= 10; i++) {
        const k = "r" + i;
        const v = validateInt(ps[k], 0, 100000);
        if (v === null) e.push("prizeSurvival." + k + " must be int 0-100000");
        else surv[k] = v;
      }
      const tot = validateInt(ps.total, 0, 100000);
      if (tot === null) e.push("prizeSurvival.total must be int 0-100000");
      else surv.total = tot;
      if (e.length === 0) out.prizeSurvival = surv;
    }
  }
  const effectiveType = prizeType || (body.prizeSurvival !== undefined ? "survival" : null);
  if (!isUpdate) {
    if (effectiveType === "survival") {
      if (body.prizeSurvival === undefined) e.push("prizeSurvival required for survival");
      if (body.prizePool !== undefined) {
        const v = validateInt(body.prizePool, 0, 100000);
        if (v === null) e.push("PrizePool must be int 0-100000");
        else out.prizePool = v;
      } else if (out.prizeSurvival) out.prizePool = out.prizeSurvival.total;
    } else {
      if (!isUpdate || body.prizePool !== undefined) {
        const v = validateInt(body.prizePool, 0, 100000);
        if (v === null) e.push("PrizePool must be int 0-100000");
        else out.prizePool = v;
      }
    }
  } else {
    if (body.prizePool !== undefined) {
      const v = validateInt(body.prizePool, 0, 100000);
      if (v === null) e.push("PrizePool must be int 0-100000");
      else out.prizePool = v;
    }
  }
  if (!isUpdate || body.perKill !== undefined) {
    const v = validateInt(body.perKill, 0, 10000);
    if (v === null) e.push("PerKill must be int 0-10000");
    else out.perKill = v;
  }
  if (!isUpdate || body.entryFeeType !== undefined) {
    const t = String(body.entryFeeType || "").trim().toLowerCase();
    if (t !== "paid" && t !== "free") e.push("EntryFeeType must be paid or free");
    else out.entryFeeType = t;
  }
  if (!isUpdate || body.entryFee !== undefined) {
    const type = out.entryFeeType !== undefined ? out.entryFeeType : String(body.entryFeeType || "").trim().toLowerCase();
    const v = validateInt(body.entryFee, 0, 10000);
    if (v === null) e.push("EntryFee must be int 0-10000");
    else {
      if (type === "free" && v !== 0) e.push("EntryFee must be 0 when type is free");
      else if (type === "paid" && (v < 1 || v > 10000)) e.push("EntryFee must be 1-10000 when paid");
      else out.entryFee = v;
    }
  }
  if (!isUpdate || body.teamType !== undefined) {
    const t = String(body.teamType || "").trim();
    if (!["Solo", "Duo", "Squad"].includes(t)) e.push("TeamType must be Solo/Duo/Squad");
    else out.teamType = t;
  }
  if (!isUpdate || body.version !== undefined) {
    const t = String(body.version || "").trim().toUpperCase();
    if (!["TPP", "FPP"].includes(t)) e.push("Version must be TPP or FPP");
    else out.version = t;
  }
  if (!isUpdate || body.map !== undefined) {
    const v = validateMap(body.map);
    if (v === null) e.push("Map must be 2-30 characters");
    else out.map = v;
  }
  if (!isUpdate || body.slots !== undefined) {
    const v = validateInt(body.slots, 2, 100);
    if (v === null) e.push("Slots must be int 2-100");
    else out.slots = v;
  }
  if (body.status !== undefined) {
    const t = String(body.status || "").trim().toLowerCase();
    if (!["upcoming", "ongoing", "result"].includes(t)) e.push("Status must be upcoming/ongoing/result");
    else out.status = t;
  }
  if (body.categoryId !== undefined) {
    const t = String(body.categoryId || "").trim();
    if (!t) e.push("categoryId required");
    else out.categoryId = t;
  }
  const aboutRaw = body.about !== undefined ? body.about : body.rules;
  if (aboutRaw !== undefined) {
    const t = String(aboutRaw || "");
    if (t.length > 5000) e.push("About max 5000 chars");
    else out.about = t;
  }
  if (body.filledSlots !== undefined) {
    const v = validateInt(body.filledSlots, 0, 100);
    if (v === null) e.push("filledSlots must be int 0-100");
    else out.filledSlots = v;
  }
  return { errors: e, out };
}

router.get("/", catLimiter, async (req, res) => {
  try {
    const categoryId = req.query.categoryId ? String(req.query.categoryId).trim() : "";
    const status = req.query.status ? String(req.query.status).trim().toLowerCase() : "";
    const snap = await getRtdb().ref("matches").get();
    const val = snap.exists() ? snap.val() : {};
    let list = [];
    for (const [id, v] of Object.entries(val)) {
      if (!v || typeof v.title !== "string") continue;
      if (categoryId && v.categoryId !== categoryId) continue;
      if (status && String(v.status || "").toLowerCase() !== status) continue;
      list.push({ id, ...v, id });
    }
    list.sort((a, b) => String(a.timeDate || "").localeCompare(String(b.timeDate || "")));
    list = list.slice(0, 50);
    return ok(res, { matches: list }, "");
  } catch (e) {
    console.error("Matches load failed:", e.message);
    return fail(res, 500, "Failed to load matches");
  }
});

router.get("/:id", catLimiter, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return fail(res, 400, "Missing id");
    const snap = await getRtdb().ref("matches/" + id).get();
    if (!snap.exists()) return fail(res, 404, "Match not found");
    const v = snap.val();
    return ok(res, { match: { id, ...v } }, "");
  } catch (e) {
    console.error("Match get failed:", e.message);
    return fail(res, 500, "Failed to load match");
  }
});

router.post("/", authMiddleware, catLimiter, async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.categoryId) return fail(res, 400, "categoryId required");
    const catSnap = await getRtdb().ref("categories/" + String(body.categoryId).trim()).get();
    if (!catSnap.exists()) return fail(res, 400, "Category not found");
    const catName = catSnap.val().name || "";
    const { errors, out } = validatePayload(body, false);
    if (errors.length) return fail(res, 400, errors[0]);
    if (out.entryFeeType === "free") out.entryFee = 0;
    const ref = getRtdb().ref("matches").push();
    const id = ref.key;
    const now = new Date().toISOString();
    const doc = {
      id,
      categoryId: out.categoryId,
      categoryName: catName,
      bannerUrl: out.bannerUrl,
      title: out.title,
      matchNumber: out.matchNumber,
      timeDate: out.timeDate,
      prizeType: out.prizeType || "all",
      prizePool: out.prizePool,
      prizeSurvival: out.prizeSurvival || null,
      perKill: out.perKill,
      entryFeeType: out.entryFeeType,
      entryFee: out.entryFee,
      teamType: out.teamType,
      version: out.version,
      map: out.map,
      slots: out.slots,
      about: out.about || "",
      status: out.status || "upcoming",
      createdAt: now,
      filledSlots: 0,
    };
    if (doc.prizeType !== "survival") doc.prizeSurvival = null;
    await ref.set(doc);
    return ok(res, doc, "Match created");
  } catch (e) {
    console.error("Match create failed:", e.message);
    return fail(res, 500, "Failed to create match");
  }
});

router.put("/:id", authMiddleware, catLimiter, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return fail(res, 400, "Missing id");
    const snap = await getRtdb().ref("matches/" + id).get();
    if (!snap.exists()) return fail(res, 404, "Match not found");
    const prev = snap.val();
    const body = req.body || {};
    if (body.categoryId !== undefined) {
      const cs = await getRtdb().ref("categories/" + String(body.categoryId).trim()).get();
      if (!cs.exists()) return fail(res, 400, "Category not found");
      body._categoryName = cs.val().name || "";
    }
    const { errors, out } = validatePayload(body, true);
    if (errors.length) return fail(res, 400, errors[0]);
    const update = {};
    if (out.bannerUrl !== undefined) update.bannerUrl = out.bannerUrl;
    if (out.title !== undefined) update.title = out.title;
    if (out.matchNumber !== undefined) update.matchNumber = out.matchNumber;
    if (out.timeDate !== undefined) update.timeDate = out.timeDate;
    if (out.prizeType !== undefined) update.prizeType = out.prizeType;
    if (out.prizePool !== undefined) update.prizePool = out.prizePool;
    if (out.prizeSurvival !== undefined) update.prizeSurvival = out.prizeSurvival;
    if (out.prizeType === "all") update.prizeSurvival = null;
    if (out.perKill !== undefined) update.perKill = out.perKill;
    if (out.entryFeeType !== undefined) update.entryFeeType = out.entryFeeType;
    if (out.entryFee !== undefined) update.entryFee = out.entryFee;
    if (out.teamType !== undefined) update.teamType = out.teamType;
    if (out.version !== undefined) update.version = out.version;
    if (out.map !== undefined) update.map = out.map;
    if (out.slots !== undefined) update.slots = out.slots;
    if (out.status !== undefined) update.status = out.status;
    if (out.categoryId !== undefined) {
      update.categoryId = out.categoryId;
      update.categoryName = body._categoryName;
    }
    if (out.filledSlots !== undefined) update.filledSlots = out.filledSlots;
    if (out.about !== undefined) update.about = out.about;
    if (update.entryFeeType === "free") update.entryFee = 0;
    if (prev.entryFeeType === "free" && update.entryFeeType === undefined && update.entryFee !== undefined && update.entryFee !== 0) {
      // allow
    }
    if (Object.keys(update).length === 0) return fail(res, 400, "No fields to update");
    await getRtdb().ref("matches/" + id).update(update);
    const fresh = await getRtdb().ref("matches/" + id).get();
    return ok(res, { id, ...fresh.val() }, "Match updated");
  } catch (e) {
    console.error("Match update failed:", e.message);
    return fail(res, 500, "Failed to update match");
  }
});

router.delete("/:id", authMiddleware, catLimiter, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return fail(res, 400, "Missing id");
    const snap = await getRtdb().ref("matches/" + id).get();
    if (!snap.exists()) return fail(res, 404, "Match not found");
    await getRtdb().ref("matches/" + id).remove();
    return ok(res, {}, "Match deleted");
  } catch (e) {
    console.error("Match delete failed:", e.message);
    return fail(res, 500, "Failed to delete match");
  }
});

module.exports = router;
