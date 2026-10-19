// Builds the TV pages as one plain ES5 script each, so old smart-TV browsers
// (Chromium 38-79 in Samsung Tizen, LG webOS, Android TV) can run them.
// public/js stays the source: modern ES modules, edited without a build step.
// esbuild bundles the modules (+ polyfills), TypeScript lowers the syntax to ES5,
// esbuild minifies. Built once at server start and served from memory.
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import ts from 'typescript';

const require = createRequire(import.meta.url);

/** Published path -> entry module inside public/. */
export const LEGACY_ENTRIES = {
  '/js/app.legacy.js': 'js/app.js',
  '/js/settings.legacy.js': 'js/settingsPage.js',
};

// core-js/stable covers Promise, Symbol, Map/Set, Object.*, Array.*, String.*,
// URLSearchParams and NodeList iteration; whatwg-fetch adds fetch(); domShims.js the DOM methods.
const POLYFILLS = [require.resolve('core-js/stable'), require.resolve('whatwg-fetch'),
  fileURLToPath(new URL('./domShims.js', import.meta.url))];

async function bundleOne(publicDir, entry) {
  const stdin = [...POLYFILLS.map(p => `import ${JSON.stringify(p)};`),
    `import ${JSON.stringify('./' + entry)};`].join('\n');
  const bundled = await esbuild.build({
    stdin: { contents: stdin, resolveDir: publicDir, sourcefile: `${entry}.legacy-entry.js` },
    bundle: true,
    format: 'iife',
    // Lower the newest syntax here (?. ?? object spread); TypeScript does the rest down to ES5.
    target: 'es2017',
    write: false,
    logLevel: 'silent',
  });
  const es5 = ts.transpileModule(bundled.outputFiles[0].text, {
    compilerOptions: {
      target: ts.ScriptTarget.ES5,
      module: ts.ModuleKind.None,
      downlevelIteration: true,
      importHelpers: false,
      removeComments: true,
    },
  }).outputText;
  const min = await esbuild.transform(es5, { target: 'es5', minify: true, legalComments: 'none', logLevel: 'silent' });
  return min.code;
}

/** Returns { '/js/app.legacy.js': code, ... }. Throws when a page fails to build. */
export async function buildLegacy(publicDir) {
  const out = {};
  for (const [url, entry] of Object.entries(LEGACY_ENTRIES)) {
    out[url] = await bundleOne(path.resolve(publicDir), entry);
  }
  return out;
}
