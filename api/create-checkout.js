// POST /api/create-checkout
// Body: { slotId, jumpers, payType, contact:{name,email,phone}, pax:[...] }
// -> holds seat(s) atomically in Supabase, creates a Yoco checkout, returns { redirectUrl, ref }
//
// SECURITY: price is computed HERE from the slot, never trusted from the client.
// The Yoco secret key stays server-side. Seats are held via an atomic DB function
// so two people can't take the last seat at once.
//
// ⚠ VERIFY THE YOCO API against https://developer.yoco.com before go-live — confirm
// the checkout endpoint, request shape and auth header match the current spec.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const PRICE_CENTS  = 489000;   // R4 890 per tandem jump, in cents
const DEPOSIT_PCT  = 0.50;
const HOLD_MINUTES = 2;
const YOCO_CHECKOUTS_URL = 'https://payments.yoco.com/api/checkouts';

function makeRef(dayPrefix) {
  return 'GFI-' + dayPrefix.toUpperCase() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { slotId, jumpers, payType, contact, pax } = req.body || {};

    // --- validate ---
    if (!slotId || ![1, 2].includes(jumpers)) return res.status(400).json({ error: 'Invalid booking.' });
    if (!['full', 'deposit'].includes(payType)) return res.status(400).json({ error: 'Invalid payment type.' });
    if (!contact?.name || !contact?.email || !contact?.phone) return res.status(400).json({ error: 'Missing contact details.' });
    if (!Array.isArray(pax) || pax.length !== jumpers) return res.status(400).json({ error: 'Jumper details incomplete.' });
    for (const p of pax) {
      if (!p.name || !p.age || !p.weight) return res.status(400).json({ error: 'Each jumper needs a name, age and weight confirmation.' });
      if (p.age === 'under') return res.status(400).json({ error: 'Minimum age is 14.' });
      if (p.age === 'minor' && (!p.gname || !p.gconsent)) return res.status(400).json({ error: 'Guardian name and consent are required for minors.' });
    }

    // --- look up the slot (price + label source of truth) ---
    const { data: slot, error: slotErr } = await supabase.from('slots').select('*').eq('id', slotId).single();
    if (slotErr || !slot) return res.status(404).json({ error: 'That window no longer exists.' });

    // --- compute price server-side ---
    const totalCents = PRICE_CENTS * jumpers;
    const dueCents   = payType === 'deposit' ? Math.round(totalCents * DEPOSIT_PCT) : totalCents;

    // --- atomically hold seat(s) ---
    const { data: held, error: holdErr } = await supabase.rpc('hold_seats', { p_slot: slotId, p_qty: jumpers });
    if (holdErr) return res.status(500).json({ error: 'Could not hold your seat.' });
    if (held !== true) return res.status(409).json({ error: 'That window just sold out. Please choose another.' });

    const ref = makeRef(slotId.split('-')[0]);
    // Use SITE_URL if set, otherwise derive the address from the request itself.
    const base = (process.env.SITE_URL || `https://${req.headers['x-forwarded-host'] || req.headers.host}`).replace(/\/$/, '');

    // --- create the Yoco checkout ---
    let checkout;
    try {
      const yocoRes = await fetch(YOCO_CHECKOUTS_URL, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + process.env.YOCO_SECRET_KEY,   // sk_live_... / sk_test_...
          'Content-Type': 'application/json',
          'Idempotency-Key': ref
        },
        body: JSON.stringify({
          amount: dueCents,
          currency: 'ZAR',
          successUrl: `${base}/booking.html?status=success&ref=${ref}`,
          cancelUrl:  `${base}/booking.html?status=cancelled&ref=${ref}`,
          failureUrl: `${base}/booking.html?status=failed&ref=${ref}`,
          metadata: {
            ref, slotId, jumpers: String(jumpers), payType,
            window: `${slot.day_label} ${slot.window_start}-${slot.window_end}`
          }
        })
      });
      const rawText = await yocoRes.text();
      let parsed = {};
      try { parsed = JSON.parse(rawText); } catch (_) {}
      if (!yocoRes.ok || !(parsed.redirectUrl || parsed.redirect_url)) {
        // Surface Yoco's actual reply into the Vercel logs so we can see the reason.
        console.error('YOCO CHECKOUT FAILED — HTTP', yocoRes.status, '— body:', rawText);
        await supabase.rpc('release_seats', { p_slot: slotId, p_qty: jumpers });
        return res.status(502).json({ error: 'Payment provider unavailable. Please try again.', yocoStatus: yocoRes.status, yocoBody: rawText });
      }
      checkout = parsed;
    } catch (e) {
      console.error('YOCO CHECKOUT THREW:', e && e.message);
      await supabase.rpc('release_seats', { p_slot: slotId, p_qty: jumpers }); // give the seat back
      return res.status(502).json({ error: 'Payment provider unavailable. Please try again.', detail: String(e && e.message) });
    }

    // --- record the pending booking ---
    const holdExpires = new Date(Date.now() + HOLD_MINUTES * 60000).toISOString();
    await supabase.from('bookings').insert({
      ref, slot_id: slotId, jumpers, pay_type: payType,
      amount_total_cents: totalCents, amount_due_cents: dueCents,
      status: 'pending', contact, pax,
      yoco_checkout_id: checkout.id || null, hold_expires_at: holdExpires
    });

    return res.status(200).json({ ref, redirectUrl: checkout.redirectUrl || checkout.redirect_url });

  } catch (e) {
    return res.status(500).json({ error: 'Unexpected error. Please try again.' });
  }
}
