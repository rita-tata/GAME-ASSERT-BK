import { getStore } from '@netlify/blobs';

const STORE_NAME = 'assert-student-data-v15-clean';
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
    .sort((a, b) => timeValue(a.at) - timeValue(b.at));

  // Merge the per-mission history independently so no mission's answers are lost.
  const history = {};
  for (const source of [oldRecord.missionHistory, newRecord.missionHistory]) {
    if (!source || typeof source !== 'object') continue;
    for (const [mission, list] of Object.entries(source)) {
      if (!Array.isArray(list)) continue;
      history[mission] = Array.isArray(history[mission]) ? history[mission] : [];
      for (const event of list) {
        if (!event || typeof event !== 'object') continue;
        const id = String(event.id || `${event.at || ''}|${mission}|${event.type || ''}|${event.answer || ''}`);
        if (!history[mission].some(x => String(x?.id || '') === id)) history[mission].push(event);
      }
      history[mission].sort((a, b) => timeValue(a.at) - timeValue(b.at));
    }
  }
  merged.missionHistory = history;

  // Prefer the newest saved resume point. This is separate from completedMissions.
  const resumeCandidates = [oldRecord.resumeState, newRecord.resumeState].filter(Boolean);
  merged.resumeState = resumeCandidates.length ? resumeCandidates[resumeCandidates.length - 1] : null;
  merged.lastMission = Number(newRecord.lastMission || oldRecord.lastMission || 0);
  merged.lastMissionAt = newRecord.lastMissionAt || oldRecord.lastMissionAt || null;

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

    if (req.method === 'DELETE') {
      const code = req.headers.get('x-assert-bk-code') || '';
      if (code !== TEACHER_CODE) return json({ error: 'Unauthorized' }, 401);

      const body = await req.json().catch(() => null);
      const player = String(body?.player || '').trim();
      if (!player) return json({ error: 'Nama siswa wajib diisi' }, 400);

      const key = studentKey(player);
      const existing = await db.get(key, { type: 'json', consistency: 'strong' }).catch(() => null);
      if (!existing) return json({ error: 'Data siswa tidak ditemukan' }, 404);

      await db.delete(key);
      return json({ ok: true, deleted: player });
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

