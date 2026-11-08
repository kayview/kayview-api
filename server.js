const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const path = require('path');

const app = express();

// --- Serve HTML files like prime-keys.html ---
app.use(express.static(__dirname));
app.use(cors());
app.use(express.json());

// --- Firebase ---
let db = null;
try {
  const keyJson = process.env.FIREBASE_KEY;
  if (keyJson) {
    const cred = JSON.parse(keyJson);
    admin.initializeApp({ credential: admin.credential.cert(cred) });
    db = admin.firestore();
    console.log("FIRESTORE CONNECTED");
  } else {
    console.log("NO FIREBASE_KEY - running without DB");
  }
} catch (e) {
  console.log("Firestore error", e.message);
}

// --- Helpers ---
function makeKey() {
  const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let a = "", b = "";
  for (let i = 0; i < 4; i++) {
    a += c[Math.floor(Math.random() * c.length)];
    b += c[Math.floor(Math.random() * c.length)];
  }
  return `PHE-${a}-${b}`;
}

// --- Root ---
app.get("/", (req, res) => {
  res.json({ status: "Kayview API LIVE", firestore: !!db, time: new Date().toISOString() });
});

// --- Health ---
app.get("/health", async (req, res) => {
  let keysCount = 0;
  if (db) {
    try {
      const s = await db.collection("prime_keys").get();
      keysCount = s.size;
    } catch (e) {}
  }
  res.json({ status: "ok", uptime: process.uptime(), prime_keys: keysCount, firestore: !!db });
});

// --- Generate Key ---
app.post("/prime/keys/generate", async (req, res) => {
  if (!db) return res.status(500).json({ error: "No DB" });
  try {
    const { username, email, duration_days, bot_name } = req.body;
    const code = makeKey();
    const days = Number(duration_days) || 30;
    const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
    const data = {
      code,
      username: username || "",
      email: email || "",
      bot_name: bot_name || "SlowMo Bizz",
      duration_days: days,
      status: "UNUSED",
      created: new Date().toISOString(),
      expires
    };
    const doc = await db.collection("prime_keys").add(data);
    res.json({ success: true, id: doc.id, ...data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- List All Keys ---
app.get("/prime/keys", async (req, res) => {
  if (!db) return res.json([]);
  try {
    const snap = await db.collection("prime_keys").orderBy("created", "desc").get();
    res.json(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  } catch (e) {
    res.json([]);
  }
});

// --- Validate Key (for EA / APK) ---
app.get("/keys/validate", async (req, res) => {
  const key = (req.query.key || "").trim().toUpperCase();
  if (!key) return res.json({ valid: false, error: "No key" });
  if (!db) return res.json({ valid: false, error: "No DB" });
  try {
    const snap = await db.collection("prime_keys").where("code", "==", key).get();
    if (snap.empty) return res.json({ valid: false, error: "Key not found" });
    const doc = snap.docs[0];
    const data = doc.data();
    if (data.status === "INACTIVE") return res.json({ valid: false, error: "Key deactivated" });
    if (new Date(data.expires) < new Date()) return res.json({ valid: false, error: "Key expired" });
    if (data.status === "UNUSED") {
      await doc.ref.update({ status: "ACTIVE", activated: new Date().toISOString() });
    }
    res.json({ valid: true, bot: data.bot_name || "SlowMo Bizz", expires: data.expires, email: data.email, username: data.username });
  } catch (e) {
    res.json({ valid: false, error: e.message });
  }
});

// --- Toggle ACTIVE / INACTIVE ---
app.post("/prime/keys/toggle", async (req, res) => {
  if (!db) return res.status(500).json({ error: "No DB" });
  try {
    const { id, status } = req.body;
    await db.collection("prime_keys").doc(id).update({ status });
    res.json({ success: true, status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Delete Key ---
app.delete("/prime/keys/:id", async (req, res) => {
  if (!db) return res.status(500).json({ error: "No DB" });
  try {
    await db.collection("prime_keys").doc(req.params.id).delete();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- Start ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => console.log(`Live on ${PORT}`));
