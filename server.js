const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http'); // NEW - for WebSocket
const WebSocket = require('ws'); // NEW - npm i ws
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));
const server = http.createServer(app); // NEW - was app.listen
const wss = new WebSocket.Server({ noServer: true }); // NEW

// ===== PERMANENT STORAGE =====
const DATA_FILE = path.join(__dirname, 'data.json');
let data = { keys: [], accounts: [], opens: [], hosts: [], orders: [], signals: [], history: [] };
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

function realStatus(h){
  if(!h.lastSync) return 'WAITING_FOR_MT5';
  let sec = (Date.now() - new Date(h.lastSync).getTime())/1000;
  if(sec > 35) return 'OFFLINE';
  return 'ONLINE';
}

// ===== META API CONFIG =====
const API_TOKEN = process.env.KAYVIEW_TOKEN || 'KAYVIEW-TOKEN-123';
let bridgeClients = new Set();
let appClients = new Set();
function broadcastToBridge(msg){ const s=JSON.stringify(msg); bridgeClients.forEach(ws=>{ try{ if(ws.readyState===1) ws.send(s);}catch(e){} }); }
function broadcastToApp(msg){ const s=JSON.stringify(msg); appClients.forEach(ws=>{ try{ if(ws.readyState===1) ws.send(s);}catch(e){} }); }

app.get('/', (req,res)=>res.send('Ambient Host EA API Live - REAL MT5 Sync Only + KAYVIEW META API'));
app.get('/health', (req,res)=>{
  let online = data.hosts.filter(h=>realStatus(h)==='ONLINE').length;
  res.json({ok:true, api:'KAYVIEW META API v1', keys: data.keys.length, accounts: data.accounts.length, hosts: data.hosts.length, hostsOnlineReal: online, opens: data.opens.length, orders: data.orders.length, bridgeConnected: bridgeClients.size>0});
});

// ===== REAL AUTH - YOUR CODE - UNCHANGED =====
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

// ===== KEYS - YOUR CODE =====
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
// NEW: MetaApi style key validate
app.get('/api/v1/keys/validate', (req,res)=>{
  const k = data.keys.find(x=>x.code===req.query.key);
  if(!k) return res.json({ok:false, valid:false, reason:'NOT_FOUND'});
  if(k.status==='INACTIVE') return res.json({ok:false, valid:false, reason:'DEACTIVATED'});
  res.json({ok:true, valid:true, code:k.code, bot:k.bot_name||'SKYNET AI PRO +', status:k.status});
});

