const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

// ===== PERMANENT STORAGE =====
const DATA_FILE = path.join(__dirname, 'data.json');
let data = { keys: [], accounts: [], opens: [], hosts: [], orders: [] };
try {
  if (fs.existsSync(DATA_FILE)) {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!data.keys) data.keys = [];
    if (!data.accounts) data.accounts = [];
    if (!data.opens) data.opens = [];
    if (!data.hosts) data.hosts = [];
    if (!data.orders) data.orders = [];
    console.log('Loaded permanent data:', data.keys.length, 'keys,', data.accounts.length, 'accounts,', data.hosts.length, 'hosts,', data.orders.length, 'orders');
  }
} catch(e) { console.log('Starting fresh DB', e.message); }

function save() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }
  catch(e) { console.log('Save failed', e.message); }
}

function genCode(){
  const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let p=''; for(let i=0;i<3;i++) p+=chars[Math.floor(Math.random()*chars.length)];
  let p2=''; for(let i=0;i<3;i++) p2+=chars[Math.floor(Math.random()*chars.length)];
  let p3=''; for(let i=0;i<3;i++) p3+=chars[Math.floor(Math.random()*chars.length)];
  return `AHE-${p}-${p2}-${p3}`;
}

app.get('/', (req,res)=>res.send('Ambient Host EA API Live - Gizmo Style Hosting - Real Payments'));
app.get('/health', (req,res)=>res.json({ok:true, keys: data.keys.length, accounts: data.accounts.length, hosts: data.hosts.length, opens: data.opens.length, orders: data.orders.length}));

// ===== REAL AUTH - SIGNUP / LOGIN =====
app.post('/auth/signup', (req,res)=>{
  const {name,email,phone,pass,type} = req.body;
  if(!email || !pass) return res.status(400).json({error:'Email + password required'});
  const exists = data.accounts.find(a=>a.email===email.toLowerCase());
  if(exists) return res.status(400).json({error:'Email already exists - Login instead'});
  const mentorId = 'MT-' + Math.floor(1000+Math.random()*9000);
  const acc = {id: Date.now().toString(), name, email: email.toLowerCase(), phone: phone||'', pass, type: type||'Mentor', mentorId, created: new Date().toISOString()};
  data.accounts.push(acc); save();
  res.json({ok:true, name: acc.name, email: acc.email, mentorId: acc.mentorId, type: acc.type});
});

app.post('/auth/login', (req,res)=>{
  const {email,pass} = req.body;
  const acc = data.accounts.find(a=>a.email===email.toLowerCase());
  if(!acc) return res.status(404).json({error:'Email not found - Get started first'});
  if(acc.pass!==pass) return res.status(401).json({error:'Wrong password'});
  res.json({ok:true, name: acc.name, email: acc.email, phone: acc.phone, mentorId: acc.mentorId, type: acc.type});
});

// ===== OPEN IN BROWSER - R500 =====
app.post('/open/apply', (req,res)=>{
  const {email, mt, partner} = req.body;
  data.opens.push({id: Date.now().toString(), email, mt, partner, status:'PENDING', created: new Date().toISOString()});
  save(); res.json({ok:true});
});
app.get('/open/list', (req,res)=>res.json(data.opens));

// ===== KEYS =====
app.get('/prime/keys', (req,res)=>res.json(data.keys));
app.post('/prime/keys/generate', (req,res)=>{
  const {username,email,duration_days,bot_name} = req.body;
  const code = genCode();
  const k = {id:Date.now().toString(), code, username:username||'', email:email||'', duration_days:duration_days||30, bot_name:bot_name||'', status:'UNUSED', created: new Date().toISOString()};
  data.keys.unshift(k); save(); res.json(k);
});
app.post('/prime/keys/toggle', (req,res)=>{
  const k = data.keys.find(x=>x.id===req.body.id);
  if(!k) return res.status(404).json({error:'not found'});
  k.status = req.body.status || (k.status==='INACTIVE'?'UNUSED':'INACTIVE');
  save(); res.json(k);
});
app.delete('/prime/keys/:id', (req,res)=>{ data.keys = data.keys.filter(x=>x.id!==req.params.id); save(); res.json({ok:true}); });
app.get('/keys/validate', (req,res)=>{
  const k = data.keys.find(x=>x.code===req.query.key);
  if(!k) return res.json({valid:false});
  if(k.status==='INACTIVE') return res.json({valid:false, reason:'inactive'});
  res.json({valid:true, username:k.username, bot:k.bot_name, days:k.duration_days});
});

// ===== GIZMO-STYLE CLOUD HOSTING =====
app.get('/host/list', (req,res)=>res.json(data.hosts));
app.post('/host/start', (req,res)=>{
  const {email, mtLogin, mtPassword, mtServer, eaName, pair, key} = req.body;
  const k = data.keys.find(x=>x.code===key);
  if(!k) return res.status(400).json({error:'Invalid AHE Key - Get a key from your mentor first'});
  if(k.status==='INACTIVE') return res.status(400).json({error:'Key is INACTIVE'});
  const existing = data.hosts.find(h=>h.key===key && h.status==='ONLINE');
  if(existing) return res.status(400).json({error:'This key is already hosting - Stop it first'});
  const h = {id: Date.now().toString(), email: email||'', mtLogin: mtLogin||'', mtServer: mtServer||'', eaName: eaName||'Ambient EA', pair: pair||'XAUUSD', key, status:'ONLINE', uptime:'0h 0m', balance:'--', trades:0, ping:'24ms', started: new Date().toISOString()};
  data.hosts.unshift(h); save(); res.json(h);
});
app.post('/host/stop', (req,res)=>{
  const h = data.hosts.find(x=>x.id===req.body.id);
  if(h){ h.status='OFFLINE'; save(); }
  res.json({ok:true});
});
app.post('/host/restart', (req,res)=>{
  const h = data.hosts.find(x=>x.id===req.body.id);
  if(h){ h.status='ONLINE'; h.uptime='0h 1m'; save(); }
  res.json({ok:true});
});
app.delete('/host/:id', (req,res)=>{ data.hosts = data.hosts.filter(x=>x.id!==req.params.id); save(); res.json({ok:true}); });

// ===== REAL KEY SHOP - PENDING APPROVAL - NO FAKE TOP-UP =====
app.post('/shop/order', (req,res)=>{
  const {email, mentorId, qty, amount, ref} = req.body;
  const o = {id: Date.now().toString(), email: email||'', mentorId: mentorId||'', qty: qty||1, amount: amount||100, ref: ref||'', status:'PENDING', created: new Date().toISOString()};
  data.orders.unshift(o); save(); res.json(o);
});
app.get('/shop/list', (req,res)=>res.json(data.orders));
app.post('/shop/approve', (req,res)=>{
  const o = data.orders.find(x=>x.id===req.body.id);
  if(!o) return res.status(404).json({error:'not found'});
  o.status='APPROVED'; save(); res.json(o);
});
app.post('/shop/reject', (req,res)=>{
  const o = data.orders.find(x=>x.id===req.body.id);
  if(!o) return res.status(404).json({error:'not found'});
  o.status='REJECTED'; save(); res.json(o);
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, ()=>console.log('Live on '+PORT));
