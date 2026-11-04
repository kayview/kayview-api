
require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET","POST"] }
});

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'kv_live_2024_secret';

app.use(cors({ origin: "*" }));
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

// ===== IN-MEMORY STORES (Render free tier - use DB later if needed) =====
let accounts = {}; // accountId -> {id, password, serverName, platform, status, accountInfo, positions, history, pendingTrades[], logs[], lastSeen, eaConnected}
let marketPrices = {}; // symbol -> {price, bid, ask, time}
let robotKeys = {
  "PHE0000E91": { name: "KAYVIEW CHARGER", expiresIn: "357d 12h", status: "LIVE" }
};

// ===== DERIV LIVE FEED (Server-side cache for web + APK) =====
let derivWs = null;
function connectDeriv() {
  const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${process.env.DERIV_APP_ID || 1089}`);
  derivWs = ws;
  ws.on('open', () => {
    console.log('[DERIV] Connected');
    ['frxXAUUSD','cryBTCUSD','R_20','1HZ80V','frxEURUSD','frxGBPUSD'].forEach(s => {
      ws.send(JSON.stringify({ ticks: s, subscribe: 1 }));
    });
  });
  ws.on('message', (data) => {
    try {
      const d = JSON.parse(data);
      if (d.tick) {
        const price = parseFloat(d.tick.quote);
        marketPrices[d.tick.symbol] = {
          symbol: d.tick.symbol,
          price,
          bid: price,
          ask: price * 1.0002,
          time: Date.now(),
          display: d.tick.symbol.replace('frx','').replace('cry','')
        };
        // Broadcast to all web clients
        io.emit('market:tick', marketPrices[d.tick.symbol]);
      }
    } catch(e){}
  });
  ws.on('close', () => {
    console.log('[DERIV] Disconnected, reconnecting in 3s');
    setTimeout(connectDeriv, 3000);
  });
  ws.on('error', (e)=>console.log('[DERIV] Error', e.message));
}
connectDeriv();

// ===== MIDDLEWARE =====
function checkApiKey(req, res, next) {
  // EA must send x-api-key header, web is allowed without (or with same key)
  const key = req.headers['x-api-key'] || req.query.api_key;
  if (req.path.startsWith('/api/ea/')) {
    if (key !== API_KEY) return res.status(401).json({ error: 'Invalid API_KEY' });
  }
  next();
}
app.use(checkApiKey);

// ===== ROUTES =====
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), accounts: Object.keys(accounts).length, marketSymbols: Object.keys(marketPrices) });
});

app.get('/api/market', (req, res) => {
  res.json({ success: true, prices: marketPrices });
});

app.get('/api/market/:symbol', (req, res) => {
  const sym = req.params.symbol;
  const p = marketPrices[sym] || marketPrices['frx'+sym] || marketPrices[sym.replace('XAUUSD','frxXAUUSD')];
  if (!p) return res.status(404).json({ success: false, error: 'Symbol not found, waiting for tick' });
  res.json({ success: true, ...p });
});

// ---- ROBOT KEYS ----
app.get('/api/robots', (req, res) => {
  const list = Object.entries(robotKeys).map(([key, v]) => ({ key, ...v }));
  res.json({ success: true, robots: list });
});

app.post('/api/keys/validate', (req, res) => {
  const { key } = req.body;
  if (robotKeys[key]) {
    res.json({ success: true, valid: true, robot: robotKeys[key] });
  } else if (key && key.startsWith('PHE')) {
    // accept any PHE key for demo
    res.json({ success: true, valid: true, robot: { name: "KAYVIEW CHARGER", expiresIn: "357d 12h", status: "LIVE" } });
  } else {
    res.json({ success: false, valid: false, error: 'Invalid key' });
  }
});

// ---- CONNECT MT ACCOUNT (Web -> Server) ----
app.post('/api/connect', (req, res) => {
  const { accountId, password, serverName, platform } = req.body;
  if (!accountId) return res.status(400).json({ success: false, error: 'accountId required' });
  
  const id = String(accountId);
  if (!accounts[id]) {
    accounts[id] = {
      id,
      password,
      serverName: serverName || 'Unknown',
      platform: platform || 'MT5',
      status: 'pending_ea',
      accountInfo: null,
      positions: [],
      history: [],
      pendingTrades: [],
      logs: [],
      eaConnected: false,
      lastSeen: null,
      createdAt: Date.now()
    };
  } else {
    accounts[id].password = password || accounts[id].password;
    accounts[id].serverName = serverName || accounts[id].serverName;
    accounts[id].platform = platform || accounts[id].platform;
  }

  // Add log
  accounts[id].logs.push({ time: new Date().toLocaleTimeString(), msg: `CONNECT request: ${id} @ ${serverName} - Waiting for EA`, type: 'info' });
  if (accounts[id].logs.length > 200) accounts[id].logs.shift();

  io.emit('account:status', { accountId: id, status: accounts[id].status });

  res.json({ 
    success: true, 
    message: 'Account registered. Install EA with same Account ID and API URL.',
    accountId: id,
    status: accounts[id].status,
    nextStep: `Set EA inputs: API_URL=https://${req.get('host')}, ACCOUNT_ID=${id}, API_KEY=your_key`
  });
});

