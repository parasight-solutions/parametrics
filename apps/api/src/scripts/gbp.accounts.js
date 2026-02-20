// apps/api/src/scripts/gbp.accounts.js
import "dotenv/config";
import { getActiveGoogleIntegration, ensureAccessToken } from "../integrations/google.store.js";

if (!process.argv[2]) {
  console.error("Usage: node apps/api/src/scripts/gbp.accounts.js <USER_ID>");
  process.exit(1);
}

const UID = process.argv[2];

function parseJson(text) {
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function callOnce(access_token) {
  const r = await fetch("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", {
    headers: { Authorization: `Bearer ${access_token}` }
  });
  const t = await r.text();
  return { status: r.status, body: parseJson(t) };
}

async function main() {
  const integ = await getActiveGoogleIntegration(UID);
  if (!integ) {
    console.error("no_integration for", UID);
    process.exit(2);
  }
  const { access_token } = await ensureAccessToken(integ);

  // up to 3 tries with jitter if 429
  for (let i = 0; i < 3; i++) {
    const { status, body } = await callOnce(access_token);
    console.log("status:", status);
    console.log(body);
    if (status !== 429) return;
    const delay = 65000 + Math.floor(Math.random() * 8000);
    console.error(`Got 429; backing off for ${Math.ceil(delay/1000)}s...`);
    await sleep(delay);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
