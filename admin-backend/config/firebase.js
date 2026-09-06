
const admin = require("firebase-admin");
const { getFirestore } = require("firebase-admin/firestore");
const fs = require("fs");

let db = null;

function loadServiceAccount() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  }
  const keyPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "./serviceAccountKey.json";
  if (!fs.existsSync(keyPath)) {
    throw new Error("Service account key not found. Set FIREBASE_SERVICE_ACCOUNT_JSON env var or place key at " + keyPath);
  }
  return JSON.parse(fs.readFileSync(keyPath, "utf8"));
}

function getApp() {
  if (admin.apps.length) return admin.apps[0];
  return admin.initializeApp({
    credential: admin.credential.cert(loadServiceAccount()),
    projectId: process.env.FIREBASE_PROJECT_ID,
    databaseURL: process.env.FIREBASE_RTDB_URL || "https://gamezone-5-default-rtdb.firebaseio.com",
  });
}

function getDb() {
  if (db) return db;
  const databaseId = process.env.FIREBASE_DATABASE_ID || "(default)";
  db = getFirestore(getApp(), databaseId);
  return db;
}

function getRtdb() {
  getApp();
  return admin.database();
}

function getMessaging() {
  getDb();
  return admin.messaging();
}

function friendlyFirestoreError(e) {
  const raw = (e && e.message) || "Unknown error";
  if (/NOT_FOUND/i.test(raw)) {
    return "Firestore database not found — Console এর database dropdown এ DB-এর নাম (যেমন gamezone-5) দেখে Render এ FIREBASE_DATABASE_ID env এ সেই নাম বসাও। [" + raw + "]";
  }
  if (/PERMISSION_DENIED/i.test(raw)) {
    return "Firestore permission denied — service account key ভুল প্রজেক্টের হতে পারে, Render এর FIREBASE_SERVICE_ACCOUNT_JSON চেক করো। [" + raw + "]";
  }
  return raw;
}

module.exports = { admin, getApp, getDb, getRtdb, getMessaging, friendlyFirestoreError };
