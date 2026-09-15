const express=require("express");
const bcrypt=require("bcryptjs");
const {getDb}=require("../config/firebase");
const {ok,fail,authMiddleware,requirePermission}=require("../middleware/auth");
const {userListLimiter}=require("../middleware/rateLimit");
const router=express.Router();
const PERMS=["dashboard","send_notification","history","users","categories","matches","settings","payment-config","deposits","withdrawals","staff"];
function validEmail(e){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e||"").trim());}
function cleanPerms(p){ if(!Array.isArray(p)) return []; return [...new Set(p.map(x=>String(x).trim().toLowerCase()).filter(x=>PERMS.includes(x)))]; }
router.get("/",authMiddleware,requirePermission("staff"),userListLimiter,async(req,res)=>{
 try{
  const snap=await getDb().collection("staffs").get();
  const list=snap.docs.map(d=>{const v=d.data()||{};return{id:d.id,email:v.email,permissions:v.permissions||[],createdAt:v.createdAt||""};});
  return ok(res,{staffs:list},"");
 }catch(e){return fail(res,500,"Failed to load staffs");}
});
router.post("/",authMiddleware,requirePermission("staff"),async(req,res)=>{
 try{
  const email=String((req.body&&req.body.email)||"").trim().toLowerCase();
  const password=String((req.body&&req.body.password)||"");
  const perms=cleanPerms((req.body&&req.body.permissions)||[]);
  if(!validEmail(email)) return fail(res,400,"Valid email required");
  if(password.length<6||password.length>64) return fail(res,400,"Password 6-64 chars");
  const db=getDb();
  const ex=await db.collection("staffs").where("email","==",email).limit(1).get();
  if(!ex.empty) return fail(res,409,"Staff already exists");
  const hash=await bcrypt.hash(password,10);
  const ref=db.collection("staffs").doc();
  await ref.set({email,passwordHash:hash,permissions:perms,createdAt:new Date().toISOString(),createdBy:req.admin.email||""});
  return ok(res,{id:ref.id,email,permissions:perms},"Staff created");
 }catch(e){return fail(res,500,"Failed to create staff");}
});
router.put("/:id",authMiddleware,requirePermission("staff"),async(req,res)=>{
 try{
  const id=String(req.params.id||"").trim();
  const db=getDb();
  const snap=await db.collection("staffs").doc(id).get();
  if(!snap.exists) return fail(res,404,"Staff not found");
  const upd={};
  if(req.body.permissions!==undefined) upd.permissions=cleanPerms(req.body.permissions);
  if(req.body.password){const pw=String(req.body.password); if(pw.length<6||pw.length>64) return fail(res,400,"Password 6-64 chars"); upd.passwordHash=await bcrypt.hash(pw,10);}
  if(!Object.keys(upd).length) return fail(res,400,"No fields");
  upd.updatedAt=new Date().toISOString();
  await db.collection("staffs").doc(id).update(upd);
  return ok(res,{}, "Updated");
 }catch(e){return fail(res,500,"Failed to update");}
});
router.delete("/:id",authMiddleware,requirePermission("staff"),async(req,res)=>{
 try{
  const id=String(req.params.id||"").trim();
  const db=getDb();
  const snap=await db.collection("staffs").doc(id).get();
  if(!snap.exists) return fail(res,404,"Staff not found");
  await db.collection("staffs").doc(id).delete();
  return ok(res,{},"Deleted");
 }catch(e){return fail(res,500,"Failed to delete");}
});
module.exports=router;
