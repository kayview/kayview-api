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
let data = { keys: [], accounts: [], opens: [] };
try {
  if (fs.existsSync(DATA_FILE)) {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!data.keys) data.keys = [];
    if (!data.accounts) data.accounts = [];
    if (!data.opens) data.opens = [];
    console.log('Loaded permanent data:', data.keys.length, 'keys,', data.accounts.length, 'accounts');
  }
} catch(e) { console.log('Starting fresh DB', e.message); }

function save() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2)); }
  catch(e) { console.log('Save failed', e.message); }
}
let keys = data.keys;

function genCode(){
  const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let p=''; for(let i=0;i<3;i++) p+=chars[Math.floor(Math.random()*chars.length)];
  let p2=''; for(let i=0;i<3;i++) p2+=chars[Math.floor(Math.random()*chars.length)];
  let p3=''; for(let i=0;i<3;i++) p3+=chars[Math.floor(Math.random()*chars.length)];
  return `AHE-${p}-${p2}-${p3}`;
}

app.get('/', (req,res)=>res.send('Ambient Host EA API Live'));
app.get('/health', (req,res)=>res.json({ok:true, keys: data.keys.length, accounts: data.accounts.length}));

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

const PORT = process.env.PORT || 10000;
app.listen(PORT, ()=>console.log('Live on '+PORT));
