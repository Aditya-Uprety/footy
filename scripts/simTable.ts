// Physics tuning report (PLAN M2.6). Run with `npm run sim:table`.
// Prints carry / apex / total / time for power × loft on an empty plane,
// then the §5.10 targets with their test ranges.

import { kickStats, lateralAt, type KickStats } from '../src/sim/analyze';
import { PHYS } from '../src/sim/constants';
import { kickoffSpot, kickSpeed } from '../src/sim/kick';
import { simulateKick } from '../src/sim/simulate';
import type { KickResult } from '../src/sim/types';

const DEG = Math.PI / 180;
const POWERS = [25, 50, 75, 100];
const LOFTS = [0, 10, 15, 25, 35, 45, 55];

function kick(powerPct: number, loftDeg: number, curvePct = 0): KickResult {
  return simulateKick({
    input: { yaw: 0, power: powerPct / 100, curve: curvePct / 100, loft: (loftDeg * DEG) / PHYS.LOFT_MAX },
    origin: { kind: 'ghost', ...kickoffSpot() },
    team: 0,
  });
}

const f1 = (v: number) => v.toFixed(1);
const pad = (s: string, n: number) => s.padStart(n);

function table(): string[] {
  const out: string[] = [];
  out.push('Empty plane, yaw 0, no curve. carry = to first bounce; apex = max ball-center height; total = to stop.');
  out.push('');
  out.push(`${pad('power', 6)} ${pad('v0', 6)} ${pad('loft', 5)} │ ${pad('carry m', 8)} ${pad('apex m', 7)} ${pad('total m', 8)} ${pad('time s', 7)}`);
  out.push(`${'─'.repeat(20)}┼${'─'.repeat(34)}`);
  for (const p of POWERS) {
    for (const l of LOFTS) {
      const s = kickStats(kick(p, l));
      out.push(
        `${pad(`${p} %`, 6)} ${pad(f1(kickSpeed(p / 100)), 6)} ${pad(`${l}°`, 5)} │ ${pad(f1(s.carry), 8)} ${pad(f1(s.apex), 7)} ${pad(f1(s.total), 8)} ${pad(f1(s.time), 7)}`,
      );
    }
    out.push(`${'─'.repeat(20)}┼${'─'.repeat(34)}`);
  }
  return out;
}

interface Target {
  label: string;
  plan: string;
  value: (r: KickResult, s: KickStats) => { text: string; ok: boolean };
  run: () => KickResult;
}

const within = (v: number, lo: number, hi: number) => v >= lo && v <= hi;

function range(name: string, v: number, lo: number, hi: number): { text: string; ok: boolean } {
  return { text: `${name} ${f1(v)} (${lo}–${hi})`, ok: within(v, lo, hi) };
}

function both(a: { text: string; ok: boolean }, b: { text: string; ok: boolean }) {
  return { text: `${a.text}, ${b.text}`, ok: a.ok && b.ok };
}

const TARGETS: Target[] = [
  { label: 'P25 L0 (pass)', plan: '17 m (M17)', run: () => kick(25, 0), value: (_, s) => range('total', s.total, 15, 20) },
  { label: 'P50 L0', plan: '37 m (M17)', run: () => kick(50, 0), value: (_, s) => range('total', s.total, 32, 41) },
  { label: 'P100 L0', plan: '70 m (M17)', run: () => kick(100, 0), value: (_, s) => range('total', s.total, 62, 77) },
  {
    label: 'P100 L15',
    plan: 'carry 36, apex 3.0',
    run: () => kick(100, 15),
    value: (_, s) => both(range('carry', s.carry, 31, 41), range('apex', s.apex, 2.5, 3.6)),
  },
  {
    label: 'P100 L35',
    plan: 'carry 53, apex 12',
    run: () => kick(100, 35),
    value: (_, s) => both(range('carry', s.carry, 48, 58), range('apex', s.apex, 10, 14)),
  },
  {
    label: 'P30 L45 (chip)',
    plan: 'carry 12, apex 3.3',
    run: () => kick(30, 45),
    value: (_, s) => both(range('carry', s.carry, 10.5, 14), range('apex', s.apex, 2.9, 3.8)),
  },
  {
    label: 'P75 C+100 L10',
    plan: '4.1 m right @25 m',
    run: () => kick(75, 10, 100),
    value: (r) => range('right@25', lateralAt(r, 25) ?? NaN, 3.3, 5.0),
  },
  {
    label: 'P40 C+100 L0',
    plan: '2.8 m right @25 m',
    run: () => kick(40, 0, 100),
    value: (r) => range('right@25', lateralAt(r, 25) ?? NaN, 2.0, 3.6),
  },
];

function targets(): { lines: string[]; failed: number } {
  const lines = ['', '§5.10 tuning targets (planning check → measured, test range):', ''];
  let failed = 0;
  for (const t of TARGETS) {
    const r = t.run();
    const v = t.value(r, kickStats(r));
    if (!v.ok) failed++;
    lines.push(`  ${v.ok ? 'ok  ' : 'FAIL'}  ${t.label.padEnd(15)} plan ${t.plan.padEnd(19)} → ${v.text}`);
  }
  let worst = 0;
  for (const p of [0, 50, 100]) for (const c of [-100, 0, 100]) for (const l of [0, 27.5, 55]) worst = Math.max(worst, kick(p, l, c).duration);
  const ok = worst < 12;
  if (!ok) failed++;
  lines.push(`  ${ok ? 'ok  ' : 'FAIL'}  ${'slider extremes'.padEnd(15)} plan ${'ends < 12 s'.padEnd(19)} → longest ${f1(worst)} s`);
  return { lines, failed };
}

const t = targets();
console.log([...table(), ...t.lines].join('\n'));
console.log(t.failed === 0 ? '\nAll §5.10 targets within range.' : `\n${t.failed} target(s) out of range.`);
if (t.failed > 0) process.exitCode = 1;
