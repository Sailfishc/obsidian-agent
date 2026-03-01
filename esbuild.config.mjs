import esbuild from 'esbuild';
import process from 'process';
import builtins from 'builtin-modules';
import fs from 'fs';

const prod = process.argv[2] === 'production';

// Post-build fix: esbuild converts import.meta to {} in CJS mode,
// which breaks pi-mono's config.js that uses fileURLToPath(import.meta.url).
// We fix this by patching the output after bundling.
const fixImportMetaPost = {
  name: 'fix-import-meta-post',
  setup(build) {
    build.onEnd((result) => {
      if (result.errors.length > 0) return;

      const outfile = 'main.js';
      let code = fs.readFileSync(outfile, 'utf-8');

      // Replace `var import_meta = {};` pattern with a proper meta object
      // that has a url property pointing to the output file
      code = code.replace(
        /var import_meta\d* = \{\};/g,
        (match) => {
          // Extract the variable name (e.g., import_meta, import_meta2, etc.)
          const varName = match.match(/var (import_meta\d*)/)[1];
          return `var ${varName} = { url: require("url").pathToFileURL(__filename).href };`;
        }
      );

      // Wrap config.js package.json read in try-catch so it doesn't crash
      // when running inside Obsidian's electron.asar environment
      code = code.replace(
        /var pkg = JSON\.parse\(\(0, import_fs\.readFileSync\)\(getPackageJsonPath\(\), "utf-8"\)\);/g,
        'var pkg; try { pkg = JSON.parse((0, import_fs.readFileSync)(getPackageJsonPath(), "utf-8")); } catch(e) { pkg = {}; }'
      );

      // Convert dynamic import("node:xxx") to Promise.resolve(require("xxx"))
      // Obsidian's Electron doesn't support dynamic import() for node: modules
      code = code.replace(
        /import\("node:(\w+)"\)/g,
        'Promise.resolve(require("$1"))'
      );

      // Convert require("node:xxx") to require("xxx")
      // esbuild externalizes node:xxx modules as require("node:xxx") in CJS output,
      // but Obsidian's Electron may not support the node: prefix in require() calls.
      // This handles both simple (node:fs) and subpath (node:fs/promises) patterns.
      code = code.replace(
        /require\("node:([^"]+)"\)/g,
        'require("$1")'
      );

      fs.writeFileSync(outfile, code);
    });
  }
};

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  plugins: [fixImportMetaPost],
  external: [
    'obsidian',
    'electron',
    '@codemirror/autocomplete',
    '@codemirror/collab',
    '@codemirror/commands',
    '@codemirror/language',
    '@codemirror/lint',
    '@codemirror/search',
    '@codemirror/state',
    '@codemirror/view',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/lr',
    ...builtins,
    ...builtins.map(m => `node:${m}`),
  ],
  format: 'cjs',
  target: 'es2018',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  outfile: 'main.js',
  define: {
    'process.env.NODE_ENV': prod ? '"production"' : '"development"',
  },
});

if (prod) {
  await context.rebuild();
  process.exit(0);
} else {
  await context.watch();
}
