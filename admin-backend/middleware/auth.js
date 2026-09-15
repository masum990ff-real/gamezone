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
function requirePermission(perm) {
  return (req, res, next) => {
    const email = String((req.admin && req.admin.email) || "").toLowerCase();
    const adminEmail = String(process.env.ADMIN_EMAIL || "").toLowerCase();
    if (email && adminEmail && email === adminEmail) return next();
    if (req.admin && req.admin.role === "main") return next();
    if (!req.admin || !req.admin.permissions) return fail(res, 403, "Forbidden: missing permission " + perm);
    const perms = Array.isArray(req.admin.permissions) ? req.admin.permissions : [];
    if (perms.includes(perm) || perms.includes("*") || perms.includes("all")) return next();
    return fail(res, 403, "Forbidden: missing permission " + perm);
  };
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

module.exports = { ok, fail, authMiddleware, firebaseAuthMiddleware, requirePermission };
