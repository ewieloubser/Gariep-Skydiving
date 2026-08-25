// ONE-TIME SETUP HELPER — registers your Yoco webhook for you.
//
// Yoco has no dashboard button for webhooks; you must send their API one POST
// request. This page does exactly that. Open it in a browser, type your
// CRON_SECRET, click the button. It calls Yoco using your YOCO_SECRET_KEY
// (already stored server-side) and shows you the signing secret to paste into
// the YOCO_WEBHOOK_SECRET setting in Vercel.
//
// Safe to delete this file after you've got your whsec_ code.

const YOCO_WEBHOOKS_URL = 'https://payments.yoco.com/api/webhooks';

export default async function handler(req, res) {
  const base = (process.env.PUBLIC_SITE_URL || `https://${req.headers.host}`).replace(/\/$/, '');
  const webhookUrl = `${base}/api/yoco-webhook`;

  // GET -> show a tiny setup page
  if (req.method === 'GET') {
    res.setHeader('Content-Type', 'text/html');
    return res.status(200).send(`<!DOCTYPE html><html><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Register Yoco webhook</title>
<style>
 body{font-family:Calibri,Arial,sans-serif;background:#0A1F44;color:#fff;margin:0;min-height:100vh;display:grid;place-items:center}
 .card{background:#fff;color:#12161f;max-width:440px;width:92%;border-radius:14px;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.4)}
 .top{background:#0A1F44;border-bottom:2px solid #C29A2E;padding:18px 22px}
 .top h1{font-size:20px;margin:0;color:#fff}
 .b{padding:22px}
 label{font-weight:bold;font-size:14px;display:block;margin-bottom:6px;color:#0A1F44}
 input{width:100%;padding:11px;border:1.5px solid #ccc;border-radius:8px;font-size:15px;box-sizing:border-box}
 button{margin-top:14px;width:100%;padding:13px;border:none;border-radius:9px;background:#C29A2E;color:#0A1F44;font-weight:bold;font-size:16px;cursor:pointer}
 #out{margin-top:16px;font-size:14px;white-space:pre-wrap;word-break:break-word}
 .ok{background:#eaf7ef;border:1px solid #b7e0c6;padding:12px;border-radius:8px}
 .err{background:#fdecec;border:1px solid #e6b3b3;padding:12px;border-radius:8px}
 code{background:#f3f1eb;padding:2px 5px;border-radius:4px}
</style></head><body>
<div class="card">
 <div class="top"><h1>Register your Yoco webhook</h1></div>
 <div class="b">
  <p style="font-size:14px;color:#5f6b7d;margin-top:0">This will tell Yoco to send payment confirmations to:<br><code>${webhookUrl}</code></p>
  <label>Your CRON_SECRET</label>
  <input id="key" type="password" placeholder="the random text you set in Vercel">
  <button onclick="go()">Register webhook</button>
  <div id="out"></div>
 </div>
</div>
<script>
async function go(){
 const out=document.getElementById('out'); out.className=''; out.textContent='Working…';
 try{
  const r=await fetch('/api/register-webhook',{method:'POST',headers:{'x-setup-key':document.getElementById('key').value}});
  const d=await r.json();
  if(!r.ok){out.className='err';out.textContent=(d.error||'Failed')+(d.detail?'\\n'+d.detail:'');return;}
  out.className='ok';
  out.innerHTML='<b>Done!</b> Copy this signing secret and paste it into the <code>YOCO_WEBHOOK_SECRET</code> setting in Vercel, then redeploy:<br><br><b style="font-size:16px">'+ (d.secret||'(see full response below)') +'</b><br><br><span style="color:#5f6b7d">Full response:</span><br><code>'+JSON.stringify(d.raw)+'</code>';
 }catch(e){out.className='err';out.textContent='Something went wrong. Try again.';}
}
</script></body></html>`);
  }

  // POST -> actually register with Yoco
  if (req.method === 'POST') {
    if (!process.env.CRON_SECRET || req.headers['x-setup-key'] !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Wrong CRON_SECRET.' });
    }
    try {
      const y = await fetch(YOCO_WEBHOOKS_URL, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + process.env.YOCO_SECRET_KEY,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: 'gariep-skydive', url: webhookUrl })
      });
      const raw = await y.json();
      if (!y.ok) return res.status(502).json({ error: 'Yoco rejected the request.', detail: JSON.stringify(raw) });
      // Yoco returns the signing secret as `secret`.
      return res.status(200).json({ secret: raw.secret || null, raw });
    } catch (e) {
      return res.status(500).json({ error: 'Could not reach Yoco. Check YOCO_SECRET_KEY is set.' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
