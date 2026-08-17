import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut,
  type User,
} from 'firebase/auth';
import { doc, getDoc, getFirestore, setDoc } from 'firebase/firestore';
import {
  countryCodeValues,
  populateCountryOptions,
  primaryInterestValues,
  professionalRoleValues,
  type MemberProfileChoices,
} from '../data/member-profile';
import {
  AI_CONNECTIONS_CHANGED_EVENT,
  getBrowserAiConnectionContext,
  persistBrowserAiConnections,
  restoreBrowserAiConnections,
} from './ai-connections';
import { getFirebaseClientApp, isFirebaseConfigured } from './firebase-client';

type MemberRole = 'administrator' | 'publisher' | 'author' | 'commenter' | 'viewer';
type MemberProfile = MemberProfileChoices & {
  uid: string;
  email: string;
  displayName: string;
  providerIds: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  privacyNoticeVersion: string;
};

const roles = new Set<MemberRole>(['administrator', 'publisher', 'author', 'commenter', 'viewer']);
const memberSessionKey = 'aispanda-member-session-v1';
const editorialSessionKey = 'aispanda-studio-authorized-session-v1';

const find = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector);
const roleLabel = (role: MemberRole) => role === 'viewer' ? 'View only' : role[0].toUpperCase() + role.slice(1);

const rememberMemberSession = (user: User, role: MemberRole) => {
  const session = JSON.stringify({ uid: user.uid, role, expiresAt: Date.now() + 60 * 60 * 1000 });
  window.localStorage.setItem(memberSessionKey, session);
  if (['administrator', 'publisher', 'author'].includes(role)) {
    window.localStorage.setItem(editorialSessionKey, session);
  } else {
    window.localStorage.removeItem(editorialSessionKey);
  }
  window.dispatchEvent(new StorageEvent('storage', { key: memberSessionKey }));
};

const clearMemberSessions = () => {
  window.localStorage.removeItem(memberSessionKey);
  window.localStorage.removeItem(editorialSessionKey);
  window.dispatchEvent(new StorageEvent('storage', { key: memberSessionKey }));
};

const signInErrorMessage = (error: unknown) => {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : '';
  if (code === 'auth/popup-blocked') return 'Allow pop-ups for this site, then try again.';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'The sign-in window closed before finishing.';
  if (code === 'auth/network-request-failed') return 'The connection to Google failed. Check the network and try again.';
  return error instanceof Error ? error.message : 'Google sign-in did not complete.';
};

