const admin = require("firebase-admin");
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

function getDb() {
  if (db) return db;
  admin.initializeApp({
    credential: admin.credential.cert(loadServiceAccount()),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
  db = admin.firestore();
  return db;
}

function getMessaging() {
  getDb();
  return admin.messaging();
}

module.exports = { admin, getDb, getMessaging };
