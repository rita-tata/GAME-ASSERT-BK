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

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response('', { status: 204, headers: cors });

  try {
    const db = store();

    if (req.method === 'POST') {
      const body = await req.json().catch(() => null);
      const record = body?.record;
      if (!record || typeof record !== 'object' || !String(record.player || '').trim()) {
        return json({ error: 'Invalid record' }, 400);
      }

      const clean = { ...record };
      clean.player = String(clean.player).trim();
      clean.updatedAt = new Date().toISOString();
      await db.setJSON(studentKey(clean.player), clean);
      return json({ ok: true });
    }

    if (req.method === 'GET') {
      const code = req.headers.get('x-assert-bk-code') || '';
      if (code !== TEACHER_CODE) return json({ error: 'Unauthorized' }, 401);

      const listed = await db.list({ prefix: 'student/' });
      const records = (await Promise.all(
        listed.blobs.map(async (blob) => await db.get(blob.key, { type: 'json', consistency: 'strong' }))
      )).filter(Boolean);

      return json({ records });
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (error) {
    console.error(error);
    return json({ error: 'Server error' }, 500);
  }
};
