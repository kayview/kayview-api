require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { Server } = require('socket.io'); // YOUR socket.io, NOT ws
const axios = require('axios'); // YOUR axios - for PayFast verify

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST'] } });

// ===== FIREBASE - Optional, don't crash if no key =====
let admin = null;
try{
  if(process.env.FIREBASE_SERVICE_ACCOUNT){
    admin = require('firebase-admin');
    admin.initializeApp({ credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    console.log('Firebase connected');
  } else console.log('Firebase skipped - no FIREBASE_SERVICE_ACCOUNT env');
}catch(e){ console.log('Firebase skip:', e.message); }

// ===== PERMANENT STORAGE =====
const DATA_FILE = path.join(__dirname, 'data.json');
let data = { keys: [], accounts: [], opens: [], hosts: [], orders: [], signals: [], history: [], commands: [] };
try {
  if (fs.existsSync(DATA_FILE)) {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!data.keys) data.keys = [];
    if (!data.accounts) data.accounts = [];
    if (!data.opens) data.opens = [];
    if (!data.hosts) data.hosts = [];
    if (!data.orders) data.orders = [];
    if (!data.signals) data.signals = [];
    if (!data.history) data.history = [];
    if (!data.commands) data.commands = [];
    console.log('Loaded permanent data:', data.keys.length, 'keys,', data.accounts.length, 'accounts,', data.hosts.length, 'hosts,', data.orders.length, 'orders');
  }
} catch(e) { console.log('Starting fresh DB', e.message); }
function save() { try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); } catch(e) { console.log('Save failed', e.message); } }
function genCode(){
  const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let p=''; for(let i=0;i<3;i++) p+=chars[Math.floor(Math.random()*chars.length)];
  let p2=''; for(let i=0;i<3;i++) p2+=chars[Math.floor(Math.random()*chars.length)];
  let p3=''; for(let i=0;i<3;i++) p3+=chars[Math.floor(Math.random()*chars.length)];
  return `AHE-${p}-${p2}-${p3}`;
}
function realStatus(h){
  if(!h.lastSync) return 'WAITING_FOR_MT5';
  let sec = (Date.now() - new Date(h.lastSync).getTime())/1000;
  if(sec > 35) return 'OFFLINE';
  return 'ONLINE';
}
const API_TOKEN = process.env.KAYVIEW_TOKEN || 'KAYVIEW-TOKEN-123';
const BRIDGE_SECRET = process.env.BRIDGE_SECRET || 'KAYVIEW-BRIDGE-99';

app.get('/', (req,res)=>res.send('KAYVIEW CHARGER API Live - Web + APK + MT4/MT5 EA Bridge - REAL MT5 Sync Only + META API'));
app.get('/health', (req,res)=>{
  let online = data.hosts.filter(h=>realStatus(h)==='ONLINE').length;
  res.json({ok:true, api:'KAYVIEW META API v1', keys: data.keys.length, accounts: data.accounts.length, hosts: data.hosts.length, hostsOnlineReal: online, opens: data.opens.length, orders: data.orders.length, signals: data.signals.length, socketClients: io.engine.clientsCount});
});

// ===== AUTH =====
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

// ===== OPEN =====
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
app.get('/api/v1/keys/validate', (req,res)=>{
  const k = data.keys.find(x=>x.code===req.query.key);
  if(!k) return res.json({ok:false, valid:false, reason:'NOT_FOUND'});
  if(k.status==='INACTIVE') return res.json({ok:false, valid:false, reason:'DEACTIVATED'});
  res.json({ok:true, valid:true, code:k.code, bot:k.bot_name||'SKYNET AI PRO +', status:k.status});
});

