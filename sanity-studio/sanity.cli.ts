import path from 'node:path';
import { defineCliConfig } from 'sanity/cli';

// One .env at the repo root serves every project here; the studio keeps none of its own.
// Missing in CI or a fresh clone, where the ambient environment already carries the values.
try {
  process.loadEnvFile(path.resolve(process.cwd(), '../.env'));
} catch {
  // No root .env - fall through to whatever the environment already holds.
}

export default defineCliConfig({
  api: {
    projectId: '8775uk5l',
    dataset: 'production',
  },
  // Ties `sanity deploy` to the existing studio at vault-marketplace-obsidian.sanity.studio
  // instead of creating a second application. Without it the CLI asks which app to deploy to.
  deployment: {
    appId: process.env.SANITY_APPID,//c4rwnnkj5wup6exldozv9aif
  },
});
