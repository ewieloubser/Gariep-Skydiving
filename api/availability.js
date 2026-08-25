// GET /api/availability  ->  { "thu-1000": { capacity, booked }, ... }
// Reads live seat counts from Supabase so the booking page shows what's left.
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY   // server-side only — never ship to the browser
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { data, error } = await supabase.from('slots').select('id, capacity, booked');
  if (error) return res.status(500).json({ error: 'Could not load availability' });

  const map = {};
  for (const s of data) map[s.id] = { capacity: s.capacity, booked: s.booked };
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(map);
}
