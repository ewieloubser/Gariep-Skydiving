// GET /api/availability  ->  { "thu-1000": { capacity, booked }, ... }
// Reads live seat counts from Supabase so the booking page shows what's left.
//
// It ALSO frees any expired holds first. The booking page calls this on load and
// every ~25 seconds, so seats from abandoned/failed checkouts repopulate on their
// own within the poll cycle — no scheduled cron required (Vercel's free plan only
// runs crons ~once a day, which is why relying on the schedule alone didn't work).
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Lazily release seats whose hold has expired, before reporting availability.
  try { await supabase.rpc('expire_stale_holds'); } catch (e) { /* still return counts */ }

  const { data, error } = await supabase.from('slots').select('id, capacity, booked');
  if (error) return res.status(500).json({ error: 'Could not load availability' });

  const map = {};
  for (const s of data) map[s.id] = { capacity: s.capacity, booked: s.booked };
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json(map);
}
