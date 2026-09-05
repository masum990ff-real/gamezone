require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const { fail } = require("./middleware/auth");

const app = express();
const PORT = process.env.PORT || 3000;

const origins = (process.env.CORS_ORIGINS || "http://localhost:3000").split(",");
app.use(cors({ origin: origins }));
app.use(express.json());

app.use("/api/auth", require("./routes/auth"));
app.use("/api", require("./routes/tokens"));
app.use("/api/notifications", require("./routes/notifications"));

app.get("/api/health", (req, res) => res.json({ success: true, data: {}, message: "ok" }));

app.use(express.static(path.join(__dirname, "../admin-frontend")));

app.use((err, req, res, next) => fail(res, 500, "Internal server error"));

app.listen(PORT, () => console.log("GameZone backend on :" + PORT));