// ===== REAL HOSTING - YOUR CODE - UNCHANGED =====
app.get('/host/list', (req,res)=>{
  let out = data.hosts.map(h=>({...h, status: realStatus(h)}));
  res.json(out);
});
app.post('/host/start', (req,res)=>{
  const {email, mtLogin, mtServer, eaName, pair, key} = req.body;
  const k = data.keys.find(x=>x.code===key);
  if(!k) return res.status(400).json({error:'Invalid AHE Key - Get a key from your mentor first'});
  if(k.status==='INACTIVE') return res.status(400).json({error:'Key is INACTIVE'});
  const existing = data.hosts.find(h=>h.key===key);
  if(existing){
    existing.mtLogin = mtLogin||existing.mtLogin;
    existing.mtServer = mtServer||existing.mtServer;
    existing.eaName = eaName||existing.eaName;
    existing.pair = pair||existing.pair;
    existing.lastSync = null;
    existing.balance = null; existing.equity = null; existing.profit = null; existing.positions = [];
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
  h.balance = balance; h.equity = equity; h.margin = margin; h.freeMargin = freeMargin;
  h.profit = profit; h.positions = Array.isArray(positions) ? positions : [];
  h.trades = h.positions.length;
  if(mtLogin) h.mtLogin = mtLogin;
  h.lastSync = new Date().toISOString();
  save();
  // NEW: Forward to live app clients - like MetaApi streaming
  broadcastToApp({type:'ACCOUNT_UPDATE', key, balance, equity, margin, freeMargin, profit, positions:h.positions, lastSync:h.lastSync});
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

// ===== REAL KEY SHOP =====
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

// =====================================================
// NEW: KAYVIEW META API - Built ON TOP of YOUR hosts
// Your hosts[] ARE your accounts. key = accountId
// =====================================================

// 1. ACCOUNTS - MetaApi style, but using your hosts
app.get('/users/current/accounts', (req,res)=>{
  res.json(data.hosts.map(h=>({id:h.key, login:h.mtLogin, server:h.mtServer, name:h.eaName, pair:h.pair, state: realStatus(h)==='ONLINE'?'DEPLOYED':'UNDEPLOYED', balance:h.balance, equity:h.equity})));
});
app.get('/users/current/accounts/:id', (req,res)=>{
  const h = data.hosts.find(x=>x.key===req.params.id);
  if(!h) return res.status(404).json({error:'Account not found - Use AHE key as ID'});
  res.json({...h, status: realStatus(h)});
});

// 2. ACCOUNT INFORMATION
app.get('/users/current/accounts/:id/account-information', (req,res)=>{
  const h = data.hosts.find(x=>x.key===req.params.id);
  if(!h) return res.status(404).json({error:'Account not found'});
  res.json({balance:h.balance, equity:h.equity, margin:h.margin, freeMargin:h.freeMargin, profit:h.profit, currency:'ZAR', leverage:500, marginLevel: h.margin? (h.equity/h.margin*100):0, live: realStatus(h)==='ONLINE', lastSync:h.lastSync});
});

// 3. POSITIONS - From real /host/sync
app.get('/users/current/accounts/:id/positions', (req,res)=>{
  const h = data.hosts.find(x=>x.key===req.params.id);
  if(!h) return res.status(404).json({error:'Account not found'});
  res.json(h.positions||[]);
});

// 4. ORDERS / HISTORY
app.get('/users/current/accounts/:id/orders', (req,res)=>res.json([])); // Pending orders come from EA sync later
app.get('/users/current/accounts/:id/history-deals/:from/:to', (req,res)=>{
  res.json(data.history.filter(x=>x.key===req.params.id)||[]);
});

// 5. TRADE - Send trade command TO EA - EA must poll /host/commands/:key
if(!data.commands) data.commands=[];
app.post('/users/current/accounts/:id/trade', (req,res)=>{
  const h = data.hosts.find(x=>x.key===req.params.id);
  if(!h) return res.status(404).json({error:'Account not found'});
  const {actionType, symbol, volume, stopLoss, takeProfit, comment} = req.body;
  const vol = parseFloat(volume||0.01);
  if(vol<=0 || vol>5) return res.status(400).json({error:'Volume 0.01-5.00 only'});
  if(realStatus(h)!=='ONLINE') return res.status(400).json({error:'EA OFFLINE - MT5 must be ONLINE to trade. Last sync: '+(h.lastSync||'never')});
  const cmd = {id:Date.now().toString(), key:h.key, type:'TRADE', actionType:actionType||'ORDER_TYPE_BUY', symbol:(symbol||h.pair||'XAUUSD').toUpperCase(), volume:vol, stopLoss:stopLoss||0, takeProfit:takeProfit||0, comment:comment||'SKYNET AI +', created:new Date().toISOString(), status:'PENDING'};
  data.commands.push(cmd); save();
  broadcastToBridge({type:'TRADE', ...cmd});
  res.json({ok:true, tradeId:cmd.id, status:'SENT_TO_EA', message:'Trade queued - EA will execute on next poll (max 10s)'});
});
app.post('/users/current/accounts/:id/positions/:posId/close', (req,res)=>{
  const h = data.hosts.find(x=>x.key===req.params.id);
  if(!h) return res.status(404).json({error:'Account not found'});
  const cmd = {id:Date.now().toString(), key:h.key, type:'CLOSE_POSITION', positionId:req.params.posId, created:new Date().toISOString(), status:'PENDING'};
  data.commands.push(cmd); save();
  broadcastToBridge({type:'CLOSE_POSITION', ...cmd});
  res.json({ok:true, status:'SENT_TO_EA'});
});
// EA polls this every 10s - SAME as /host/sync - NO WebSocket needed on MT5
app.get('/host/commands/:key', (req,res)=>{
  const cmds = (data.commands||[]).filter(c=>c.key===req.params.key && c.status==='PENDING');
  res.json(cmds);
});
app.post('/host/commands/done', (req,res)=>{
  const c = (data.commands||[]).find(x=>x.id===req.body.id);
  if(c){ c.status='EXECUTED'; c.result=req.body.result||''; c.executedAt=new Date().toISOString(); save(); }
  res.json({ok:true});
});

// 6. MARKET DATA - Candles (EA can send, or demo)
app.get('/users/current/accounts/:id/symbols/:symbol/current-price', (req,res)=>{
  const h = data.hosts.find(x=>x.key===req.params.id);
  res.json({symbol:req.params.symbol, bid:h?.positions?.[0]?.price||0, lastSync:h?.lastSync||null, online: h?realStatus(h)==='ONLINE':false});
});

// 7. SIGNALS + WEBHOOK - TradingView -> Your API -> EA
app.get('/api/v1/signals', (req,res)=>res.json({ok:true, signals:data.signals.slice(0,50)}));
app.get('/api/v1/signals/latest', (req,res)=>res.json({ok:true, signal:data.signals[0]||null}));
app.post('/webhook/trading', (req,res)=>{
  const b=req.body;
  const s={id:Date.now().toString(), symbol:(b.symbol||b.ticker||'XAUUSD').toUpperCase(), action:(b.action||b.side||'').toUpperCase(), price:parseFloat(b.price||b.close||0), sl:parseFloat(b.sl||0), tp:parseFloat(b.tp||0), lot:parseFloat(b.lot||0.01), strategy:b.strategy||'TradingView', at:new Date().toISOString(), status:'PENDING'};
  if(!['BUY','SELL','CLOSE'].includes(s.action)) return res.status(400).json({ok:false, error:'BUY/SELL/CLOSE only'});
  data.signals.unshift(s); save();
  broadcastToApp({type:'SIGNAL', signal:s});
  // If you want auto-trade: create command for ALL online hosts
  // data.hosts.filter(h=>realStatus(h)==='ONLINE').forEach(h=>{ data.commands.push({id:Date.now()+h.key, key:h.key, type:'TRADE', actionType: s.action==='BUY'?'ORDER_TYPE_BUY':'ORDER_TYPE_SELL', symbol:s.symbol, volume:s.lot, stopLoss:s.sl, takeProfit:s.tp, created:new Date().toISOString(), status:'PENDING'}); }); save();
  res.json({ok:true, signal:s});
});

// 8. WEBSOCKET - For SKYNET App live ticks
server.on('upgrade', (req,socket,head)=>{
  if((req.url||'').startsWith('/ws/')){
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));
  } else socket.destroy();
});
wss.on('connection', (ws,req)=>{
  const isBridge = (req.url||'').includes('/ws/bridge');
  if(isBridge) bridgeClients.add(ws); else appClients.add(ws);
  ws.send(JSON.stringify({type:'WELCOME', role:isBridge?'BRIDGE':'APP'}));
  ws.on('message', raw=>{
    try{
      const m=JSON.parse(raw.toString());
      if(m.type==='ACCOUNT_UPDATE' && m.key){
        const h=data.hosts.find(x=>x.key===m.key);
        if(h){ h.balance=m.balance; h.equity=m.equity; h.margin=m.margin; h.freeMargin=m.freeMargin; h.profit=m.profit; h.positions=m.positions||[]; h.lastSync=new Date().toISOString(); save(); broadcastToApp({type:'ACCOUNT_UPDATE', key:m.key, live:h}); }
      }
    }catch(e){}
  });
  ws.on('close', ()=>{ bridgeClients.delete(ws); appClients.delete(ws); });
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, ()=>console.log('Live on '+PORT+' - REAL SYNC ONLY + META API'));
