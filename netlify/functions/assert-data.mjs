import { getStore } from '@netlify/blobs';

const STORE_NAME = 'assert-student-data-final-v1';
const TEACHER_CODE = process.env.ASSERT_BK_CODE || 'ASSERT-BK';
const store = () => getStore({ name: STORE_NAME, consistency: 'strong' });
const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, X-ASSERT-BK-CODE','Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS','Content-Type':'application/json; charset=utf-8'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
const timeValue=v=>{const t=Date.parse(v||'');return Number.isFinite(t)?t:0};
const keyFor=id=>`student/${encodeURIComponent(String(id||'').trim())}`;
function contiguous(list){const s=new Set((Array.isArray(list)?list:[]).map(Number).filter(n=>n>=1&&n<=7));const out=[];for(let n=1;n<=7;n++){if(!s.has(n))break;out.push(n)}return out}
function mergeRecord(oldRecord,incoming){
 const old=oldRecord&&typeof oldRecord==='object'?oldRecord:{};const neu=incoming&&typeof incoming==='object'?incoming:{};
 const merged={...old,...neu};merged.studentId=String(neu.studentId||old.studentId||'').trim();merged.player=String(neu.player||old.player||'').trim();merged.character=String(neu.character||old.character||'');merged.key=merged.studentId;
 merged.completedMissions=contiguous([...(old.completedMissions||[]),...(neu.completedMissions||[])]);
 const events=new Map();for(const src of [old.interactionLog,neu.interactionLog])if(Array.isArray(src))for(const e of src){if(!e||typeof e!=='object')continue;events.set(String(e.id||`${e.at}|${e.mission}|${e.type}|${e.answer}`),e)}
 merged.interactionLog=[...events.values()].sort((a,b)=>timeValue(a.at)-timeValue(b.at)).slice(-500);
 merged.updatedAt=new Date(Math.max(timeValue(old.updatedAt),timeValue(neu.updatedAt),Date.now())).toISOString();
 return merged;
}
export default async req=>{
 if(req.method==='OPTIONS')return new Response('',{status:204,headers:cors});
 try{const db=store();
  if(req.method==='POST'){
   const body=await req.json().catch(()=>null),record=body?.record;
   if(!record||typeof record!=='object'||!String(record.studentId||'').trim()||!String(record.player||'').trim())return json({error:'Invalid record'},400);
   const studentId=String(record.studentId).trim();const key=keyFor(studentId);const existing=await db.get(key,{type:'json',consistency:'strong'}).catch(()=>null);const merged=mergeRecord(existing,{...record,studentId});await db.setJSON(key,merged);return json({ok:true,studentId:merged.studentId,updatedAt:merged.updatedAt});
  }
  if(req.method==='GET'){
   const code=req.headers.get('x-assert-bk-code')||'';if(code!==TEACHER_CODE)return json({error:'Unauthorized'},401);
   const listed=await db.list({prefix:'student/'});const records=(await Promise.all(listed.blobs.map(b=>db.get(b.key,{type:'json',consistency:'strong'}).catch(()=>null)))).filter(Boolean);records.sort((a,b)=>timeValue(b.updatedAt)-timeValue(a.updatedAt));return json({records});
  }
  if(req.method==='DELETE'){
   const code=req.headers.get('x-assert-bk-code')||'';if(code!==TEACHER_CODE)return json({error:'Unauthorized'},401);
   const body=await req.json().catch(()=>null),studentId=String(body?.studentId||'').trim();if(!studentId)return json({error:'studentId required'},400);
   const key=keyFor(studentId);const existing=await db.get(key,{type:'json',consistency:'strong'}).catch(()=>null);if(!existing)return json({ok:true,deleted:false,studentId});await db.delete(key);const verify=await db.get(key,{type:'json',consistency:'strong'}).catch(()=>null);return json({ok:!verify,deleted:!verify,studentId});
  }
  return json({error:'Method not allowed'},405);
 }catch(error){console.error('ASSERT DATA FUNCTION ERROR',error);return json({error:'Server error',detail:String(error?.message||error)},500)}
};

