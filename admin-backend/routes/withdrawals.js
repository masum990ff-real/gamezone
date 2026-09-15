const express = require("express");
const { FieldValue } = require("firebase-admin/firestore");
const { getDb, friendlyFirestoreError } = require("../config/firebase");
const { ok, fail, authMiddleware, requirePermission, firebaseAuthMiddleware } = require("../middleware/auth");
const { payLimiter, withdrawLimiter } = require("../middleware/rateLimit");
const router = express.Router();
const ALLOWED_AMOUNTS = [50,60,70,80,100,150,200,250,500];
const ALLOWED_METHODS = ["Paytm","PhonePe","GooglePe"];
function validateUpi(v){ const t=String(v||"").trim(); if(t.length<5||t.length>50) return null; if(!/^[\w.\-]{2,}@[a-zA-Z0-9.\-]{2,}$/.test(t)) return null; return t; }
router.post("/", firebaseAuthMiddleware, payLimiter, async (req,res)=>{
 try{
  const uid=req.user.uid;
  const amount=Number(req.body && req.body.amount);
  const method=String(req.body && req.body.method||"").trim();
  const upiId=validateUpi(req.body && req.body.upiId);
  if(!ALLOWED_AMOUNTS.includes(amount)) return fail(res,400,"Invalid amount. Allowed: "+ALLOWED_AMOUNTS.join(","));
  if(!ALLOWED_METHODS.includes(method)) return fail(res,400,"Method must be Paytm/PhonePe/GooglePe");
  if(!upiId) return fail(res,400,"Valid UPI ID required (e.g. name@paytm)");
  const db=getDb();
  const uref=db.collection("users").doc(uid);
  const snap=await uref.get();
  if(!snap.exists) return fail(res,404,"User not found");
  const u=snap.data()||{};
  if(u.banned) return fail(res,403,"Account banned");
  const win=Number(u.winCoins||0);
  if(win < amount) return fail(res,402,"Insufficient Win Balance");
  const now=new Date().toISOString();
  let withdrawId="";
  await db.runTransaction(async t=>{
   const s=await t.get(uref);
   if(!s.exists) throw new Error("User not found");
   const d=s.data()||{};
   const curWin=Number(d.winCoins||0);
   if(curWin < amount) throw new Error("INSUFFICIENT");
   t.update(uref,{winCoins:curWin - amount});
   const wref=db.collection("withdrawals").doc();
   withdrawId=wref.id;
   t.set(wref,{uid,username:d.username||"",email:d.email||"",phone:d.phone||"",amount,method,upiId,status:"pending",createdAt:now,updatedAt:now});
   const wh=db.collection("wallet_history").doc();
   t.set(wh,{uid,withdrawId,matchId:"",type:"withdraw",amount,method,upiId,status:"pending",createdAt:now});
  });
  return ok(res,{withdrawId,amount,method,upiId,status:"pending"},"Withdraw request submitted");
 }catch(e){
  if(e.message==="INSUFFICIENT") return fail(res,402,"Insufficient Win Balance");
  console.error("Withdraw create failed:",e.message);
  return fail(res,500,"Failed to create withdraw: "+friendlyFirestoreError(e));
 }
});
router.get("/my", firebaseAuthMiddleware, async (req,res)=>{
 try{
  const uid=req.user.uid;
  const db=getDb();
  const snap=await db.collection("withdrawals").where("uid","==",uid).limit(50).get();
  const items=snap.docs.map(d=>({id:d.id,...d.data()}));
  items.sort((a,b)=>String(b.createdAt||"").localeCompare(String(a.createdAt||"")));
  return ok(res,{items},"");
 }catch(e){ return fail(res,500,"Failed");}
});
router.get("/", authMiddleware, requirePermission("withdrawals"), withdrawLimiter, async (req,res)=>{
 try{
  const page=Math.max(1,parseInt(req.query.page)||1);
  const limit=Math.min(50,Math.max(1,parseInt(req.query.limit)||20));
  const status=String(req.query.status||"").trim().toLowerCase();
  const db=getDb();
  let q=db.collection("withdrawals").orderBy("createdAt","desc");
  if(status) q=q.where("status","==",status);
  const totalSnap=await db.collection("withdrawals").count().get();
  const total=totalSnap.data().count;
  const snap=await q.limit(limit).offset((page-1)*limit).get();
  const items=snap.docs.map(d=>({id:d.id,...d.data()}));
  return ok(res,{items,page,limit,total,totalPages:Math.ceil(total/limit)},"");
 }catch(e){ console.error("Withdraw list failed:",e.message); return fail(res,500,"Failed");}
});
router.put("/:id/status", authMiddleware, requirePermission("withdrawals"), withdrawLimiter, async (req,res)=>{
 try{
  const id=String(req.params.id||"").trim();
  const action=String(req.body && req.body.action||"").trim().toLowerCase();
  if(!["approve","success","reject","failed"].includes(action)) return fail(res,400,"action must be approve or reject");
  const db=getDb();
  const wref=db.collection("withdrawals").doc(id);
  const snap=await wref.get();
  if(!snap.exists) return fail(res,404,"Withdraw not found");
  const w=snap.data()||{};
  if(String(w.status)!=="pending") return fail(res,400,"Already processed: "+w.status);
  const uid=w.uid;
  const now=new Date().toISOString();
  if(action==="approve"||action==="success"){
   await wref.update({status:"success",updatedAt:now});
   const whSnap=await db.collection("wallet_history").where("withdrawId","==",id).limit(1).get();
   if(!whSnap.empty){ await whSnap.docs[0].ref.update({status:"success",updatedAt:now}); }
   return ok(res,{status:"success"},"Approved");
  } else {
   const amount=Number(w.amount||0);
   await db.runTransaction(async t=>{
    const usnap=await t.get(db.collection("users").doc(uid));
    if(usnap.exists){
     const d=usnap.data()||{};
     t.update(db.collection("users").doc(uid),{winCoins:Number(d.winCoins||0)+amount});
    }
    t.update(wref,{status:"rejected",updatedAt:now});
   });
   const whSnap2=await db.collection("wallet_history").where("withdrawId","==",id).limit(1).get();
   if(!whSnap2.empty){ await whSnap2.docs[0].ref.update({status:"rejected",updatedAt:now}); }
   else {
    await db.collection("wallet_history").doc().set({uid,withdrawId:id,type:"refund",amount,reason:"withdraw rejected",createdAt:now});
   }
   return ok(res,{status:"rejected"},"Rejected and refunded");
  }
 }catch(e){ console.error("Withdraw status failed:",e.message); return fail(res,500,"Failed");}
});
module.exports=router;