import { getStore } from '@netlify/blobs';

const STORE_NAME = 'assert-student-data-v15-clean';
const TEACHER_CODE = process.env.ASSERT_BK_CODE || 'ASSERT-BK';
const store = () => getStore({ name: STORE_NAME, consistency: 'strong' });
const cors = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type, X-ASSERT-BK-CODE','Access-Control-Allow-Methods':'GET, POST, DELETE, OPTIONS','Content-Type':'application/json; charset=utf-8'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:cors});
const studentKey=player=>`student/${encodeURIComponent(String(player).trim().toLowerCase())}`;
const timeValue=v=>{const t=Date.parse(v||'');return Number.isFinite(t)?t:0};
function mergeEvents(a=[],b=[]){const map=new Map();for(const e of [...(Array.isArray(a)?a:[]),...(Array.isArray(b)?b:[])]){if(!e||typeof e!=='object')continue;const id=String(e.id||`${e.at||''}|${e.mission||''}|${e.type||''}|${e.field||''}|${e.answer||''}`);map.set(id,e)}return [...map.values()].sort((x,y)=>timeValue(x.at)-timeValue(y.at));}
function mergeHistory(a={},b={}){const out={};for(const src of [a,b]){if(!src||typeof src!=='object')continue;for(const [m,list] of Object.entries(src))out[m]=mergeEvents(out[m],list)}return out;}
function mergeRecord(oldRecord,incoming){
 const oldR=oldRecord&&typeof oldRecord==='object'?oldRecord:{};const newR=incoming&&typeof incoming==='object'?incoming:{};
 const oldT=timeValue(oldR.updatedAt),newT=timeValue(newR.updatedAt),newer=newT>=oldT?newR:oldR,older=newer===newR?oldR:newR;
 const merged={...older,...newer};merged.player=String(newR.player||oldR.player||'').trim();merged.key=String(newR.key||oldR.key||merged.player).trim().toLowerCase();
 merged.completedMissions=Array.from(new Set([...(oldR.completedMissions||[]),...(newR.completedMissions||[])].map(Number).filter(Boolean))).sort((a,b)=>a-b);
 merged.interactionLog=mergeEvents(oldR.interactionLog,newR.interactionLog);merged.missionHistory=mergeHistory(oldR.missionHistory,newR.missionHistory);
 const resume=[oldR.resumeState,newR.resumeState].filter(Boolean).sort((a,b)=>timeValue(a.savedAt)-timeValue(b.savedAt));merged.resumeState=resume.length?resume[resume.length-1]:null;
 const drafts=[oldR.draftAnswers,newR.draftAnswers].filter(x=>x&&typeof x==='object');merged.draftAnswers=Object.assign({},...drafts);
 merged.lastMission=Number(newer.lastMission||older.lastMission||0);merged.lastMissionAt=newer.lastMissionAt||older.lastMissionAt||null;merged.updatedAt=new Date(Math.max(oldT,newT,Date.now())).toISOString();
 return merged;
}
export default async req=>{
 if(req.method==='OPTIONS')return new Response('',{status:204,headers:cors});
 try{
  const db=store();
  if(req.method==='POST'){
   const body=await req.json().catch(()=>null),record=body?.record;if(!record||typeof record!=='object'||!String(record.player||'').trim())return json({error:'Invalid record'},400);
   const player=String(record.player).trim(),key=studentKey(player),existing=await db.get(key,{type:'json',consistency:'strong'}).catch(()=>null),merged=mergeRecord(existing,{...record,player,key:player.toLowerCase()});
   await db.setJSON(key,merged);return json({ok:true,player:merged.player,updatedAt:merged.updatedAt});
  }
  if(req.method==='DELETE'){
   const code=req.headers.get('x-assert-bk-code')||'';if(code!==TEACHER_CODE)return json({error:'Unauthorized'},401);
   const body=await req.json().catch(()=>null),player=String(body?.player||'').trim();if(!player)return json({error:'Nama siswa wajib diisi'},400);
   const key=studentKey(player),existing=await db.get(key,{type:'json',consistency:'strong'}).catch(()=>null);if(!existing)return json({error:'Data siswa tidak ditemukan'},404);
   await db.delete(key);const verify=await db.get(key,{type:'json',consistency:'strong'}).catch(()=>null);if(verify)return json({error:'Data siswa masih tersimpan setelah penghapusan'},409);
   return json({ok:true,deleted:player});
  }
  if(req.method==='GET'){
   const code=req.headers.get('x-assert-bk-code')||'';if(code!==TEACHER_CODE)return json({error:'Unauthorized'},401);
   const listed=await db.list({prefix:'student/'});const records=(await Promise.all(listed.blobs.map(b=>db.get(b.key,{type:'json',consistency:'strong'}).catch(()=>null)))).filter(Boolean).sort((a,b)=>timeValue(b.updatedAt)-timeValue(a.updatedAt));
   return json({records});
  }
  return json({error:'Method not allowed'},405);
 }catch(error){console.error('ASSERT DATA FUNCTION ERROR',error);return json({error:'Server error',detail:String(error?.message||error)},500)}
};

