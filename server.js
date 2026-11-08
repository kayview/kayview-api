const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');
const app = express();
app.use(cors());
app.use(express.json());
let db = null;
try {
  const keyJson = process.env.FIREBASE_KEY;
  if (keyJson) {
    const cred = JSON.parse(keyJson);
    admin.initializeApp({ credential: admin.credential.cert(cred) });
    db = admin.firestore();
    console.log("FIRESTORE CONNECTED");
  }
} catch(e){ console.log("Firestore error", e); }
app.get("/", (req,res)=> res.json({status:"Kayview API LIVE", firestore: !!db }));
app.get("/health", async (req,res)=>{
  let keysCount = 0;
  if(db){ const s = await db.collection("prime_keys").get(); keysCount = s.size; }
  res.json({ status:"ok", uptime: process.uptime(), prime_keys: keysCount });
});
function makeKey(){
  const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let a="", b="";
  for(let i=0;i<4;i++){ a+=c[Math.floor(Math.random()*c.length)]; b+=c[Math.floor(Math.random()*c.length)]; }
  return `PHE-${a}-${b}`;
}
app.post("/prime/keys/generate", async (req,res)=>{
  if(!db) return res.status(500).json({error:"No DB"});
  const { username, email, duration_days, bot_name } = req.body;
  const code = makeKey();
  const days = Number(duration_days) || 30;
  const expires = new Date(Date.now() + days*24*60*60*1000).toISOString();
  const data = { code, username: username||"", email: email||"", bot_name: bot_name||"", duration_days: days, status:"UNUSED", created: new Date().toISOString(), expires };
  const doc = await db.collection("prime_keys").add(data);
  res.json({ success:true, id: doc.id, ...data });
});
app.get("/prime/keys", async (req,res)=>{
  if(!db) return res.json([]);
  const snap = await db.collection("prime_keys").get();
  res.json(snap.docs.map(d=>({id:d.id, ...d.data()})));
});
app.get("/keys/validate", async (req,res)=>{
  const key = (req.query.key || "").trim().toUpperCase();
  if(!key) return res.json({ valid:false, error:"No key" });
  if(!db) return res.json({ valid:false, error:"No DB" });
  const snap = await db.collection("prime_keys").where("code","==",key).get();
  if(snap.empty) return res.json({ valid:false, error:"Key not found" });
  const doc = snap.docs[0];
  const data = doc.data();
  if(data.status === "INACTIVE") return res.json({ valid:false, error:"Key deactivated" });
  if(new Date(data.expires) < new Date()) return res.json({ valid:false, error:"Key expired" });
  if(data.status === "UNUSED"){ await doc.ref.update({ status:"ACTIVE", activated: new Date().toISOString() }); }
  res.json({ valid:true, bot: data.bot_name||"SlowMo Bizz", expires: data.expires, email: data.email });
});
app.post("/prime/keys/toggle", async (req,res)=>{
  const { id, status } = req.body;
  await db.collection("prime_keys").doc(id).update({ status });
  res.json({ success:true, status });
});
app.delete("/prime/keys/:id", async (req,res)=>{
  await db.collection("prime_keys").doc(req.params.id).delete();
  res.json({ success:true });
});
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', ()=> console.log(`Live on ${PORT}`));
