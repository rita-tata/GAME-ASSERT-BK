import { getStore } from '@netlify/blobs';

const STORE_NAME = 'assert-student-data-final-v2';
const TEACHER_CODE = process.env.ASSERT_BK_CODE || 'ASSERT-BK';
const store = () => getStore({ name: STORE_NAME, consistency: 'strong' });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-ASSERT-BK-CODE',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function timeValue(v) {
  const t = Date.parse(v || '');
  return Number.isFinite(t) ? t : 0;
}

function studentKey(studentId) {
  return `student/${encodeURIComponent(String(studentId).trim())}`;
}

function contiguousMissions(list) {
  const set = new Set((Array.isArray(list) ? list : [])
    .map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 7));
  const out = [];
  for (let n = 1; n <= 7; n += 1) {
    if (!set.has(n)) break;
    out.push(n);
  }
  return out;
}

function mergeRecord(existing, incoming) {
  const oldRecord = existing && typeof existing === 'object' ? existing : {};
  const newRecord = incoming && typeof incoming === 'object' ? incoming : {};
  const oldTime = timeValue(oldRecord.updatedAt);
  const newTime = timeValue(newRecord.updatedAt);
  const newer = newTime >= oldTime ? newRecord : oldRecord;
  const older = newer === newRecord ? oldRecord : newRecord;

  const merged = { ...older, ...newer };
  merged.studentId = String(newRecord.studentId || oldRecord.studentId || '').trim();
  merged.player = String(newRecord.player || oldRecord.player || '').trim();
  merged.character = String(newRecord.character || oldRecord.character || '');
  merged.key = merged.studentId;

  // Preserve every completed mission already stored, while keeping the
  // sequential-progress invariant used by the game.
  merged.completedMissions = contiguousMissions([
    ...(Array.isArray(oldRecord.completedMissions) ? oldRecord.completedMissions : []),
    ...(Array.isArray(newRecord.completedMissions) ? newRecord.completedMissions : [])
  ]);

  // Merge interaction events by id so repeated uploads do not duplicate logs.
  const events = new Map();
  for (const source of [oldRecord.interactionLog, newRecord.interactionLog]) {
    if (!Array.isArray(source)) continue;
    for (const event of source) {
      if (!event || typeof event !== 'object') continue;
      const id = String(event.id || `${event.at || ''}|${event.mission || ''}|${event.type || ''}|${event.answer || ''}`);
      events.set(id, event);
    }
  }
  merged.interactionLog = [...events.values()]
    .sort((a, b) => timeValue(a.at) - timeValue(b.at))
    .slice(-500);

  // Draft answers are merged field-by-field so a newer partial answer is not
  // lost when another request contains older or unrelated fields.
  const oldDrafts = oldRecord.draftAnswers && typeof oldRecord.draftAnswers === 'object' ? oldRecord.draftAnswers : {};
  const newDrafts = newRecord.draftAnswers && typeof newRecord.draftAnswers === 'object' ? newRecord.draftAnswers : {};
  merged.draftAnswers = { ...oldDrafts };
  for (const [field, value] of Object.entries(newDrafts)) {
    const oldValue = merged.draftAnswers[field];
    if (!oldValue || timeValue(value?.updatedAt) >= timeValue(oldValue?.updatedAt)) {
      merged.draftAnswers[field] = value;
    }
  }

  merged.updatedAt = new Date(Math.max(oldTime, newTime, Date.now())).toISOString();
  return merged;
}

export default async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: cors });
  }

  try {
    const db = store();

    if (req.method === 'POST') {
      const body = await req.json().catch(() => null);
      const record = body?.record;
      const studentId = String(record?.studentId || '').trim();
      const player = String(record?.player || '').trim();
      if (!record || typeof record !== 'object' || !studentId || !player) {
        return json({ error: 'Invalid record' }, 400);
      }

      const key = studentKey(studentId);
      const existing = await db.get(key, { type: 'json', consistency: 'strong' }).catch(() => null);
      const merged = mergeRecord(existing, { ...record, studentId, player, key });
      await db.setJSON(key, merged);
      return json({ ok: true, studentId: merged.studentId, updatedAt: merged.updatedAt });
    }

    if (req.method === 'GET') {
      const code = req.headers.get('x-assert-bk-code') || '';
      if (code !== TEACHER_CODE) return json({ error: 'Unauthorized' }, 401);

      const listed = await db.list({ prefix: 'student/' });
      const records = (await Promise.all(
        listed.blobs.map(async (blob) => {
          return await db.get(blob.key, { type: 'json', consistency: 'strong' }).catch(() => null);
        })
      )).filter(Boolean);

      records.sort((a, b) => timeValue(b.updatedAt) - timeValue(a.updatedAt));
      return json({ records });
    }

    if (req.method === 'DELETE') {
      const code = req.headers.get('x-assert-bk-code') || '';
      if (code !== TEACHER_CODE) return json({ error: 'Unauthorized' }, 401);

      const body = await req.json().catch(() => null);
      const studentId = String(body?.studentId || '').trim();
      if (!studentId) return json({ error: 'studentId required' }, 400);

      const key = studentKey(studentId);
      const existing = await db.get(key, { type: 'json', consistency: 'strong' }).catch(() => null);
      if (!existing) return json({ ok: true, deleted: false, studentId });

      await db.delete(key);
      const verify = await db.get(key, { type: 'json', consistency: 'strong' }).catch(() => null);
      return json({ ok: !verify, deleted: !verify, studentId });
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (error) {
    console.error('ASSERT DATA FUNCTION ERROR', error);
    return json({ error: 'Server error', detail: String(error?.message || error) }, 500);
  }
};