export const initializeAccountSettings = async () => {
  const loading = find<HTMLElement>('[data-account-loading]');
  const signedOut = find<HTMLElement>('[data-account-signed-out]');
  const content = find<HTMLElement>('[data-account-content]');
  const signInButton = find<HTMLButtonElement>('[data-account-signin]');
  const signOutButton = find<HTMLButtonElement>('[data-account-signout]');
  const status = find<HTMLElement>('[data-account-status]');
  const name = find<HTMLInputElement>('[data-account-name]');
  const email = find<HTMLInputElement>('[data-account-email]');
  const role = find<HTMLElement>('[data-account-role]');
  const studioLink = find<HTMLAnchorElement>('[data-account-studio-link]');
  const profileForm = find<HTMLFormElement>('[data-account-profile-form]');
  const professionalRole = find<HTMLSelectElement>('[data-account-professional-role]');
  const primaryInterest = find<HTMLSelectElement>('[data-account-primary-interest]');
  const country = find<HTMLSelectElement>('[data-account-country]');
  const profileSubmit = find<HTMLButtonElement>('[data-account-profile-submit]');
  const profileStatus = find<HTMLElement>('[data-account-profile-status]');

  const activeRouterNote = find<HTMLElement>('[data-active-router-note]');
  const playgroundLink = find<HTMLAnchorElement>('[data-ai-playground-link]');
  const providerCards = [...document.querySelectorAll<HTMLElement>('[data-ai-provider-card]')];

  if (!isFirebaseConfigured) {
    if (loading) loading.hidden = true;
    if (signedOut) signedOut.hidden = false;
    if (status) status.textContent = 'Account settings require the configured AI Spanda sign-in service.';
    if (signInButton) signInButton.hidden = true;
    return;
  }

  if (country) populateCountryOptions(country);

  const app = getFirebaseClientApp();
  const auth = getAuth(app);
  const db = getFirestore(app);
  await setPersistence(auth, browserLocalPersistence);

  const { registry: connectors, manager: connectionManager } = getBrowserAiConnectionContext();
  const needsAttention = new Set<string>();
  const defaultCopy = new Map(providerCards.map((card) => [card.dataset.aiProviderCard ?? '', {
    detail: card.querySelector<HTMLElement>('[data-ai-detail]')?.textContent ?? '',
    usage: card.querySelector<HTMLElement>('[data-ai-usage]')?.textContent ?? '',
  }]));

  const renderConnections = () => {
    const active = connectionManager.active;
    const hasConnectedRouter = connectors.list().some((connector) => connector.status.connected);
    if (activeRouterNote) activeRouterNote.textContent = active
      ? `${active.descriptor.label} is active. Other connected routers remain ready to switch.`
      : 'No AI router is active. Connect one, then choose Make active before using AI actions.';
    if (playgroundLink) {
      playgroundLink.classList.toggle('is-disabled', !hasConnectedRouter);
      playgroundLink.setAttribute('aria-disabled', String(!hasConnectedRouter));
      playgroundLink.tabIndex = hasConnectedRouter ? 0 : -1;
    }

    for (const card of providerCards) {
      const id = card.dataset.aiProviderCard ?? '';
      const connector = connectors.get(id);
      const isActive = connectionManager.activeId === id && connector.status.connected;
      const attention = needsAttention.has(id);
      const state = card.querySelector<HTMLElement>('[data-ai-state]');
      const detail = card.querySelector<HTMLElement>('[data-ai-detail]');
      const usage = card.querySelector<HTMLElement>('[data-ai-usage]');
      const oauthConnect = card.querySelector<HTMLButtonElement>('[data-ai-oauth-connect]');
      const openSetup = card.querySelector<HTMLButtonElement>('[data-ai-open-setup]');
      const activate = card.querySelector<HTMLButtonElement>('[data-ai-activate]');
      const activeIndicator = card.querySelector<HTMLElement>('[data-ai-active-indicator]');
      const disconnect = card.querySelector<HTMLButtonElement>('[data-ai-disconnect]');
      const copy = defaultCopy.get(id);
      const isConnected = connector.status.connected;

      card.toggleAttribute('data-active', isActive);
      if (state) state.textContent = isActive ? 'Active' : attention ? 'Needs attention' : isConnected ? 'Connected' : 'Not connected';
      state?.toggleAttribute('data-connected', isConnected);
      state?.toggleAttribute('data-active-state', isActive);
      state?.toggleAttribute('data-needs-attention', attention);
      if (detail) detail.textContent = isActive
        ? `${connector.descriptor.label} is selected for AI actions.`
        : isConnected
          ? 'Connected and ready. Select Make active when you want to use it.'
        : copy?.detail ?? '';
      if (usage) {
        const remaining = connector.status.limitRemaining;
        usage.textContent = isActive && typeof remaining === 'number'
          ? `${id === 'openrouter' ? 'OpenRouter key limit' : 'Spending allowance'}: $${remaining.toFixed(2)} left${connector.status.limitReset ? ` · resets ${connector.status.limitReset}` : ''}. OpenRouter is the source of truth.`
          : copy?.usage ?? '';
      }
      if (oauthConnect) {
        oauthConnect.hidden = isConnected;
        oauthConnect.disabled = false;
        oauthConnect.textContent = 'Connect';
      }
      if (openSetup) {
        openSetup.hidden = isConnected;
        openSetup.textContent = 'Connect';
      }
      if (activate) activate.hidden = !isConnected || isActive;
      if (activeIndicator) activeIndicator.hidden = !isActive;
      if (disconnect) disconnect.hidden = !isConnected;
    }
  };

  const showConnectionResult = (card: HTMLElement, message: string) => {
    const output = card.querySelector<HTMLElement>('[data-ai-message]');
    if (output) output.textContent = message;
  };

  const activateConnectedRouter = (id: string, card: HTMLElement) => {
    const connector = connectionManager.activate(id);
    needsAttention.delete(id);
    showConnectionResult(card, `${connector.descriptor.label} is now active. Your other connections remain available to switch back.`);
    renderConnections();
    window.dispatchEvent(new Event(AI_CONNECTIONS_CHANGED_EVENT));
  };

  const finishConnection = async (id: string, card: HTMLElement) => {
    needsAttention.delete(id);
    const connector = connectors.get(id);
    // A provider with no browser-direct transport can only run through the server relay, so it is
    // unusable without a signed-in account to store the credential against. Say so and drop the
    // credential rather than reporting a connection that cannot generate.
    if (!connector.descriptor.transports.includes('browser-direct') && !auth.currentUser) {
      needsAttention.add(id);
      connector.clearBrowserSession?.();
      showConnectionResult(card, `${connector.descriptor.label} runs through the AI Spanda server, so it needs you signed in. Sign in, then connect again.`);
      renderConnections();
      return;
    }
    if (auth.currentUser) await connector.persistForAccount?.();
    if (!connectionManager.activeId) {
      activateConnectedRouter(id, card);
      return;
    }
    showConnectionResult(card, `${connector.descriptor.label} is connected. Select Make active when you want to use it.`);
    renderConnections();
  };

  for (const card of providerCards) {
    const id = card.dataset.aiProviderCard ?? '';
    const connector = connectors.get(id);
    const oauthConnect = card.querySelector<HTMLButtonElement>('[data-ai-oauth-connect]');
    const openSetup = card.querySelector<HTMLButtonElement>('[data-ai-open-setup]');
    const setup = card.querySelector<HTMLDetailsElement>('[data-ai-setup]');
    const keyForm = card.querySelector<HTMLFormElement>('[data-ai-key-form]');
    const configForm = card.querySelector<HTMLFormElement>('[data-ai-config-form]');

    card.querySelector<HTMLButtonElement>('[data-ai-activate]')?.addEventListener('click', () => {
      activateConnectedRouter(id, card);
    });

    oauthConnect?.addEventListener('click', async () => {
      oauthConnect.disabled = true;
      showConnectionResult(card, `Opening ${connector.descriptor.label}…`);
      try {
        await connector.beginConnection(`${window.location.origin}/account?section=ai`);
      } catch (error) {
        oauthConnect.disabled = false;
        showConnectionResult(card, error instanceof Error ? error.message : `${connector.descriptor.label} could not be opened.`);
      }
    });

    openSetup?.addEventListener('click', () => {
      if (setup) setup.open = true;
      setup?.querySelector<HTMLInputElement>('input')?.focus();
    });

    keyForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = keyForm.querySelector<HTMLInputElement>('[data-ai-key]');
      const submit = keyForm.querySelector<HTMLButtonElement>('[data-ai-key-submit]');
      const candidate = input?.value ?? '';
      if (input) input.value = '';
      if (submit) submit.disabled = true;
      showConnectionResult(card, 'Checking this connection…');
      try {
        await connector.connectWithApiKey?.(candidate);
        await finishConnection(id, card);
        window.dispatchEvent(new Event(AI_CONNECTIONS_CHANGED_EVENT));
      } catch (error) {
        needsAttention.add(id);
        showConnectionResult(card, error instanceof Error ? error.message : 'This credential could not be connected.');
      } finally {
        if (submit) submit.disabled = false;
        renderConnections();
      }
    });

    configForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = configForm.querySelector<HTMLButtonElement>('[data-ai-config-submit]');
      const configuration = Object.fromEntries(
        [...configForm.querySelectorAll<HTMLInputElement>('[data-ai-config]')]
          .map((input) => [input.dataset.aiConfig ?? '', input.value]),
      );
      configForm.querySelectorAll<HTMLInputElement>('input[type="password"]').forEach((input) => { input.value = ''; });
      if (submit) submit.disabled = true;
      showConnectionResult(card, id === 'cloudflare' ? 'Preparing Cloudflare authorization…' : 'Checking this connection…');
      try {
        await connector.connectWithConfiguration?.(configuration);
        if (id === 'cloudflare') {
          showConnectionResult(card, 'Continue in the Cloudflare window to approve AI Gateway access.');
          await connector.beginConnection(`${window.location.origin}/auth/cloudflare/callback`);
        } else {
          await finishConnection(id, card);
          window.dispatchEvent(new Event(AI_CONNECTIONS_CHANGED_EVENT));
        }
      } catch (error) {
        needsAttention.add(id);
        showConnectionResult(card, error instanceof Error ? error.message : 'These connection details could not be verified.');
      } finally {
        if (submit) submit.disabled = false;
        renderConnections();
      }
    });

    card.querySelector<HTMLButtonElement>('[data-ai-disconnect]')?.addEventListener('click', async () => {
      try {
        await connectionManager.disconnect(id);
        needsAttention.delete(id);
        showConnectionResult(card, `${connector.descriptor.label} disconnected from your account.`);
        window.dispatchEvent(new Event(AI_CONNECTIONS_CHANGED_EVENT));
      } catch (error) {
        needsAttention.add(id);
        showConnectionResult(card, error instanceof Error ? error.message : `${connector.descriptor.label} could not be disconnected.`);
      }
      renderConnections();
    });
  }

  const finishCloudflareCallback = async (data: unknown) => {
    if (typeof data !== 'object' || data === null) return;
    const message = data as { type?: string; callbackUrl?: string };
    if (message.type !== 'aispanda:cloudflare-oauth-callback' || !message.callbackUrl) return;
    const connector = connectors.get('cloudflare');
    const card = providerCards.find((candidate) => candidate.dataset.aiProviderCard === 'cloudflare');
    if (!card) return;
    showConnectionResult(card, 'Finishing Cloudflare connection…');
    try {
      const callback = await connector.completeConnectionCallback(message.callbackUrl);
      if (!callback.handled) throw new Error('This Cloudflare response did not match the connection request. Start again.');
      if (callback.connected) {
        await finishConnection('cloudflare', card);
        window.dispatchEvent(new Event(AI_CONNECTIONS_CHANGED_EVENT));
      } else {
        needsAttention.add('cloudflare');
        showConnectionResult(card, callback.error ?? 'Cloudflare did not connect.');
      }
    } catch (error) {
      needsAttention.add('cloudflare');
      showConnectionResult(card, error instanceof Error ? error.message : 'Cloudflare did not connect.');
    }
    renderConnections();
  };

  window.addEventListener('message', (event: MessageEvent<unknown>) => {
    if (event.origin !== window.location.origin) return;
    void finishCloudflareCallback(event.data);
  });
  if ('BroadcastChannel' in window) {
    const cloudflareChannel = new BroadcastChannel('aispanda-cloudflare-oauth');
    cloudflareChannel.addEventListener('message', (event) => void finishCloudflareCallback(event.data));
  }

  const callbackUrl = window.location.href;
  const callbackParameters = new URL(callbackUrl).searchParams;
  const isCompletingConnection = callbackParameters.has('code') || callbackParameters.has('error');
  if (isCompletingConnection && activeRouterNote) activeRouterNote.textContent = 'Finishing your AI connection…';
  for (const connector of connectors.list()) {
    const card = providerCards.find((candidate) => candidate.dataset.aiProviderCard === connector.descriptor.id);
    if (isCompletingConnection && card) showConnectionResult(card, `Finishing ${connector.descriptor.label} connection…`);
    const callback = await connector.completeConnectionCallback(callbackUrl);
    if (!callback.handled) continue;
    if (callback.cleanUrl) window.history.replaceState({}, '', callback.cleanUrl);
    if (callback.connected && card) await finishConnection(connector.descriptor.id, card);
    else if (card) {
      needsAttention.add(connector.descriptor.id);
      showConnectionResult(card, callback.error ?? `${connector.descriptor.label} did not connect.`);
    }
    break;
  }
  const activeConnector = connectionManager.active;
  if (activeConnector) {
    try {
      await activeConnector.refreshStatus();
    } catch (error) {
      needsAttention.add(activeConnector.descriptor.id);
      const card = providerCards.find((candidate) => candidate.dataset.aiProviderCard === activeConnector.descriptor.id);
      if (card) showConnectionResult(card, error instanceof Error ? error.message : `${activeConnector.descriptor.label} status could not be refreshed.`);
    }
  }
  renderConnections();
  window.addEventListener(AI_CONNECTIONS_CHANGED_EVENT, renderConnections);

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  signInButton?.addEventListener('click', async () => {
    signInButton.disabled = true;
    if (status) status.textContent = 'Choose your Google account to continue.';
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      signInButton.disabled = false;
      if (status) status.textContent = signInErrorMessage(error);
    }
  });

  signOutButton?.addEventListener('click', async () => {
    connectionManager.clearBrowserSession();
    clearMemberSessions();
    await signOut(auth);
    window.location.reload();
  });

  let currentUser: User | null = null;
  let currentProfile: MemberProfile | null = null;

  profileForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!currentUser || !currentProfile || !professionalRole || !primaryInterest || !country) return;
    if (
      !professionalRoleValues.has(professionalRole.value as never)
      || !primaryInterestValues.has(primaryInterest.value as never)
      || (country.value !== '' && !countryCodeValues.has(country.value))
    ) {
      if (profileStatus) profileStatus.textContent = 'Choose a listed option for each field.';
      return;
    }
    if (profileSubmit) profileSubmit.disabled = true;
    if (profileStatus) profileStatus.textContent = 'Saving…';
    const updated: MemberProfile = {
      ...currentProfile,
      professionalRole: professionalRole.value,
      primaryInterest: primaryInterest.value,
      countryCode: country.value,
      profileCompletedAt: currentProfile.profileCompletedAt || new Date().toISOString(),
      lastSeenAt: new Date().toISOString(),
    };
    try {
      await setDoc(doc(db, 'userProfiles', currentUser.uid), updated);
      currentProfile = updated;
      if (profileStatus) profileStatus.textContent = 'Personal information saved.';
    } catch (error) {
      if (profileStatus) profileStatus.textContent = error instanceof Error ? error.message : 'Your information could not be saved.';
    } finally {
      if (profileSubmit) profileSubmit.disabled = false;
    }
  });

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      if (loading) loading.hidden = true;
      if (content) content.hidden = true;
      if (signedOut) signedOut.hidden = false;
      if (signInButton) signInButton.disabled = false;
      return;
    }
    if (!user.email || !user.emailVerified) {
      if (loading) loading.hidden = true;
      if (signedOut) signedOut.hidden = false;
      if (status) status.textContent = 'Use a Google account with a verified email address.';
      return;
    }

    try {
      try {
        await persistBrowserAiConnections();
        await restoreBrowserAiConnections();
      } catch (connectionError) {
        if (status) status.textContent = connectionError instanceof Error
          ? `Your account loaded, but saved AI connections need attention: ${connectionError.message}`
          : 'Your account loaded, but saved AI connections need attention.';
      }
      const accessRef = doc(db, 'studioAccess', user.uid);
      let access = await getDoc(accessRef);
      if (!access.exists()) {
        const invite = await getDoc(doc(db, 'studioInvites', user.email));
        const invitedRole = invite.exists() ? invite.data().role : undefined;
        const initialRole = invite.exists() && invite.data().active === true && roles.has(invitedRole)
          ? invitedRole as MemberRole
          : 'commenter';
        await setDoc(accessRef, { active: true, role: initialRole, email: user.email, claimedAt: new Date().toISOString() });
        access = await getDoc(accessRef);
      }
      const accessRole = access.data()?.role;
      const memberRole: MemberRole = roles.has(accessRole) ? accessRole : 'commenter';
      rememberMemberSession(user, memberRole);

      const profileRef = doc(db, 'userProfiles', user.uid);
      const profileSnapshot = await getDoc(profileRef);
      const now = new Date().toISOString();
      const existing = profileSnapshot.exists() ? profileSnapshot.data() : {};
      currentProfile = {
        uid: user.uid,
        email: user.email,
        displayName: user.displayName ?? '',
        providerIds: user.providerData.map((entry) => entry.providerId),
        professionalRole: professionalRoleValues.has(existing.professionalRole) ? existing.professionalRole : 'prefer-not-to-say',
        primaryInterest: primaryInterestValues.has(existing.primaryInterest) ? existing.primaryInterest : 'prefer-not-to-say',
        countryCode: countryCodeValues.has(existing.countryCode) ? existing.countryCode : '',
        profileCompletedAt: typeof existing.profileCompletedAt === 'string' ? existing.profileCompletedAt : now,
        firstSeenAt: typeof existing.firstSeenAt === 'string' ? existing.firstSeenAt : now,
        lastSeenAt: now,
        privacyNoticeVersion: '2026-08-16',
      };
      currentUser = user;
      if (!profileSnapshot.exists()) await setDoc(profileRef, currentProfile);

      if (name) name.value = currentProfile.displayName || 'Not provided by Google';
      if (email) email.value = currentProfile.email;
      if (role) role.textContent = roleLabel(memberRole);
      if (professionalRole) professionalRole.value = currentProfile.professionalRole;
      if (primaryInterest) primaryInterest.value = currentProfile.primaryInterest;
      if (country) country.value = currentProfile.countryCode;
      if (studioLink) studioLink.hidden = !['administrator', 'publisher', 'author'].includes(memberRole);
      if (loading) loading.hidden = true;
      if (signedOut) signedOut.hidden = true;
      if (content) content.hidden = false;
      if (new URLSearchParams(window.location.search).get('section') === 'ai') {
        window.requestAnimationFrame(() => {
          document.querySelector('#ai-connections')?.scrollIntoView({ block: 'start' });
        });
      }
    } catch (error) {
      if (loading) loading.hidden = true;
      if (signedOut) signedOut.hidden = false;
      if (status) status.textContent = error instanceof Error ? error.message : 'Your account could not be loaded.';
    }
  });
};