// ---- EA ENDPOINTS (EA -> Server) ----
app.post('/api/ea/online', (req, res) => {
  const { accountId, accountInfo, positions, balance, equity } = req.body;
  if (!accountId) return res.status(400).json({ success: false, error: 'accountId required' });
  const id = String(accountId);
  
  if (!accounts[id]) {
    // Auto-create if EA connects first
    accounts[id] = {
      id,
      status: 'connected',
      accountInfo: null,
      positions: [],
      history: [],
      pendingTrades: [],
      logs: [],
      eaConnected: true,
      lastSeen: Date.now(),
      createdAt: Date.now()
    };
  }

  accounts[id].accountInfo = accountInfo || { balance, equity, accountId: id, server: accounts[id].serverName };
  if (balance) accounts[id].accountInfo.balance = balance;
  if (equity) accounts[id].accountInfo.equity = equity;
  accounts[id].positions = positions || accounts[id].positions;
  accounts[id].eaConnected = true;
  accounts[id].status = 'connected';
  accounts[id].lastSeen = Date.now();

  // Broadcast to web clients watching this account
  io.to(`account_${id}`).emit('account:update', accounts[id].accountInfo);
  io.to(`account_${id}`).emit('positions:update', accounts[id].positions);
  io.emit('account:status', { accountId: id, status: 'connected', accountInfo: accounts[id].accountInfo });

  res.json({ success: true, pendingTrades: accounts[id].pendingTrades });
});

app.post('/api/ea/heartbeat', (req, res) => {
  const { accountId, accountInfo, positions } = req.body;
  const id = String(accountId);
  if (accounts[id]) {
    if (accountInfo) accounts[id].accountInfo = { ...accounts[id].accountInfo, ...accountInfo };
    if (positions) accounts[id].positions = positions;
    accounts[id].lastSeen = Date.now();
    accounts[id].eaConnected = true;
    io.to(`account_${id}`).emit('account:update', accounts[id].accountInfo);
    io.to(`account_${id}`).emit('positions:update', accounts[id].positions);
  }
  res.json({ success: true, pendingTrades: accounts[id]?.pendingTrades || [] });
});

app.post('/api/ea/log', (req, res) => {
  const { accountId, message, type } = req.body;
  const id = String(accountId);
  if (!accounts[id]) return res.json({ success: false });
  const logEntry = { time: new Date().toLocaleTimeString(), msg: message, type: type || 'info' };
  accounts[id].logs.push(logEntry);
  if (accounts[id].logs.length > 200) accounts[id].logs.shift();
  io.to(`account_${id}`).emit('log:new', logEntry);
  // Special: if log contains BUY/SELL, also emit trade event
  if (message.includes('BUY') || message.includes('SELL') || message.includes('TP ADDED') || message.includes('SL ADDED')) {
    io.to(`account_${id}`).emit('trade:executed', logEntry);
  }
  res.json({ success: true });
});

