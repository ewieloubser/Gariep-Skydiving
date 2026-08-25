// GET/POST /api/release-expired
// Frees seats from 'pending' bookings whose hold has expired. Schedule this every
// few minutes (Vercel Cron). Protect it with CRON_SECRET.
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  if (process.env.CRON_SECRET && req.headers['x-cron-secret'] !== process.env.CRON_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const { data, error } = await supabase.rpc('expire_stale_holds');
  if (error) return res.status(500).json({ error: 'Cleanup failed' });
  return res.status(200).json({ released: data });
}
