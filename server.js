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

// Helper: REAL status = did MT5 EA sync in last 35 seconds?
function realStatus(h){
  if(!h.lastSync) return 'WAITING_FOR_MT5';
  let sec = (Date.now() - new Date(h.lastSync).getTime())/1000;
  if(sec > 35) return 'OFFLINE';
  return 'ONLINE';
}

app.get('/', (req,res)=>res.send('Ambient Host EA API Live - REAL MT5 Sync Only'));
app.get('/health', (req,res)=>{
  let online = data.hosts.filter(h=>realStatus(h)==='ONLINE').length;
  res.json({ok:true, keys: data.keys.length, accounts: data.accounts.length, hosts: data.hosts.length, hostsOnlineReal: online, opens: data.opens.length, orders: data.orders.length});
});

// ===== REAL AUTH =====
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

// ===== REAL HOSTING - NO FAKE ONLINE =====
app.get('/host/list', (req,res)=>{
  // Return REAL status every time - recalculated from lastSync
  let out = data.hosts.map(h=>({...h, status: realStatus(h)}));
  res.json(out);
});

app.post('/host/start', (req,res)=>{
  const {email, mtLogin, mtServer, eaName, pair, key} = req.body;
  const k = data.keys.find(x=>x.code===key);
  if(!k) return res.status(400).json({error:'Invalid AHE Key - Get a key from your mentor first'});
  if(k.status==='INACTIVE') return res.status(400).json({error:'Key is INACTIVE'});
  // Don't create duplicate session for same key
  const existing = data.hosts.find(h=>h.key===key);
  if(existing){
    existing.mtLogin = mtLogin||existing.mtLogin;
    existing.mtServer = mtServer||existing.mtServer;
    existing.eaName = eaName||existing.eaName;
    existing.pair = pair||existing.pair;
    existing.lastSync = null; // reset - waiting for EA to prove it's online
    existing.balance = null; existing.equity = null; existing.profit = null; existing.positions = [];
    save(); return res.json({...existing, status: realStatus(existing), message:'Session ready. Now attach Ambient EA in MT5 with this key to go ONLINE for real.'});
  }
  const h = {
    id: Date.now().toString(),
    email: email||'', mtLogin: mtLogin||'', mtServer: mtServer||'',
    eaName: eaName||'Ambient EA', pair: pair||'XAUUSD', key,
    balance: null, equity: null, margin: null, freeMargin: null, profit: null,
    positions: [], trades: 0,
    lastSync: null, started: new Date().toISOString()
  };
  data.hosts.unshift(h); save();
  res.json({...h, status:'WAITING_FOR_MT5', message:'Session created. Attach Ambient EA in MT5 with this key to go ONLINE for real.'});
});

// ===== THIS IS THE ONLY REAL ONLINE - Called by EA inside MT5 every 10s =====
app.post('/host/sync', (req,res)=>{
  const {key, mtLogin, balance, equity, margin, freeMargin, profit, positions} = req.body;
  if(!key) return res.status(400).json({error:'key required'});
  let h = data.hosts.find(x=>x.key===key);
  if(!h) return res.status(404).json({error:'No hosting session for this key - Create session in app first, then run EA'});
  h.balance = balance; h.equity = equity; h.margin = margin; h.freeMargin = freeMargin;
  h.profit = profit; h.positions = Array.isArray(positions) ? positions : [];
  h.trades = h.positions.length;
  if(mtLogin) h.mtLogin = mtLogin;
  h.lastSync = new Date().toISOString();
  save();
  res.json({ok:true, status:'ONLINE', trades: h.trades, balance: h.balance});
});

app.get('/host/live/:key', (req,res)=>{
  const h = data.hosts.find(x=>x.key===req.params.key);
  if(!h) return res.json({online:false, reason:'no session'});
  res.json({...h, status: realStatus(h), online: realStatus(h)==='ONLINE'});
});

app.post('/host/stop', (req,res)=>{
  const h = data.hosts.find(x=>x.id===req.body.id);
  if(h){ h.lastSync = null; h.balance=null; h.positions=[]; h.trades=0; save(); }
  res.json({ok:true});
});
app.post('/host/restart', (req,res)=>{
  const h = data.hosts.find(x=>x.id===req.body.id);
  if(h){ h.lastSync = null; save(); }
  res.json({ok:true, message:'Restart means: restart EA in MT5. App cannot restart MT5 by itself.'});
});
app.delete('/host/:id', (req,res)=>{ data.hosts = data.hosts.filter(x=>x.id!==req.params.id); save(); res.json({ok:true}); });

// ===== REAL KEY SHOP - PENDING APPROVAL =====
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
app.listen(PORT, ()=>console.log('Live on '+PORT+' - REAL SYNC ONLY'));