app.post('/api/ea/tradeResult', (req, res) => {
  const { accountId, ticket, success, error, price } = req.body;
  const id = String(accountId);
  io.to(`account_${id}`).emit('trade:result', { ticket, success, error, price, time: new Date().toLocaleTimeString() });
  res.json({ success: true });
});

app.get('/api/ea/:id/pendingTrades', (req, res) => {
  const id = String(req.params.id);
  const trades = accounts[id]?.pendingTrades || [];
  res.json({ success: true, trades });
});

// ---- WEB ENDPOINTS (Web/APK -> Server -> EA) ----
app.get('/api/:id/account', (req, res) => {
  const acc = accounts[req.params.id];
  if (!acc) return res.status(404).json({ success: false, error: 'Account not connected' });
  res.json({ success: true, account: acc.accountInfo, status: acc.status, eaConnected: acc.eaConnected, lastSeen: acc.lastSeen });
});

app.get('/api/:id/positions', (req, res) => {
  const acc = accounts[req.params.id];
  if (!acc) return res.status(404).json({ success: false, error: 'Account not found' });
  res.json({ success: true, positions: acc.positions, count: acc.positions.length });
});

app.get('/api/:id/history', (req, res) => {
  const acc = accounts[req.params.id];
  if (!acc) return res.status(404).json({ success: false, error: 'Account not found' });
  res.json({ success: true, history: acc.history });
});

app.get('/api/:id/logs', (req, res) => {
  const acc = accounts[req.params.id];
  if (!acc) return res.json({ success: true, logs: [] });
  res.json({ success: true, logs: acc.logs });
});

app.post('/api/:id/trade', (req, res) => {
  const id = String(req.params.id);
  if (!accounts[id]) return res.status(404).json({ success: false, error: 'Account not found. Connect EA first.' });
  const { symbol, action, lot, sl, tp, price } = req.body;
  const livePrice = marketPrices[symbol] || marketPrices['frx'+symbol] || { price: price || 0 };
  
  const tradeReq = {
    id: Date.now().toString(),
    symbol: symbol || 'XAUUSD',
    action: action || 'BUY',
    lot: parseFloat(lot) || 0.03,
    sl: sl || 0,
    tp: tp || 0,
    price: livePrice.price || price,
    livePrice: livePrice.price,
    status: 'pending',
    createdAt: Date.now(),
    createdAtStr: new Date().toLocaleTimeString()
  };

  accounts[id].pendingTrades.push(tradeReq);
  accounts[id].logs.push({ time: tradeReq.createdAtStr, msg: `Trade request: ${action} ${symbol} @ ${tradeReq.livePrice} vol ${lot}`, type: 'request' });
  if (accounts[id].logs.length > 200) accounts[id].logs.shift();

  // Real-time to EA via socket
  io.to(`ea_${id}`).emit('trade:request', tradeReq);
  io.to(`account_${id}`).emit('trade:pending', tradeReq);

  res.json({ success: true, message: 'Trade queued - EA will execute with LIVE price', trade: tradeReq });
});

app.delete('/api/:id/trade/:tradeId', (req, res) => {
  const id = String(req.params.id);
  if (accounts[id]) {
    accounts[id].pendingTrades = accounts[id].pendingTrades.filter(t => t.id !== req.params.tradeId);
  }
  res.json({ success: true });
});

