/**
 * test-net-image.js — end-to-end test of net-chat image generation.
 * Logs in as the guest account, sends a "Net: generate an image of ..."
 * message through the real /api/data/compress endpoint, and prints the
 * assistant reply (which should contain a markdown image link).
 *
 * Run: node scripts/test-net-image.js ["prompt text"]
 */
const BASE = 'http://localhost:5000/api/data';
const prompt = process.argv[2] || 'generate an image of a tiny red dragon reading a book';

(async () => {
  const loginRes = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'guest@gmail.com', password: 'guest' }),
  });
  const login = await loginRes.json();
  if (!login.token) {
    console.error('LOGIN FAILED:', JSON.stringify(login).slice(0, 400));
    process.exit(1);
  }

  console.log('Logged in. Sending net chat message:', prompt);
  const started = Date.now();

  const body = {
    data: JSON.stringify({ text: `Net:${prompt}` }),
    provider: 'bedrock',
    model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
  };

  const res = await fetch(`${BASE}/compress`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${login.token}`,
    },
    body: JSON.stringify(body),
  });

  console.log(`HTTP ${res.status} (${Date.now() - started}ms)`);
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  console.log('=== RESPONSE ===');
  console.log(JSON.stringify(parsed, null, 2).slice(0, 4000));
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
