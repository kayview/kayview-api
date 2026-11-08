const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

let keys = [];
let n = 0;
function genCode(){
  const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let p=''; for(let i=0;i<3;i++) p+=chars[Math.floor(Math.random()*chars.length)];
  let p2=''; for(let i=0;i<3;i++) p2+=chars[Math.floor(Math.random()*chars.length)];
  let p3=''; for(let i=0;i<3;i++) p3+=chars[Math.floor(Math.random()*chars.length)];
  return `PHE-${p}-${p2}-${p3}`;
}

app.get('/', (req,res)=>res.send('Kayview API Live - Prime Host'));
app.get('/health', (req,res)=>res.json({ok:true}));

// Get all keys
app.get('/prime/keys', (req,res)=>res.json(keys));

// Generate key
app.post('/prime/keys/generate', (req,res)=>{
  const {username,email,duration_days,bot_name} = req.body;
  const code = genCode();
  const k = {id:Date.now().toString(), code, username:username||'Junior', email:email||'', duration_days:duration_days||30, bot_name:bot_name||'THE SHADOW ELITE SCALPER 2.0', status:'UNUSED', created: new Date().toISOString()};
  keys.unshift(k);
  res.json(k);
});

// Deactivate / Reactivate
app.post('/prime/keys/toggle', (req,res)=>{
  const k = keys.find(x=>x.id===req.body.id);
  if(!k) return res.status(404).json({error:'not found'});
  k.status = req.body.status || (k.status==='INACTIVE'?'UNUSED':'INACTIVE');
  res.json(k);
});

// Delete
app.delete('/prime/keys/:id', (req,res)=>{
  keys = keys.filter(x=>x.id!==req.params.id);
  res.json({ok:true});
});

// EA validate - for MT5 / App
app.get('/keys/validate', (req,res)=>{
  const k = keys.find(x=>x.code===req.query.key);
  if(!k) return res.json({valid:false});
  if(k.status==='INACTIVE') return res.json({valid:false, reason:'inactive'});
  res.json({valid:true, username:k.username, bot:k.bot_name, days:k.duration_days});
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, ()=>console.log('Live on '+PORT));
