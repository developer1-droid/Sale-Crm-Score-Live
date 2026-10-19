// Dev helper: log in with .env and save one CRM API response to a file.
// Usage: node tools/fetch-crm.mjs "/api/step-feed" feed.json
// (the files engine/selftest.mjs reads with LIVE_DIR are named in its header)
process.env.TZ = 'Asia/Kolkata';
/* The step-feed route rebuilds the SO FMS board on a cold cache (maxDuration 120s). */
const STEP_FEED_PATH = '/api/step-feed';
const STEP_FEED_TIMEOUT_MS = 130_000;
const { default: dotenv } = await import('dotenv');
const path = await import('node:path');
const fs = await import('node:fs');
const { fileURLToPath } = await import('node:url');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env') });
const { createCrmClient } = await import('../lib/crmClient.js');

const [apiPath, outFile] = process.argv.slice(2);
if (!apiPath || !outFile) {
  console.error('Usage: node tools/fetch-crm.mjs "/api/..." out.json   (use "cutoffs" for Firestore cutoffs)');
  process.exit(1);
}
const client = createCrmClient({
  baseUrl: process.env.CRM_BASE_URL.replace(/\/+$/, ''),
  apiKey: process.env.FIREBASE_API_KEY,
  projectId: process.env.FIREBASE_PROJECT_ID,
  email: process.env.CRM_EMAIL,
  password: process.env.CRM_PASSWORD,
});
const timeoutMs = apiPath.startsWith(STEP_FEED_PATH) ? STEP_FEED_TIMEOUT_MS : undefined;
const data = apiPath === 'cutoffs' ? await client.getCutoffDates() : await client.getJson(apiPath, { timeoutMs });
fs.writeFileSync(outFile, JSON.stringify(data));
console.error(`saved ${apiPath} -> ${outFile} (${fs.statSync(outFile).size} bytes)`);
