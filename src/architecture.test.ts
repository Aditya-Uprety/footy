// Enforces the purity rule (PLAN §3.2): shared/, sim/, game/ and
// net/protocol.ts are plain TypeScript that runs in Node. They import only
// other pure modules (no three, peerjs, DOM, or render/ui/app/net code), and
// use no browser globals or real timers (HostCore gets an injected clock).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = dirname(fileURLToPath(import.meta.url));

const PURE_DIRS = ['shared', 'sim', 'game'];
const PURE_FILES = ['net/protocol.ts'];

/** Globals that mean "browser" or "real time". Matched as whole identifiers. */
const BANNED_GLOBALS = [
  'window',
  'document',
  'navigator',
  'location',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'performance',
  'HTMLElement',
  'HTMLCanvasElement',
  'WebSocket',
  'RTCPeerConnection',
  'fetch',
];
/** Banned member accesses (Date itself is fine for formatting; Date.now is a real clock). */
const BANNED_MEMBERS = ['Date.now', 'Math.random'];

function toPosix(p: string): string {
  return p.split(sep).join('/');
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

export function isPurePath(relPath: string): boolean {
  const p = toPosix(relPath);
  return PURE_FILES.includes(p) || PURE_DIRS.some((d) => p.startsWith(`${d}/`));
}

/** Removes comments and string/template contents so identifiers in them don't count. */
export function stripCommentsAndStrings(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      const q = c;
      out += q;
      i++;
      while (i < src.length && src[i] !== q) {
        if (src[i] === '\\') i++;
        i++;
      }
      out += q;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** All module specifiers from static imports, re-exports and dynamic import(). */
export function importSpecifiers(src: string): string[] {
  const specs: string[] = [];
  const re = /(?:^|[\s;])(?:import|export)\s[^'"`;]*?from\s*['"]([^'"]+)['"]|(?:^|[\s;])import\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;
  for (const m of src.matchAll(re)) specs.push((m[1] ?? m[2] ?? m[3])!);
  return specs;
}

export interface Violation {
  file: string;
  problem: string;
}

/** Checks one pure file's source. `relPath` is relative to src/. */
export function checkPureSource(relPath: string, src: string): Violation[] {
  const v: Violation[] = [];
  const isTest = relPath.endsWith('.test.ts');
  for (const spec of importSpecifiers(src)) {
    if (spec.startsWith('.')) {
      const target = toPosix(relative(SRC, resolve(SRC, dirname(relPath), spec)));
      const withExt = target.endsWith('.ts') ? target : `${target}.ts`;
      if (!isPurePath(withExt)) v.push({ file: relPath, problem: `imports non-pure module "${spec}"` });
    } else if (isTest && (spec === 'vitest' || spec.startsWith('node:'))) {
      // Test tooling is allowed in tests.
    } else {
      v.push({ file: relPath, problem: `imports package "${spec}"` });
    }
  }
  const code = stripCommentsAndStrings(src);
  if (!isTest) {
    for (const g of BANNED_GLOBALS) {
      // Whole identifier, not a property (".window") or object key ("window:").
      const re = new RegExp(`(?<![.\\w$])${g}(?![\\w$])(?!\\s*:)`);
      if (re.test(code)) v.push({ file: relPath, problem: `uses global "${g}"` });
    }
    for (const m of BANNED_MEMBERS) {
      const re = new RegExp(`(?<![.\\w$])${m.replace('.', '\\s*\\.\\s*')}(?![\\w$])`);
      if (re.test(code)) v.push({ file: relPath, problem: `uses "${m}"` });
    }
  }
  return v;
}

describe('architecture: purity rule (PLAN §3.2)', () => {
  const pureFiles = walk(SRC)
    .map((f) => toPosix(relative(SRC, f)))
    .filter(isPurePath);

  it('finds the pure layers', () => {
    expect(pureFiles).toContain('shared/pitch.ts');
    expect(pureFiles).toContain('net/protocol.ts');
    expect(pureFiles.some((f) => f.startsWith('sim/'))).toBe(true);
    expect(pureFiles.some((f) => f.startsWith('game/'))).toBe(true);
  });

  it('pure modules import no three/peerjs/DOM code and use no browser globals or timers', () => {
    const violations = pureFiles.flatMap((f) => checkPureSource(f, readFileSync(join(SRC, f), 'utf8')));
    expect(violations).toEqual([]);
  });
});

describe('architecture: the checker itself', () => {
  it('flags three, peerjs and imports from render/ui/app/net', () => {
    const src = [
      "import * as THREE from 'three';",
      "import Peer from 'peerjs';",
      "import { x } from '../render/scene';",
      "export { y } from '../app/router';",
      "import '../ui/styles.css';",
      "const z = await import('../net/peer');",
      "import { ok } from './vec3';",
      "import type { Pitch } from '../shared/pitch';",
      "import { PROTOCOL_VERSION } from '../net/protocol';",
    ].join('\n');
    const problems = checkPureSource('sim/bad.ts', src).map((v) => v.problem);
    expect(problems).toEqual([
      'imports package "three"',
      'imports package "peerjs"',
      'imports non-pure module "../render/scene"',
      'imports non-pure module "../app/router"',
      'imports non-pure module "../ui/styles.css"',
      'imports non-pure module "../net/peer"',
    ]);
  });

  it('flags browser globals and real clocks but ignores comments, strings and properties', () => {
    const bad = 'const w = window.innerWidth; setTimeout(f, 1); const t = Date.now(); const r = Math.random();';
    expect(checkPureSource('game/bad.ts', bad).map((v) => v.problem)).toEqual([
      'uses global "window"',
      'uses global "setTimeout"',
      'uses "Date.now"',
      'uses "Math.random"',
    ]);
    const fine = [
      '// window and document in a comment',
      "const s = 'setTimeout in a string';",
      'const o = { performance: 1 }; o.performance += 1;',
      'const loc = state.location;',
    ].join('\n');
    expect(checkPureSource('game/fine.ts', fine)).toEqual([]);
  });

  it('lets tests use vitest and node: built-ins', () => {
    const src = "import { it } from 'vitest';\nimport { readFileSync } from 'node:fs';";
    expect(checkPureSource('sim/x.test.ts', src)).toEqual([]);
    expect(checkPureSource('sim/x.ts', src).length).toBe(2);
  });
});