// ===== HOSTING - REAL SYNC ONLY =====
app.get('/host/list', (req,res)=>res.json(data.hosts.map(h=>({...h, status: realStatus(h)}))));
app.post('/host/start', (req,res)=>{
  const {email, mtLogin, mtServer, eaName, pair, key} = req.body;
  const k = data.keys.find(x=>x.code===key);
  if(!k) return res.status(400).json({error:'Invalid AHE Key - Get a key from your mentor first'});
  if(k.status==='INACTIVE') return res.status(400).json({error:'Key is INACTIVE'});
  const existing = data.hosts.find(h=>h.key===key);
  if(existing){
    existing.mtLogin = mtLogin||existing.mtLogin; existing.mtServer = mtServer||existing.mtServer; existing.eaName = eaName||existing.eaName; existing.pair = pair||existing.pair;
    existing.lastSync = null; existing.balance = null; existing.equity = null; existing.profit = null; existing.positions = [];
    save(); return res.json({...existing, status: realStatus(existing), message:'Session ready. Now attach Ambient EA in MT5 with this key to go ONLINE for real.'});
  }
  const h = { id: Date.now().toString(), email: email||'', mtLogin: mtLogin||'', mtServer: mtServer||'', eaName: eaName||'Ambient EA', pair: pair||'XAUUSD', key, balance: null, equity: null, margin: null, freeMargin: null, profit: null, positions: [], trades: 0, lastSync: null, started: new Date().toISOString() };
  data.hosts.unshift(h); save();
  res.json({...h, status:'WAITING_FOR_MT5', message:'Session created. Attach Ambient EA in MT5 with this key to go ONLINE for real.'});
});
app.post('/host/sync', (req,res)=>{
  const {key, mtLogin, balance, equity, margin, freeMargin, profit, positions} = req.body;
  if(!key) return res.status(400).json({error:'key required'});
  let h = data.hosts.find(x=>x.key===key);
  if(!h) return res.status(404).json({error:'No hosting session for this key - Create session in app first, then run EA'});
  h.balance = balance; h.equity = equity; h.margin = margin; h.freeMargin = freeMargin; h.profit = profit; h.positions = Array.isArray(positions) ? positions : []; h.trades = h.positions.length;
  if(mtLogin) h.mtLogin = mtLogin;
  h.lastSync = new Date().toISOString(); save();
  // Socket.io live push to app - replaces ws
  io.emit('ACCOUNT_UPDATE', {key, balance, equity, margin, freeMargin, profit, positions:h.positions, lastSync:h.lastSync, status:'ONLINE'});
  res.json({ok:true, status:'ONLINE', trades: h.trades, balance: h.balance});
});
app.get('/host/live/:key', (req,res)=>{
  const h = data.hosts.find(x=>x.key===req.params.key);
  if(!h) return res.json({online:false, reason:'no session'});
  res.json({...h, status: realStatus(h), online: realStatus(h)==='ONLINE'});
});
app.post('/host/stop', (req,res)=>{ const h = data.hosts.find(x=>x.id===req.body.id); if(h){ h.lastSync = null; h.balance=null; h.positions=[]; h.trades=0; save(); } res.json({ok:true}); });
app.post('/host/restart', (req,res)=>{ const h = data.hosts.find(x=>x.id===req.body.id); if(h){ h.lastSync = null; save(); } res.json({ok:true, message:'Restart means: restart EA in MT5. App cannot restart MT5 by itself.'}); });
app.delete('/host/:id', (req,res)=>{ data.hosts = data.hosts.filter(x=>x.id!==req.params.id); save(); res.json({ok:true}); });

// ===== SHOP =====
app.post('/shop/order', (req,res)=>{
  const {email, mentorId, qty, amount, ref} = req.body;
  const o = {id: Date.now().toString(), email: email||'', mentorId: mentorId||'', qty: qty||1, amount: amount||100, ref: ref||'', status:'PENDING', created: new Date().toISOString()};
  data.orders.unshift(o); save(); res.json(o);
});
app.get('/shop/list', (req,res)=>res.json(data.orders));
app.post('/shop/approve', (req,res)=>{ const o = data.orders.find(x=>x.id===req.body.id); if(!o) return res.status(404).json({error:'not found'}); o.status='APPROVED'; save(); res.json(o); });
app.post('/shop/reject', (req,res)=>{ const o = data.orders.find(x=>x.id===req.body.id); if(!o) return res.status(404).json({error:'not found'}); o.status='REJECTED'; save(); res.json(o); });

