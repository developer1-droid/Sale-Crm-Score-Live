// Entry point. The CRM scoring maths uses local-time Date parts, so the
// process must run in IST before anything else creates a Date.
process.env.TZ = 'Asia/Kolkata';

await import('./app.js');
