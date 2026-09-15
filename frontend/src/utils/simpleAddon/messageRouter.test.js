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
  isRepoFlowConfirmation,
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

  it("treats this site's own source (and the repo) as cloud-only", () => {
    // The prompt that exposed this: the addon classified it `action` and burned
    // 56 steps (24 screen_captures, no progress) while the chat showed a spinner,
    // because the desktop agent has no repository tools to do it with.
    expect(isCloudOnlyIntent(
      'Increase the context length for the net goal description input on this website so users can enter more goal details if they want.',
    )).toBe(true);
    expect(isCloudOnlyIntent('make this website load faster')).toBe(true);
    expect(isCloudOnlyIntent('add a dark mode toggle to this website')).toBe(true);
    expect(isCloudOnlyIntent('what does my repo look like?')).toBe(true);
    expect(isCloudOnlyIntent('commit my changes')).toBe(true);
  });

  it('still leaves genuine desktop work with the addon', () => {
    expect(isCloudOnlyIntent('open my website in chrome')).toBe(false);
    expect(isCloudOnlyIntent('click the login button on the page')).toBe(false);
    expect(isCloudOnlyIntent('take a screenshot of this website')).toBe(false);
    expect(isCloudOnlyIntent('tidy up my downloads')).toBe(false);
  });

  it("keeps questions about the user's own cloud data off the desktop agent", () => {
    // The addon cannot read goals/notes, so a local run on these can only flail —
    // "what goals do I have saved right now?" was classified `action` and started
    // screenshotting the screen to look for them.
    expect(isCloudOnlyIntent('what goals do I have saved right now?')).toBe(true);
    expect(isCloudOnlyIntent('how many goals do I have?')).toBe(true);
    expect(isCloudOnlyIntent('show me my notes')).toBe(true);
    expect(isCloudOnlyIntent('list my reminders')).toBe(true);
    // Reports only the cloud can file.
    expect(isCloudOnlyIntent('submit a bug report about the crash')).toBe(true);
    expect(isCloudOnlyIntent('file a support ticket')).toBe(true);
    // Still desktop work.
    expect(isCloudOnlyIntent('open notepad')).toBe(false);
    expect(isCloudOnlyIntent('open edge on my pc')).toBe(false);
    expect(isCloudOnlyIntent('close all my browser windows')).toBe(false);
  });

  it('routes a cloud-data question to the cloud even with the addon connected', () => {
    const d = routeMessage({ text: 'what goals do I have saved?', isAddonConnected: true, provider: 'portfolio' });

    expect(d.kind).toBe(ROUTE_KINDS.CHAT_CLOUD);
    expect(d.skippedAddon).toBe(true);
  });

  it('sends a repo-workflow confirmation to the cloud, not the desktop agent', () => {
    // The addon never saw the question (the cloud agent asked "reply `push a2e3`
    // to confirm"), so a confirmation handed to it produced "I need more
    // context ... what would you like me to push?" and the change never pushed.
    const opts = { isAddonConnected: true, provider: 'portfolio', repoFlowActive: true };
    for (const text of ['yes push it', 'push a2e3', 'go ahead', 'ship it', 'yes']) {
      const d = routeMessage({ text, ...opts });
      expect([text, d.kind, d.reason]).toEqual([text, ROUTE_KINDS.CHAT_CLOUD, 'repo-flow-confirmation']);
      expect(d.skippedAddon).toBe(true);
    }
  });

  it('leaves a confirmation with the addon when no repo workflow is in flight', () => {
    const d = routeMessage({ text: 'yes push it', isAddonConnected: true, provider: 'portfolio' });

    expect(d.kind).toBe(ROUTE_KINDS.AGENT);
  });

  it('does not mistake an instruction for a confirmation', () => {
    const opts = { isAddonConnected: true, provider: 'portfolio', repoFlowActive: true };

    expect(routeMessage({ text: 'open notepad', ...opts }).kind).toBe(ROUTE_KINDS.AGENT);
    expect(routeMessage({ text: 'sure, but also fix the failing tests first', ...opts }).kind).toBe(ROUTE_KINDS.AGENT);
  });

  it('recognises confirmation wording directly', () => {
    expect(isRepoFlowConfirmation('yes push it')).toBe(true);
    expect(isRepoFlowConfirmation('push a2e3')).toBe(true);
    expect(isRepoFlowConfirmation('go ahead')).toBe(true);
    expect(isRepoFlowConfirmation('')).toBe(false);
    expect(isRepoFlowConfirmation('open the calculator')).toBe(false);
    expect(isRepoFlowConfirmation('yes, and then update the pricing page too')).toBe(false);
  });

  it('skips the addon hop for a website source change', () => {
    const d = routeMessage({
      text: 'fix the spacing on this website',
      isAddonConnected: true,
      provider: 'portfolio',
    });
    expect(d.kind).toBe(ROUTE_KINDS.CHAT_CLOUD);
    expect(d.skippedAddon).toBe(true);
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
