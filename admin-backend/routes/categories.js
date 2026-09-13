const express = require("express");
const { getRtdb } = require("../config/firebase");
const { ok, fail, authMiddleware } = require("../middleware/auth");
const { catLimiter } = require("../middleware/rateLimit");

const router = express.Router();

function validateName(name) {
  const t = String(name || "").trim();
  if (t.length < 2 || t.length > 30) return null;
  return t;
}

function validateImg(img) {
  const t = String(img || "").trim();
  if (!/^https:\/\/.+/i.test(t)) return null;
  if (t.length > 500) return null;
  return t;
}

router.get("/", catLimiter, async (req, res) => {
  try {
    const snap = await getRtdb().ref("categories").get();
    const val = snap.exists() ? snap.val() : {};
    const list = [];
    for (const [id, v] of Object.entries(val)) {
      if (!v || typeof v.name !== "string" || typeof v.img !== "string") continue;
      list.push({ id, name: v.name, img: v.img, createdAt: v.createdAt || "" });
    }
    list.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    return ok(res, { categories: list.slice(0, 15) }, "");
  } catch (e) {
    console.error("Categories load failed:", e.message);
    return fail(res, 500, "Failed to load categories");
  }
});

router.post("/", authMiddleware, catLimiter, async (req, res) => {
  try {
    const name = validateName(req.body && req.body.name);
    const img = validateImg(req.body && req.body.img);
    if (!name) return fail(res, 400, "Name must be 2-30 characters");
    if (!img) return fail(res, 400, "Image must start with https:// and max 500 chars");
    const rtdb = getRtdb();
    const snap = await rtdb.ref("categories").get();
    const count = snap.exists() ? Object.keys(snap.val()).length : 0;
    if (count >= 15) return fail(res, 400, "Max 15 categories reached — delete one before adding");
    const ref = rtdb.ref("categories").push();
    const id = ref.key;
    const now = new Date().toISOString();
    await ref.set({ name, img, createdAt: now });
    return ok(res, { id, name, img, createdAt: now }, "Category added");
  } catch (e) {
    console.error("Category add failed:", e.message);
    return fail(res, 500, "Failed to add category");
  }
});

router.put("/:id", authMiddleware, catLimiter, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return fail(res, 400, "Missing id");
    const name = validateName(req.body && req.body.name);
    const img = validateImg(req.body && req.body.img);
    if (!name) return fail(res, 400, "Name must be 2-30 characters");
    if (!img) return fail(res, 400, "Image must start with https:// and max 500 chars");
    const rtdb = getRtdb();
    const snap = await rtdb.ref("categories/" + id).get();
    if (!snap.exists()) return fail(res, 404, "Category not found");
    const prev = snap.val();
    await rtdb.ref("categories/" + id).update({ name, img, createdAt: prev.createdAt || new Date().toISOString() });
    return ok(res, { id, name, img, createdAt: prev.createdAt }, "Category updated");
  } catch (e) {
    console.error("Category update failed:", e.message);
    return fail(res, 500, "Failed to update category");
  }
});

router.delete("/:id", authMiddleware, catLimiter, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return fail(res, 400, "Missing id");
    const rtdb = getRtdb();
    const snap = await rtdb.ref("categories/" + id).get();
    if (!snap.exists()) return fail(res, 404, "Category not found");
    await rtdb.ref("categories/" + id).remove();
    return ok(res, {}, "Category deleted");
  } catch (e) {
    console.error("Category delete failed:", e.message);
    return fail(res, 500, "Failed to delete category");
  }
});

module.exports = router;
