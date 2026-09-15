const express=require("express");
const {getDb,friendlyFirestoreError}=require("../config/firebase");
const {ok,fail}=require("../middleware/auth");
const {catLimiter}=require("../middleware/rateLimit");
const router=express.Router();
router.get("/",catLimiter,async(req,res)=>{
 try{
  const period=String(req.query.period||"fulltime").toLowerCase();
  const limit=Math.min(10,Math.max(1,parseInt(req.query.limit)||10));
  const db=getDb();
  if(period==="fulltime"){
   const snap=await db.collection("users").orderBy("lifetimeWin","desc").limit(limit).get();
   const items=snap.docs.map((d,i)=>({rank:i+1,uid:d.id,username:d.data().username||"",win: Number(d.data().lifetimeWin||0),winCoins:Number(d.data().winCoins||0)}));
   return ok(res,{items,period},"");
  }
  let days=7;
  if(period==="monthly") days=30;
  else if(period==="weekly") days=7;
  else if(period!=="fulltime") return fail(res,400,"period must be weekly/monthly/fulltime");
  const cutoff=new Date(Date.now()-days*24*60*60*1000).toISOString();
  const snap=await db.collection("wallet_history").where("type","==","winning").where("createdAt",">=",cutoff).limit(500).get();
  const map={};
  snap.docs.forEach(d=>{
   const v=d.data()||{};
   const uid=String(v.uid||"");
   if(!uid) return;
   const amt=Number(v.amount||0);
   map[uid]=(map[uid]||0)+amt;
  });
  let sorted=Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,limit);
  if(sorted.length===0){
   const fallback=await db.collection("users").orderBy("lifetimeWin","desc").limit(limit).get();
   const items=fallback.docs.map((d,i)=>({rank:i+1,uid:d.id,username:d.data().username||"",win:Number(d.data().lifetimeWin||0),periodAmount:0}));
   return ok(res,{items,period},"");
  }
  const uids=sorted.map(x=>x[0]);
  const snaps=await Promise.all(uids.map(uid=>db.collection("users").doc(uid).get().catch(()=>null)));
  const nameMap={};
  snaps.forEach(s=>{ if(s&&s.exists) nameMap[s.id]=s.data().username||""; });
  const items=sorted.map(([uid, amt],i)=>({rank:i+1,uid,username:nameMap[uid]||uid.slice(0,6),win:amt,periodAmount:amt}));
  return ok(res,{items,period},"");
 }catch(e){ console.error("Leaderboard failed:",e.message); return fail(res,500,"Failed: "+friendlyFirestoreError(e)); }
});
module.exports=router;