// =====================================================
// KAYVIEW META API - On top of YOUR hosts
// Account ID = AHE Key
// =====================================================
app.get('/users/current/accounts', (req,res)=>res.json(data.hosts.map(h=>({id:h.key, login:h.mtLogin, server:h.mtServer, name:h.eaName, pair:h.pair, state: realStatus(h)==='ONLINE'?'DEPLOYED':'UNDEPLOYED', balance:h.balance, equity:h.equity}))));
app.get('/users/current/accounts/:id', (req,res)=>{ const h=data.hosts.find(x=>x.key===req.params.id); if(!h) return res.status(404).json({error:'Account not found'}); res.json({...h, status: realStatus(h)}); });
app.get('/users/current/accounts/:id/account-information', (req,res)=>{ const h=data.hosts.find(x=>x.key===req.params.id); if(!h) return res.status(404).json({error:'Account not found'}); res.json({balance:h.balance, equity:h.equity, margin:h.margin, freeMargin:h.freeMargin, profit:h.profit, currency:'ZAR', leverage:500, marginLevel: h.margin? (h.equity/h.margin*100):0, live: realStatus(h)==='ONLINE', lastSync:h.lastSync}); });
app.get('/users/current/accounts/:id/positions', (req,res)=>{ const h=data.hosts.find(x=>x.key===req.params.id); if(!h) return res.status(404).json({error:'Account not found'}); res.json(h.positions||[]); });
app.get('/users/current/accounts/:id/orders', (req,res)=>res.json([]));
app.get('/users/current/accounts/:id/history-deals/:from/:to', (req,res)=>res.json(data.history.filter(x=>x.key===req.params.id)||[]));
app.get('/users/current/accounts/:id/symbols/:symbol/current-price', (req,res)=>{ const h=data.hosts.find(x=>x.key===req.params.id); res.json({symbol:req.params.symbol, bid:0, ask:0, lastSync:h?.lastSync||null, online: h?realStatus(h)==='ONLINE':false}); });

// TRADE - Queue for EA - EA polls /host/commands/:key every 10s
app.post('/users/current/accounts/:id/trade', (req,res)=>{
  const h = data.hosts.find(x=>x.key===req.params.id);
  if(!h) return res.status(404).json({error:'Account not found'});
  const {actionType, symbol, volume, stopLoss, takeProfit, comment} = req.body;
  const vol = parseFloat(volume||0.01);
  if(vol<=0 || vol>5) return res.status(400).json({error:'Volume 0.01-5.00 only'});
  if(realStatus(h)!=='ONLINE') return res.status(400).json({error:'EA OFFLINE - MT5 must be ONLINE. Last sync: '+(h.lastSync||'never')});
  const cmd = {id:Date.now().toString(), key:h.key, type:'TRADE', actionType:actionType||'ORDER_TYPE_BUY', symbol:(symbol||h.pair||'XAUUSD').toUpperCase(), volume:vol, stopLoss:stopLoss||0, takeProfit:takeProfit||0, comment:comment||'SKYNET AI +', created:new Date().toISOString(), status:'PENDING'};
  data.commands.push(cmd); save();
  io.emit('TRADE_COMMAND', cmd); // Socket.io to EA if connected via socket
  res.json({ok:true, tradeId:cmd.id, status:'SENT_TO_EA', message:'Trade queued - EA executes on next poll (max 10s)'});
});
app.post('/users/current/accounts/:id/positions/:posId/close', (req,res)=>{
  const h = data.hosts.find(x=>x.key===req.params.id);
  if(!h) return res.status(404).json({error:'Account not found'});
  const cmd = {id:Date.now().toString(), key:h.key, type:'CLOSE_POSITION', positionId:req.params.posId, created:new Date().toISOString(), status:'PENDING'};
  data.commands.push(cmd); save(); io.emit('TRADE_COMMAND', cmd);
  res.json({ok:true, status:'SENT_TO_EA'});
});
app.get('/host/commands/:key', (req,res)=>res.json((data.commands||[]).filter(c=>c.key===req.params.key && c.status==='PENDING')));
app.post('/host/commands/done', (req,res)=>{ const c=(data.commands||[]).find(x=>x.id===req.body.id); if(c){ c.status='EXECUTED'; c.result=req.body.result||''; c.executedAt=new Date().toISOString(); save(); } res.json({ok:true}); });

