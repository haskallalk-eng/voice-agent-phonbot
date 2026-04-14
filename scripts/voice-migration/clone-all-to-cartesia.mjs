// Clones all Retell custom voices (except already-done Hassieb) to Cartesia.
// Downloads preview MP3 from Retell S3, re-uploads via /clone-voice with provider=cartesia.
// Outputs a mapping table at the end.

import fs from 'node:fs';
import path from 'node:path';

const KEY = process.env.RETELL_API_KEY;
if (!KEY) { console.error('RETELL_API_KEY missing'); process.exit(1); }

// Voices to migrate (Hassieb already done separately)
const VOICES = [
  { id: 'custom_voice_01d89196d206bdad5526fb43fa', name: 'Richard Stephan', provider_old: 'platform' },
  { id: 'custom_voice_7cf551c6cee9593dddad5555a5', name: 'hahaha',          provider_old: 'elevenlabs' },
  { id: 'custom_voice_d73b99296e5737d9122d3ed76a', name: 'bruce',           provider_old: 'elevenlabs' },
  { id: 'custom_voice_c6b1d439e4c1304e6177f446fb', name: 'shamil akh',      provider_old: 'elevenlabs' },
  { id: 'custom_voice_b49b95eab59caa3b000d947f03', name: 'mostar',          provider_old: 'elevenlabs' },
  { id: 'custom_voice_977e8cc7595096b72b0175a4bd', name: 'Hansi',           provider_old: 'elevenlabs' },
];

async function downloadMp3(voiceId, outPath) {
  const url = `https://retell-utils-public.s3.us-west-2.amazonaws.com/${voiceId}.mp3`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed ${res.status} for ${voiceId}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(outPath, buf);
  return buf;
}

async function cloneToCartesia(name, buf) {
  const fd = new FormData();
  fd.append('voice_name', `${name}_Cartesia`);
  fd.append('voice_provider', 'cartesia');
  fd.append('files', new Blob([buf], { type: 'audio/mpeg' }), `${name}.mp3`);
  const res = await fetch('https://api.retellai.com/clone-voice', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KEY },
    body: fd,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Clone failed ${res.status}: ${text}`);
  return JSON.parse(text);
}

async function downloadPreview(newVoiceId, outPath) {
  const url = `https://retell-utils-public.s3.us-west-2.amazonaws.com/${newVoiceId}.mp3`;
  // Retell needs a few seconds to generate the preview
  for (let i = 0; i < 10; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        fs.writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
        return true;
      }
    } catch {}
    await new Promise(r => setTimeout(r, 1500));
  }
  return false;
}

const mapping = [];

for (const v of VOICES) {
  process.stdout.write(`\n▸ ${v.name.padEnd(18)} (${v.provider_old})  ...  `);
  try {
    const orig = path.join('originals', `${v.name.replace(/\s+/g,'_')}.mp3`);
    fs.mkdirSync('originals', { recursive: true });
    const buf = await downloadMp3(v.id, orig);
    process.stdout.write(`downloaded (${buf.length}B) → `);
    const cloned = await cloneToCartesia(v.name.replace(/\s+/g,'_'), buf);
    process.stdout.write(`cloned ✓ ${cloned.voice_id}`);
    // Save preview of new voice
    const prevPath = path.join('cartesia-previews', `${v.name.replace(/\s+/g,'_')}_Cartesia.mp3`);
    fs.mkdirSync('cartesia-previews', { recursive: true });
    await downloadPreview(cloned.voice_id, prevPath);
    mapping.push({ old_id: v.id, old_name: v.name, old_provider: v.provider_old, new_id: cloned.voice_id, new_name: cloned.voice_name, new_provider: 'cartesia' });
  } catch (e) {
    console.log(`FAIL: ${e.message}`);
    mapping.push({ old_id: v.id, old_name: v.name, error: e.message });
  }
}

fs.writeFileSync('voice-mapping.json', JSON.stringify(mapping, null, 2));

console.log('\n\n═══════════════ MAPPING ═══════════════');
console.log('OLD_ID'.padEnd(46), '→', 'NEW_ID'.padEnd(46), 'NAME');
mapping.forEach(m => {
  if (m.error) console.log(m.old_id.padEnd(46), '   ', 'ERROR'.padEnd(46), m.old_name, ':', m.error);
  else console.log(m.old_id.padEnd(46), '→', m.new_id.padEnd(46), m.old_name);
});
console.log('\nSaved mapping to voice-mapping.json');
console.log('Previews in cartesia-previews/');
