import { describe, expect, it } from 'vitest';
import { ROOM_CODE_ALPHABET, normalizeRoomCode } from '../app/router';
import { iceServers, mapPeerError, peerIdForCode, peerOptions, randomRoomCode } from './peer';

describe('room codes', () => {
  it('are 5 characters from the alphabet and survive normalization', () => {
    let seed = 1;
    const rand = (): number => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let i = 0; i < 200; i++) {
      const c = randomRoomCode(rand);
      expect(c).toHaveLength(5);
      expect([...c].every((ch) => ROOM_CODE_ALPHABET.includes(ch))).toBe(true);
      expect(normalizeRoomCode(c.toLowerCase())).toBe(c);
    }
    expect(randomRoomCode(() => 0)).toBe('AAAAA');
    expect(randomRoomCode(() => 0.999999)).toBe('99999');
    expect(peerIdForCode('ABCDE')).toBe('footy-v1-ABCDE');
  });
});

describe('mapPeerError', () => {
  it('maps PeerJS error types to lobby errors', () => {
    expect(mapPeerError('peer-unavailable')).toBe('room-not-found');
    expect(mapPeerError('unavailable-id')).toBe('code-taken');
    expect(mapPeerError('browser-incompatible')).toBe('browser');
    for (const t of ['network', 'server-error', 'socket-error', 'socket-closed', 'webrtc']) expect(mapPeerError(t)).toBe('network');
    expect(mapPeerError('invalid-key')).toBe('unknown');
    expect(mapPeerError(undefined)).toBe('unknown');
  });
});

describe('ICE and PeerServer options', () => {
  it('uses two STUN servers by default', () => {
    expect(iceServers({})).toEqual([{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }]);
    const o = peerOptions({});
    expect(o.host).toBeUndefined();
    expect(o.config?.iceServers).toHaveLength(2);
  });

  it('adds TURN and a self-hosted PeerServer from env', () => {
    const env = {
      VITE_TURN_URLS: 'turn:a.example:3478, turns:b.example:5349',
      VITE_TURN_USERNAME: 'u',
      VITE_TURN_CREDENTIAL: 'p',
      VITE_PEER_HOST: 'peer.example',
      VITE_PEER_PORT: '9000',
      VITE_PEER_PATH: '/myapp',
      VITE_PEER_SECURE: 'false',
    };
    expect(iceServers(env)[2]).toEqual({ urls: ['turn:a.example:3478', 'turns:b.example:5349'], username: 'u', credential: 'p' });
    expect(peerOptions(env)).toMatchObject({ host: 'peer.example', port: 9000, path: '/myapp', secure: false });
  });
});
