import { describe, expect, it } from 'vitest';
import { createLoopbackPair, LoopbackHub, type Transport, type TransportStatus } from './transport';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function record(t: Transport): { msgs: unknown[]; status: TransportStatus[] } {
  const msgs: unknown[] = [];
  const status: TransportStatus[] = [];
  t.onMessage((m) => msgs.push(m));
  t.onStatus((s) => status.push(s));
  return { msgs, status };
}

describe('LoopbackTransport', () => {
  it('delivers JSON copies asynchronously and in order', async () => {
    const [a, b] = createLoopbackPair();
    const rb = record(b);
    const payload = { v: 1, t: 'ping', ts: 5, nested: { arr: [1, 2] } };
    a.send(payload);
    a.send({ n: 2 });
    expect(rb.msgs).toEqual([]);
    await flush();
    expect(rb.msgs).toEqual([payload, { n: 2 }]);
    expect(rb.msgs[0]).not.toBe(payload);
  });

  it('close() closes both ends and stops delivery', async () => {
    const [a, b] = createLoopbackPair();
    const ra = record(a);
    const rb = record(b);
    a.close();
    a.send({ late: true });
    await flush();
    expect(a.state).toBe('closed');
    expect(b.state).toBe('closed');
    expect(ra.status).toEqual([{ kind: 'closed', reason: 'local' }]);
    expect(rb.status).toEqual([{ kind: 'closed', reason: 'remote' }]);
    expect(rb.msgs).toEqual([]);
  });

  it('sever() silences the link without close events', async () => {
    const [a, b] = createLoopbackPair();
    const rb = record(b);
    a.sever();
    a.send({ x: 1 });
    b.send({ y: 1 });
    await flush();
    expect(rb.msgs).toEqual([]);
    expect(a.state).toBe('open');
    expect(b.state).toBe('open');
  });
});

describe('LoopbackHub', () => {
  it('connects a guest to a listening host', async () => {
    const hub = new LoopbackHub();
    const room = hub.listen('ABCDE');
    const hosts: Transport[] = [];
    room.onConnection((t) => hosts.push(t));
    const guest = hub.connect('ABCDE');
    const rg = record(guest);
    expect(guest.state).toBe('connecting');
    await flush();
    expect(guest.state).toBe('open');
    expect(rg.status).toEqual([{ kind: 'open' }]);
    expect(hosts).toHaveLength(1);
    const rh = record(hosts[0]!);
    guest.send({ hi: 1 });
    hosts[0]!.send({ back: 1 });
    await flush();
    expect(rh.msgs).toEqual([{ hi: 1 }]);
    expect(rg.msgs).toEqual([{ back: 1 }]);
  });

  it('reports room-not-found and code-taken', async () => {
    const hub = new LoopbackHub();
    const guest = hub.connect('ZZZZZ');
    const rg = record(guest);
    await flush();
    expect(guest.state).toBe('error');
    expect(rg.status[0]).toMatchObject({ kind: 'error', error: { code: 'room-not-found' } });
    hub.listen('AAAAA');
    expect(() => hub.listen('AAAAA')).toThrow(/taken/);
  });

  it('closing the room closes its guests and frees the code', async () => {
    const hub = new LoopbackHub();
    const room = hub.listen('ABCDE');
    const guest = hub.connect('ABCDE');
    await flush();
    room.close();
    await flush();
    expect(guest.state).toBe('closed');
    expect(() => hub.listen('ABCDE')).not.toThrow();
  });
});
