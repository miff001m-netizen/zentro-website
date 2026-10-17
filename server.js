const express=require('express');const path=require('path');const crypto=require('crypto');const { createClient }=require('@supabase/supabase-js');const app=express();app.use(express.json());app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'index.html')));const pages={dashboard:'dashboard.html',profile:'dashboard.html',wallet:'dashboard.html',bank:'dashboard.html',transfers:'dashboard.html',leaderboard:'dashboard.html',achievements:'dashboard.html',settings:'dashboard.html'};Object.entries(pages).forEach(([route,file])=>app.get('/'+route,(req,res)=>res.sendFile(path.join(__dirname,file))));app.use(express.static(__dirname));

const SUPABASE_URL=process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY){throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required')}
const supabase=createClient(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});

const CLIENT_ID=process.env.DISCORD_CLIENT_ID||'1423936447586713741';
const CLIENT_SECRET=process.env.DISCORD_CLIENT_SECRET||'';
const REDIRECT_URI=process.env.DISCORD_REDIRECT_URI||'https://zentro-website-five.vercel.app/auth/callback';
const SECRET=process.env.SESSION_SECRET;
if(!SECRET||SECRET.length<32){throw new Error('SESSION_SECRET must be set to a random value of at least 32 characters')}

function sign(v){return v+'.'+crypto.createHmac('sha256',SECRET).update(v).digest('hex')}
function readSession(req){const c=req.headers.cookie||'';const m=c.match(/sid=([^;]+)/);if(!m)return null;const [payload,sig]=decodeURIComponent(m[1]).split('.');if(!payload||!sig||sign(payload)!==payload+'.'+sig)return null;try{return JSON.parse(payload)}catch(e){return null}}

async function getUserByDiscordId(discordId){const {data,error}=await supabase.from('users').select('discord_user_id,xp,wallet_balance,bank_balance,last_daily').eq('discord_user_id',discordId).maybeSingle();if(error)throw error;return data}

async function getUser(req){const session=readSession(req);if(!session||!session.id)return null;const row=await getUserByDiscordId(session.id);if(!row)return null;return {discord_id:row.discord_user_id,username:session.username||null,avatar:session.avatar||null,wallet:Number(row.wallet_balance||0),bank:Number(row.bank_balance||0),xp:Number(row.xp||0),level:1,streak:0,last_daily:row.last_daily}}

app.get('/auth/login',(req,res)=>{const state=crypto.randomBytes(24).toString('hex');res.setHeader('Set-Cookie',`oauth_state=${state}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`);res.redirect(`https://discord.com/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify&state=${state}&prompt=consent`)});

app.get('/auth/logout',(req,res)=>{res.setHeader('Set-Cookie','sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');res.setHeader('Set-Cookie','oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');res.redirect('/')});