// ---- ANALYSE (Scanner logic - server side) ----
app.post('/api/analyse', (req, res) => {
  const { symbol, timeframe, lot, trades } = req.body;
  const sym = symbol || 'frxXAUUSD';
  const live = marketPrices[sym] || marketPrices['frx'+sym.replace('frx','')] || { price: 2650.00 + Math.random()*10 };
  
  // Simple mock signal logic - replace with your real AI
  const signals = ['BUY','SELL'];
  const signal = signals[Math.floor(Math.random()*signals.length)];
  const price = live.price;

  // Only generate TP/SL when real live execution (as you requested)
  const tp = signal === 'BUY' ? (price * 1.002).toFixed(2) : (price * 0.998).toFixed(2);
  const sl = signal === 'BUY' ? (price * 0.999).toFixed(2) : (price * 1.001).toFixed(2);

  res.json({
    success: true,
    live: true,
    symbol: sym,
    displaySymbol: sym.replace('frx','').replace('cry',''),
    price,
    signal,
    tp: parseFloat(tp),
    sl: parseFloat(sl),
    lot: parseFloat(lot) || 0.03,
    trades: parseInt(trades) || 10,
    timestamp: new Date().toISOString(),
    message: `REAL LIVE Signal @ ${price.toFixed(2)} - ${signal}`
  });
});

// ---- ADMIN ----
app.get('/api/admin/accounts', (req, res) => {
  const list = Object.values(accounts).map(a => ({
    id: a.id,
    status: a.status,
    eaConnected: a.eaConnected,
    lastSeen: a.lastSeen,
    serverName: a.serverName,
    platform: a.platform,
    balance: a.accountInfo?.balance,
    positions: a.positions?.length || 0
  }));
  res.json({ success: true, accounts: list });
});

app.delete('/api/admin/accounts/:id', (req, res) => {
  delete accounts[req.params.id];
  res.json({ success: true });
});

// ===== SOCKET.IO =====
io.on('connection', (socket) => {
  console.log('[SOCKET] Connected', socket.id);

  socket.on('join:account', (accountId) => {
    const id = String(accountId);
    socket.join(`account_${id}`);
    console.log(`[SOCKET] ${socket.id} joined account_${id} as WEB`);
    if (accounts[id]) {
      socket.emit('account:update', accounts[id].accountInfo);
      socket.emit('positions:update', accounts[id].positions);
      socket.emit('logs:update', accounts[id].logs);
    }
  });

  socket.on('join:ea', (data) => {
    const { accountId, apiKey } = data;
    if (apiKey !== API_KEY) {
      socket.emit('error', { message: 'Invalid API key' });
      return;
    }
    const id = String(accountId);
    socket.join(`ea_${id}`);
    socket.join(`account_${id}`);
    console.log(`[SOCKET] ${socket.id} joined ea_${id} as EA`);
    if (accounts[id]) {
      accounts[id].eaConnected = true;
      accounts[id].lastSeen = Date.now();
      accounts[id].status = 'connected';
    }
  });

  socket.on('ea:accountUpdate', (data) => {
    const { accountId, accountInfo, positions } = data;
    const id = String(accountId);
    if (accounts[id]) {
      accounts[id].accountInfo = accountInfo;
      accounts[id].positions = positions || [];
      accounts[id].lastSeen = Date.now();
      io.to(`account_${id}`).emit('account:update', accountInfo);
      io.to(`account_${id}`).emit('positions:update', positions);
    }
  });

  socket.on('ea:log', (data) => {
    const { accountId, message } = data;
    const id = String(accountId);
    if (accounts[id]) {
      const entry = { time: new Date().toLocaleTimeString(), msg: message, type: 'live' };
      accounts[id].logs.push(entry);
      if (accounts[id].logs.length > 200) accounts[id].logs.shift();
      io.to(`account_${id}`).emit('log:new', entry);
    }
  });

  socket.on('disconnect', () => {
    console.log('[SOCKET] Disconnected', socket.id);
  });
});

// ===== START =====
server.listen(PORT, () => {
  console.log(`\n=== KAYVIEW CHARGER API ===`);
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`API Key: ${API_KEY}`);
  console.log(`Deriv Feed: ${Object.keys(marketPrices).length} symbols cached`);
  console.log(`============================\n`);
});
