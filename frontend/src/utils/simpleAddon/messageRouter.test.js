/**
 * messageRouter.test.js — unit tests for the pure /net message router.
 *
 * These assert the *decision*, not the React plumbing — which is the whole
 * point of extracting `routeMessage()`.
 */

import {
  routeMessage,
  isPcControlRequest,
  isCloudOnlyIntent,
  chatFallbackFor,
  ROUTE_KINDS,
  ROUTE_TRANSITIONS,
} from './messageRouter';

describe('routeMessage — ordering & precedence', () => {
  it('lets a slash command win over everything', () => {
    const d = routeMessage({ text: 'ignored', slashMatched: true, securityBlocked: true, hasImage: true });
    expect(d.kind).toBe(ROUTE_KINDS.SLASH);
  });

  it('blocks on the security pre-screen before routing', () => {
    const d = routeMessage({ text: 'rm -rf /', securityBlocked: true });
    expect(d.kind).toBe(ROUTE_KINDS.BLOCKED);
    expect(d.reason).toBe('security-prescreen');
  });

  it('requires the cloud provider for an attached image on a local model', () => {
    const d = routeMessage({ text: 'what is this?', hasImage: true, provider: 'local' });
    expect(d.kind).toBe(ROUTE_KINDS.VISION_REQUIRED);
  });

  it('sends an attached image to cloud chat when the cloud provider is set', () => {
    const d = routeMessage({ text: 'what is this?', hasImage: true, provider: 'portfolio' });
    expect(d.kind).toBe(ROUTE_KINDS.CHAT_CLOUD);
  });
});

describe('routeMessage — PC control', () => {
  it('detects explicit "on my pc" phrasing', () => {
    expect(isPcControlRequest('open edge on my pc')).toBe(true);
    expect(isPcControlRequest('open notepad')).toBe(false);
  });

  it('relays an explicit PC request when a remote addon is online', () => {
    const d = routeMessage({ text: 'open edge on my pc', isRemoteAddonOnline: true, isLoggedIn: true });
    expect(d.kind).toBe(ROUTE_KINDS.PC_RELAY);
  });

  it('reports unreachable when no addon is reachable', () => {
    const d = routeMessage({ text: 'open edge on my pc', isRemoteAddonOnline: false });
    expect(d.kind).toBe(ROUTE_KINDS.UNREACHABLE);
    expect(d.reason).toBe('explicit-pc-phrasing-no-addon');
  });

  it('reports unreachable for a QR/desktop-targeted session with no addon', () => {
    const d = routeMessage({ text: 'hello', phoneTargetingDesktop: true });
    expect(d.kind).toBe(ROUTE_KINDS.UNREACHABLE);
  });

  it('uses the agent (not the relay) when the addon is locally connected', () => {
    const d = routeMessage({ text: 'open edge on my pc', isAddonConnected: true });
    expect(d.kind).toBe(ROUTE_KINDS.AGENT);
  });
});

describe('routeMessage — logic mode & cloud-only shortcut', () => {
  it('tries the addon first for a normal message', () => {
    const d = routeMessage({ text: 'tidy up my downloads', isAddonConnected: true });
    expect(d.kind).toBe(ROUTE_KINDS.AGENT);
  });

  it('detects cloud-only intents', () => {
    expect(isCloudOnlyIntent('generate an image of a cat')).toBe(true);
    expect(isCloudOnlyIntent('calculate 15% of 200')).toBe(true);
    expect(isCloudOnlyIntent('search the web for the weather')).toBe(true);
    expect(isCloudOnlyIntent('create a file called notes.txt')).toBe(false);
    expect(isCloudOnlyIntent('open notepad')).toBe(false);
  });

  it('skips the addon hop for a cloud-only intent when the addon is remote', () => {
    const d = routeMessage({ text: 'generate an image of a cat', isRemoteAddonOnline: true, provider: 'portfolio' });
    expect(d.kind).toBe(ROUTE_KINDS.CHAT_CLOUD);
    expect(d.skippedAddon).toBe(true);
  });

  it('skips the addon hop for a cloud-only intent even when the addon is local', () => {
    const d = routeMessage({ text: 'generate an image of a cat', isAddonConnected: true, provider: 'portfolio' });
    expect(d.kind).toBe(ROUTE_KINDS.CHAT_CLOUD);
    expect(d.skippedAddon).toBe(true);
  });

  it('routes to the local model for a cloud-only intent when provider is local', () => {
    const d = routeMessage({ text: 'generate an image of a cat', isAddonConnected: true, provider: 'local' });
    expect(d.kind).toBe(ROUTE_KINDS.CHAT_LOCAL);
  });
});

describe('routeMessage — plain chat', () => {
  it('uses cloud chat when no addon is reachable and provider is portfolio', () => {
    const d = routeMessage({ text: 'hello there' });
    expect(d.kind).toBe(ROUTE_KINDS.CHAT_CLOUD);
  });

  it('uses local chat when provider is local and no addon is reachable', () => {
    const d = routeMessage({ text: 'hello there', provider: 'local' });
    expect(d.kind).toBe(ROUTE_KINDS.CHAT_LOCAL);
  });
});

describe('routeMessage — transition integrity (keeps the docs diagram honest)', () => {
  it('every declared transition targets a known route kind', () => {
    const kinds = new Set(Object.values(ROUTE_KINDS));
    for (const [from, targets] of Object.entries(ROUTE_TRANSITIONS)) {
      expect(kinds.has(from)).toBe(true);
      for (const t of targets) expect(kinds.has(t)).toBe(true);
    }
  });

  it('the agent fall-through matches chatFallbackFor for both providers', () => {
    expect(ROUTE_TRANSITIONS[ROUTE_KINDS.AGENT]).toContain(chatFallbackFor('portfolio'));
    expect(ROUTE_TRANSITIONS[ROUTE_KINDS.AGENT]).toContain(chatFallbackFor('local'));
  });
});
