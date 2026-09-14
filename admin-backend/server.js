require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { fail } = require("./middleware/auth");

const app = express();
app.set("trust proxy", 1);
const PORT = process.env.PORT || 3000;

const origins = (process.env.CORS_ORIGINS || "http://localhost:3000").split(",");
app.use(cors({ origin: origins }));
app.use(express.json({ limit: "100kb" }));

// Security headers for backend + same-origin admin panel (no extra dep).
// HTTPS-only is enforced by Render (HSTS); local http://10.0.2.2 stays usable.
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if ((req.headers["x-forwarded-proto"] || req.protocol) === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  res.setHeader("Content-Security-Policy",
    "default-src 'self'; style-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; " +
    "script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com; img-src 'self' data: https:; connect-src 'self'");
  next();
});

// Audit trail: who did what, when (admin writes only, no secrets logged).
app.use("/api", (req, res, next) => {
  if (["POST", "PUT", "DELETE"].includes(req.method)) {
    const who = (req.headers.authorization || "").slice(0, 24) + "...";
    console.error("[audit] " + req.method + " " + req.path + " auth=" + who);
  }
  next();
});

app.use("/api/auth", require("./routes/auth"));
app.use("/api", require("./routes/tokens"));
app.use("/api/notifications", require("./routes/notifications"));
app.use("/api/users", require("./routes/users"));
app.use("/api/settings", require("./routes/settings"));
app.use("/api/payment-config", require("./routes/payment-config"));
app.use("/api/payments", require("./routes/payments"));
app.use("/api/deposits", require("./routes/deposits"));
app.use("/api/categories", require("./routes/categories"));
app.use("/api/matches", require("./routes/matches"));
app.use("/api/withdrawals", require("./routes/withdrawals"));
app.use("/api/leaderboard", require("./routes/leaderboard"));

app.get("/api/health", async (req, res) => {
  try {
    const { getDb, friendlyFirestoreError } = require("./config/firebase");
    const db = getDb();
    const snap = await db.collection("tokens").count().get();
    res.json({ success: true, data: { server: "ok", firestore: "ok", tokens: snap.data().count }, message: "" });
  } catch (e) {
    const { friendlyFirestoreError } = require("./config/firebase");
    console.error("Health check failed:", e.message);
    res.status(500).json({ success: false, data: { server: "ok", firestore: "error" }, message: friendlyFirestoreError(e) });
  }
});

app.use(express.static(path.join(__dirname, "../admin-frontend")));

app.use((err, req, res, next) => fail(res, 500, "Internal server error"));

app.listen(PORT, () => {
  console.log("GameZone backend v1.6.0 starting on :" + PORT);
});