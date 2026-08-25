// GET /api/booking?ref=GFI-THU-XXXX
// Returns the details needed for the on-screen printable confirmation.
// Only returns a booking once it is 'paid', so the confirmation can't be faked
// by guessing a ref before payment. No sensitive fields beyond what the customer
// already entered are exposed.
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const ref = (req.query && req.query.ref) || '';
  if (!ref) return res.status(400).json({ error: 'Missing ref' });

  const { data: b } = await supabase.from('bookings').select('*').eq('ref', ref).single();
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  if (b.status !== 'paid') return res.status(202).json({ status: b.status }); // not confirmed yet

  const { data: slot } = await supabase.from('slots').select('*').eq('id', b.slot_id).single();

  return res.status(200).json({
    ref: b.ref,
    status: b.status,
    jumpers: b.jumpers,
    payType: b.pay_type,
    amountPaid: b.amount_due_cents / 100,
    amountTotal: b.amount_total_cents / 100,
    balance: (b.amount_total_cents - b.amount_due_cents) / 100,
    contact: b.contact,
    pax: b.pax,
    day: slot ? slot.day_label : '',
    window: slot ? `${slot.window_start}–${slot.window_end}` : '',
    arriveBy: slot ? slot.arrive_by : ''
  });
}
