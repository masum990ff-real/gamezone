const jwt = require("jsonwebtoken");

function ok(res, data, message) {
  return res.json({ success: true, data: data || {}, message: message || "" });
}

function fail(res, status, message) {
  return res.status(status).json({ success: false, data: {}, message });
}

function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return fail(res, 401, "Unauthorized");
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.admin = payload;
    next();
  } catch (e) {
    return fail(res, 401, "Invalid or expired token");
  }
}

async function firebaseAuthMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return fail(res, 401, "Login required");
    const { getApp } = require("../config/firebase");
    const decoded = await getApp().auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (e) {
    console.error("ID token verify failed:", e.message);
    return fail(res, 401, "Invalid login session");
  }
}

module.exports = { ok, fail, authMiddleware, firebaseAuthMiddleware };