// SIGNALS + WEBHOOKS
app.get('/api/v1/signals', (req,res)=>res.json({ok:true, signals:data.signals.slice(0,50)}));
app.get('/api/v1/signals/latest', (req,res)=>res.json({ok:true, signal:data.signals[0]||null}));
app.post('/webhook/trading', (req,res)=>{
  const b=req.body;
  const s={id:Date.now().toString(), symbol:(b.symbol||b.ticker||'XAUUSD').toUpperCase(), action:(b.action||b.side||'').toUpperCase(), price:parseFloat(b.price||b.close||0), sl:parseFloat(b.sl||0), tp:parseFloat(b.tp||0), lot:parseFloat(b.lot||0.01), strategy:b.strategy||'TradingView', at:new Date().toISOString(), status:'PENDING'};
  if(!['BUY','SELL','CLOSE'].includes(s.action)) return res.status(400).json({ok:false, error:'BUY/SELL/CLOSE only'});
  data.signals.unshift(s); save();
  io.emit('SIGNAL', s);
  res.json({ok:true, signal:s});
});
app.post('/webhook/payfast', (req,res)=>{ console.log('PayFast webhook', req.body); res.status(200).send('OK'); });

// PayFast create - using YOUR axios + dotenv
app.post('/payfast/create', async (req,res)=>{
  try{
    const {amount, email, item_name, m_payment_id} = req.body;
    // For now return data for frontend form - PayFast HTML form flow
    res.json({ok:true, merchant_id: process.env.PF_MERCHANT_ID||'10000100', merchant_key: process.env.PF_MERCHANT_KEY||'46f0cd694581a', amount: amount||550, item_name: item_name||'KAYVIEW CHARGER', m_payment_id: m_payment_id||Date.now().toString(), notify_url: (process.env.APP_URL||'https://kayview-api.onrender.com') + '/webhook/payfast', return_url: (process.env.APP_URL||'https://kayview-api.onrender.com') + '/success'});
  }catch(e){ res.status(500).json({ok:false, error:String(e)}); }
});

// =====================================================
// SOCKET.IO - YOUR realtime - Replaces ws
// EA / App connect: io('https://kayview-api.onrender.com')
// =====================================================
io.on('connection', (socket)=>{
  console.log('Socket connected:', socket.id);
  socket.on('join', (room)=>{ socket.join(room); console.log('Joined room:', room); });
  socket.on('ACCOUNT_UPDATE', (m)=>{
    const h = data.hosts.find(x=>x.key===m.key);
    if(h){ h.balance=m.balance; h.equity=m.equity; h.margin=m.margin; h.freeMargin=m.freeMargin; h.profit=m.profit; h.positions=m.positions||[]; h.lastSync=new Date().toISOString(); save(); io.emit('ACCOUNT_UPDATE', {...m, lastSync:h.lastSync}); }
  });
  socket.on('TRADE_RESULT', (m)=>{ io.emit('TRADE_RESULT', m); console.log('TRADE RESULT:', m); });
  socket.on('disconnect', ()=>console.log('Socket disconnected:', socket.id));
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, ()=>console.log('Live on '+PORT+' - KAYVIEW CHARGER API + META API - Socket.io - REAL SYNC ONLY'));
