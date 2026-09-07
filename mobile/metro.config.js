// The app lives in mobile/ but shares ../src with the website and the server.
// Metro only bundles files inside watchFolders, so the repo root is added, and
// nodeModulesPaths lets the shared code find packages in this app's node_modules.
// (tsconfig paths are type-only here: app.json sets experiments.tsconfigPaths=false.)
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, '..');
const config = getDefaultConfig(projectRoot);

config.watchFolders = [repoRoot];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, 'node_modules')];

module.exports = config;