app.get('/auth/callback',async(req,res)=>{try{const cookies=req.headers.cookie||'';const stateMatch=cookies.match(/oauth_state=([^;]+)/);const returnedState=req.query.state;if(!stateMatch||!returnedState||stateMatch[1]!==returnedState)return res.status(400).send('Invalid login state');res.setHeader('Set-Cookie','oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');const b=new URLSearchParams({client_id:CLIENT_ID,client_secret:CLIENT_SECRET,grant_type:'authorization_code',code:req.query.code,redirect_uri:REDIRECT_URI});const tokenResponse=await fetch('https://discord.com/api/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:b});if(!tokenResponse.ok)return res.status(401).send('Login failed');const token=await tokenResponse.json();const profileResponse=await fetch('https://discord.com/api/users/@me',{headers:{Authorization:'Bearer '+token.access_token}});if(!profileResponse.ok)return res.status(401).send('Login failed');const profile=await profileResponse.json();const user=await getUserByDiscordId(profile.id);if(!user)return res.status(403).send('This Discord account is not registered in ZENTRO yet. Use /balance in Discord first.');const sessionValue=JSON.stringify({id:profile.id,username:profile.global_name||profile.username||'عضو ZENTRO',avatar:profile.avatar?`https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`:null});res.setHeader('Set-Cookie',`sid=${encodeURIComponent(sign(sessionValue))}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800`);res.redirect('/dashboard')}catch(e){console.error(e);res.status(500).send('Login failed')}});

function auth(req,res,next){getUser(req).then(u=>{if(!u)return res.status(401).json({error:'unauthorized'});req.user=u;next()}).catch(()=>res.status(500).json({error:'server'}))}

function levelFromXp(xp){let level=1,needed=100,remaining=xp;while(remaining>=needed){remaining-=needed;level++;needed=Math.floor(needed*1.5)}return {level,current:remaining,needed}}

app.get('/api/me',async(req,res)=>{try{const u=await getUser(req);if(!u)return res.json({guest:true});const {count,error}=await supabase.from('transfers').select('*',{count:'exact',head:true}).or(`sender_user_id.eq.${u.discord_id},recipient_user_id.eq.${u.discord_id}`);if(error)throw error;const {data:rankRows,error:rankError}=await supabase.from('users').select('wallet_balance,bank_balance').order('wallet_balance',{ascending:false});if(rankError)throw rankError;const total=u.wallet+u.bank;const rank=rankRows.findIndex(r=>Number(r.wallet_balance||0)+Number(r.bank_balance||0)<=total)+1;res.json({guest:false,user:u,total,sentCount:0,receivedCount:0,totalTransactions:count||0,rank:rank||null,transactions:[],canDaily:false,writeDisabled:true,achievements:[]})}catch(e){console.error(e);res.status(500).json({error:'server'})}});

app.get('/api/transactions',auth,async(req,res)=>{try{const {data,error}=await supabase.from('transfers').select('*').or(`sender_user_id.eq.${req.user.discord_id},recipient_user_id.eq.${req.user.discord_id}`).order('created_at',{ascending:false}).limit(50);if(error)throw error;res.json(data)}catch(e){console.error(e);res.status(500).json({error:'server'})}});

app.get('/api/top',auth,async(req,res)=>{try{const {data,error}=await supabase.from('users').select('discord_user_id,wallet_balance,bank_balance').order('wallet_balance',{ascending:false}).limit(100);if(error)throw error;res.json(data.map(r=>({username:r.discord_user_id,avatar:null,total:Number(r.wallet_balance||0)+Number(r.bank_balance||0)})))}catch(e){console.error(e);res.status(500).json({error:'server'})}});

app.get('/api/topxp',auth,async(req,res)=>{try{const {data,error}=await supabase.from('users').select('discord_user_id,xp').order('xp',{ascending:false}).limit(100);if(error)throw error;res.json(data.map(r=>({username:r.discord_user_id,avatar:null,xp:Number(r.xp||0),level:levelFromXp(Number(r.xp||0)).level})))}catch(e){console.error(e);res.status(500).json({error:'server'})}});

app.get('/api/achievements',auth,(req,res)=>res.json([]));
app.get('/api/privacy',auth,(req,res)=>res.json({discord_id:req.user.discord_id,show_balance:1,show_id:0,show_servers:1,show_rank:1,public_profile:0}));
app.post('/api/privacy',auth,(req,res)=>res.status(503).json({error:'write_disabled'}));
app.post('/api/daily',auth,(req,res)=>res.status(503).json({error:'write_disabled'}));
app.post('/api/bank',auth,(req,res)=>res.status(503).json({error:'write_disabled'}));
app.post('/api/transfer',auth,(req,res)=>res.status(503).json({error:'write_disabled'}));
app.post('/api/discord/transfer',(req,res)=>res.status(503).json({error:'write_disabled'}));
app.post('/api/discord/sync',(req,res)=>res.status(503).json({error:'write_disabled'}));

app.listen(process.env.PORT||3000,()=>console.log('ZENTRO Hub running with shared Supabase economy'));