/**
 * Netlify Scheduled Function — Backend Keep-Warm
 *
 * Pings the Render backend health endpoint every 14 minutes to prevent
 * cold starts on the free tier. Render spins down after 15 minutes of
 * inactivity, so 14-minute intervals keep the instance perpetually warm.
 *
 * Schedule: Runs at minute 0 and 14, 28, 42, 56 of every hour (≈ every 14 min).
 */

export default async (req) => {
  const BACKEND_URL = 'https://mern-plan-web-service.onrender.com/health';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(BACKEND_URL, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeout);

    const body = await res.json().catch(() => ({}));

    console.log(`[keep-warm] ${res.status} — uptime: ${body.uptime ?? '?'}s`);

    return new Response(
      JSON.stringify({ status: res.status, uptime: body.uptime }),
      { headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error(`[keep-warm] Failed: ${err.message}`);
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 502, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

// ── Netlify schedule config (cron) ───────────────────────────
export const config = {
  schedule: '*/14 * * * *',   // every 14 minutes
};
