import { getStore } from '@netlify/blobs';

const STORE_NAME = 'assert-student-data-v15-clean';
const TEACHER_CODE = process.env.ASSERT_BK_CODE || 'ASSERT-BK';

const store = () => getStore({ name: STORE_NAME, consistency: 'strong' });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-ASSERT-BK-CODE',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Content-Type': 'application/json; charset=utf-8'
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

function studentKey(player) {
  return `student/${encodeURIComponent(String(player).trim().toLowerCase())}`;
}

function timeValue(v) {
  const t = Date.parse(v || '');
  return Number.isFinite(t) ? t : 0;
}

function mergeRecord(existing, incoming) {
  const oldRecord = existing && typeof existing === 'object' ? existing : {};
  const newRecord = incoming && typeof incoming === 'object' ? incoming : {};
  const oldTime = timeValue(oldRecord.updatedAt);
  const newTime = timeValue(newRecord.updatedAt);
  const newer = newTime >= oldTime ? newRecord : oldRecord;
  const older = newer === newRecord ? oldRecord : newRecord;

  const merged = { ...older, ...newer };
  merged.player = String(newRecord.player || oldRecord.player || '').trim();
  merged.key = String(newRecord.key || oldRecord.key || merged.player).trim().toLowerCase();

  // Never lose a completed mission already stored in the central record.
  merged.completedMissions = Array.from(new Set([
    ...(Array.isArray(oldRecord.completedMissions) ? oldRecord.completedMissions : []),
    ...(Array.isArray(newRecord.completedMissions) ? newRecord.completedMissions : [])
  ])).sort((a, b) => Number(a) - Number(b));

  // Merge interaction events by id so repeated uploads do not duplicate the log.
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
    .slice(-350);

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
      if (!record || typeof record !== 'object' || !String(record.player || '').trim()) {
        return json({ error: 'Invalid record' }, 400);
      }

      const player = String(record.player).trim();
      const key = studentKey(player);
      const existing = await db.get(key, { type: 'json', consistency: 'strong' }).catch(() => null);
      const merged = mergeRecord(existing, { ...record, player, key: player.toLowerCase() });

      await db.setJSON(key, merged);
      return json({ ok: true, player: merged.player, updatedAt: merged.updatedAt });
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

    return json({ error: 'Method not allowed' }, 405);
  } catch (error) {
    console.error('ASSERT DATA FUNCTION ERROR', error);
    return json({ error: 'Server error', detail: String(error?.message || error) }, 500);
  }
};

