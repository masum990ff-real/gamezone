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
    if (email !== process.env.ADMIN_EMAIL) return fail(res, 401, "Invalid credentials");
    let valid = false;
    if (process.env.ADMIN_PASSWORD_HASH) {
      valid = await bcrypt.compare(password, process.env.ADMIN_PASSWORD_HASH);
    } else if (process.env.ADMIN_PASSWORD) {
      valid = password === process.env.ADMIN_PASSWORD;
    }
    if (!valid) return fail(res, 401, "Invalid credentials");
    const token = jwt.sign({ email }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || "12h",
    });
    return ok(res, { token }, "Login successful");
  } catch (e) {
    return fail(res, 500, "Login failed");
  }
});

module.exports = router;
