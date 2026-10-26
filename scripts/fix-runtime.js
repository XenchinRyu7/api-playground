import fs from 'node:fs';
import path from 'node:path';

const vcConfigPath = path.resolve('.vercel/output/functions/_render.func/.vc-config.json');
if (fs.existsSync(vcConfigPath)) {
  const config = JSON.parse(fs.readFileSync(vcConfigPath, 'utf8'));
  config.runtime = 'nodejs20.x';
  fs.writeFileSync(vcConfigPath, JSON.stringify(config, null, 2));
  console.log('✓ Successfully patched Vercel function runtime to nodejs20.x');
}
