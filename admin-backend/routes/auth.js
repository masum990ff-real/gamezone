const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { ok, fail } = require("../middleware/auth");
const { loginLimiter } = require("../middleware/rateLimit");

const router = express.Router();

router.post("/login", loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return fail(res, 400, "Email and password required");
    const cleanEmail = String(email).trim().toLowerCase();
    try {
      const { getDb } = require("../config/firebase");
      const db = getDb();
      const snap = await db.collection("staffs").where("email", "==", cleanEmail).limit(1).get();
      if (!snap.empty) {
        const doc = snap.docs[0];
        const data = doc.data() || {};
        const hash = data.passwordHash || "";
        const validStaff = hash ? await bcrypt.compare(password, hash) : false;
        if (!validStaff) return fail(res, 401, "Invalid credentials");
        const token = jwt.sign({ email: cleanEmail, role: "staff", permissions: data.permissions || [] }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || "12h" });
        return ok(res, { token, role: "staff", permissions: data.permissions || [] }, "Login successful");
      }
    } catch (e) { console.error("Staff login check failed", e.message); }
    if (cleanEmail !== String(process.env.ADMIN_EMAIL || "").trim().toLowerCase()) return fail(res, 401, "Invalid credentials");
    let valid = false;
    if (process.env.ADMIN_PASSWORD_HASH) valid = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
    else if (process.env.ADMIN_PASSWORD) valid = password === process.env.ADMIN_PASSWORD;
    if (!valid) return fail(res, 401, "Invalid credentials");
    const token = jwt.sign({ email: cleanEmail, role: "main", permissions: ["*"] }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || "12h" });
    return ok(res, { token, role: "main" }, "Login successful");
  } catch (e) {
    console.error("Login failed:", e.message);
    return fail(res, 500, "Login failed: " + (e.message || e));
  }
});

module.exports = router;
