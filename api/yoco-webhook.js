// POST /api/yoco-webhook
// Yoco calls this after a payment. On success we mark the booking paid (seat stays
// held); on failure/expiry we release the seat. Register this URL in your Yoco
// dashboard and put the signing secret in YOCO_WEBHOOK_SECRET.
//
// ⚠ VERIFY AGAINST https://developer.yoco.com : Yoco signs webhooks using the Svix
// scheme (headers webhook-id / webhook-timestamp / webhook-signature; signed content
// = `${id}.${timestamp}.${rawBody}`, HMAC-SHA256 with the base64 secret after the
// `whsec_` prefix). Confirm header names and event `type` strings before go-live.

import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

export const config = { api: { bodyParser: false } }; // need the raw body for the signature

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => (data += c));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function verify(raw, headers) {
  const secret = process.env.YOCO_WEBHOOK_SECRET || '';
  const id = headers['webhook-id'], ts = headers['webhook-timestamp'], sigHeader = headers['webhook-signature'];
  if (!id || !ts || !sigHeader) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = crypto.createHmac('sha256', key).update(`${id}.${ts}.${raw}`).digest('base64');
  return sigHeader.split(' ').some(part => {
    const sig = part.includes(',') ? part.split(',')[1] : part;
    try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)); } catch { return false; }
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const raw = await readRaw(req);
  if (!verify(raw, req.headers)) return res.status(401).json({ error: 'Bad signature' });

  let event;
  try { event = JSON.parse(raw); } catch { return res.status(400).end(); }

  const type = event.type || event.event;
  const meta = event?.payload?.metadata || event?.metadata || {};
  const ref = meta.ref;
  if (!ref) return res.status(200).json({ ok: true });

  const { data: booking } = await supabase.from('bookings').select('*').eq('ref', ref).single();
  if (!booking || booking.status === 'paid') return res.status(200).json({ ok: true }); // idempotent

  if (type === 'payment.succeeded') {
    await supabase.from('bookings').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('ref', ref);
    // (Optional) trigger a confirmation email here.
  } else if (type === 'payment.failed' || type === 'payment.cancelled' || type === 'checkout.expired') {
    await supabase.rpc('release_seats', { p_slot: booking.slot_id, p_qty: booking.jumpers });
    await supabase.from('bookings').update({ status: 'failed' }).eq('ref', ref);
  }

  return res.status(200).json({ ok: true });
}
