/** Obsidian loads one file: main.js beside manifest.json. Everything it provides stays external. */
import builtins from 'builtin-modules';
import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: ['main.ts'],
  bundle: true,
  external: ['obsidian', 'electron', ...builtins],
  format: 'cjs',
  target: 'es2022',
  logLevel: 'info',
  sourcemap: watch ? 'inline' : false,
  treeShaking: true,
  outfile: 'main.js',
});

if (watch) await ctx.watch();
else {
  await ctx.rebuild();
  await ctx.dispose();
}
