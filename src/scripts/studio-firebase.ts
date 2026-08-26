import {
  GoogleAuthProvider,
  browserLocalPersistence,
  getAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  setPersistence,
  type User,
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  countryCodeValues,
  populateCountryOptions,
  primaryInterestValues,
  professionalRoleValues,
  type MemberProfileChoices,
} from '../data/member-profile';
import { getFirebaseClientApp, googleClientId, isFirebaseConfigured } from './firebase-client';

export type StudioDraftRecord = Record<string, unknown> & { updatedAt?: string; archivedAt?: string };
export type PublicationPreview = {
  title: string;
  bodyHtml: string;
  excerpt: string;
  slug: string;
  tags: string[];
  readMinutes: number;
};
export type StudioRole = 'administrator' | 'publisher' | 'author' | 'commenter' | 'viewer';
export type EditorialRole = Extract<StudioRole, 'administrator' | 'publisher' | 'author'>;
export type RoleRequest = {
  uid: string;
  email: string;
  currentRole: 'commenter' | 'viewer';
  requestedRole: EditorialRole;
  status: 'pending' | 'approved' | 'denied' | 'cancelled';
  createdAt: string;
  reviewedAt: string;
  reviewedBy: string;
  lastCancelledAt?: string;
};

export type StudioBackend = {
  mode: 'cloud';
  role: StudioRole;
  accountEmail?: string;
  listDrafts: () => Promise<Record<string, StudioDraftRecord>>;
  saveDraft: (id: string, draft: StudioDraftRecord, expectedUpdatedAt?: string) => Promise<void>;
  archiveDraft: (id: string, expectedUpdatedAt: string) => Promise<{ archivedAt: string }>;
  restoreDraft: (id: string, expectedUpdatedAt: string) => Promise<{ restoredAt: string; updatedAt: string }>;
  previewDraft: (id: string, draft: StudioDraftRecord) => Promise<PublicationPreview>;
  previewDocument: (id: string, draft: StudioDraftRecord) => Promise<string>;
  publishDraft: (id: string, expectedUpdatedAt: string, idempotencyKey: string) => Promise<{
    releaseId: string;
    liveUrl: string;
    slug: string;
    updatedAt: string;
  }>;
  unpublishDraft: (id: string, expectedUpdatedAt: string) => Promise<{ slug: string; updatedAt: string }>;
  listRoleRequests: () => Promise<RoleRequest[]>;
  reviewRoleRequest: (request: RoleRequest, decision: 'approved' | 'denied') => Promise<void>;
};

const isConfigured = isFirebaseConfigured;

const find = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector);

const unlockStudio = (backend: StudioBackend) => {
  const gate = find<HTMLElement>('[data-access-gate]');
  const studio = find<HTMLElement>('[data-studio]');
  const account = find<HTMLElement>('[data-studio-account]');
  const accountEmail = find<HTMLElement>('[data-studio-account-email]');
  const accountRole = find<HTMLElement>('[data-studio-account-role]');
  if (gate) gate.hidden = true;
  if (studio) studio.hidden = false;
  if (account && accountEmail) {
    accountEmail.textContent = backend.accountEmail ?? 'Authorized author';
    if (accountRole) accountRole.textContent = backend.role;
    account.hidden = false;
  }
};

const showAccessState = (title: string, message: string) => {
  const accessTitle = find<HTMLElement>('[data-access-title]');
  const accessMessage = find<HTMLElement>('[data-access-message]');
  if (accessTitle) accessTitle.textContent = title;
  if (accessMessage) accessMessage.textContent = message;
};

const signInErrorMessage = (error: unknown) => {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : '';
  switch (code) {
    case 'auth/popup-blocked':
      return 'This browser blocked the Google sign-in window. Allow pop-ups for this site, or open Content Studio in a normal browser tab instead of an embedded or in-app browser.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'The Google sign-in window closed before sign-in finished. Select Continue with Google to try again.';
    case 'auth/unauthorized-domain':
      return 'This address is not an authorized domain for the Firebase project. Add it under Firebase Authentication settings, then try again.';
    case 'auth/network-request-failed':
      return 'The connection to Google failed. Check the network and try again.';
    default:
      return error instanceof Error ? error.message : 'Google sign-in did not complete.';
  }
};

const authorizedSessionKey = 'aispanda-studio-authorized-session-v1';
const memberSessionKey = 'aispanda-member-session-v1';

const clearAuthorizedSession = () => window.localStorage.removeItem(authorizedSessionKey);
const clearMemberSession = () => window.localStorage.removeItem(memberSessionKey);

const rememberMemberSession = (user: User, role: StudioRole) => {
  window.localStorage.setItem(memberSessionKey, JSON.stringify({
    uid: user.uid,
    role,
    expiresAt: Date.now() + 60 * 60 * 1000,
  }));
};

const rememberAuthorizedSession = (user: User, role: EditorialRole) => {
  rememberMemberSession(user, role);
  window.localStorage.setItem(authorizedSessionKey, JSON.stringify({
    uid: user.uid,
    role,
    expiresAt: Date.now() + 60 * 60 * 1000,
  }));
};

const requestProfileChoices = (user: User): Promise<MemberProfileChoices> => {
  const form = find<HTMLFormElement>('[data-profile-form]');
  const email = find<HTMLElement>('[data-profile-email]');
  const professionalRole = find<HTMLSelectElement>('[data-profile-professional-role]');
  const primaryInterest = find<HTMLSelectElement>('[data-profile-primary-interest]');
  const country = find<HTMLSelectElement>('[data-profile-country]');
  const submit = find<HTMLButtonElement>('[data-profile-submit]');
  const status = find<HTMLElement>('[data-profile-status]');
  const googleButton = find<HTMLButtonElement>('[data-google-signin]');
  if (!form || !professionalRole || !primaryInterest || !country || !submit || !status) {
    return Promise.reject(new Error('The profile form is unavailable.'));
  }

  populateCountryOptions(country);
  if (email) email.textContent = user.email ?? '';
  if (googleButton) googleButton.hidden = true;
  showAccessState('Complete your profile', 'Three quick, optional choices help us understand the community.');
  form.hidden = false;

  return new Promise((resolve) => {
    const handleSubmit = (event: SubmitEvent) => {
      event.preventDefault();
      const professionalRoleValue = professionalRole.value;
      const primaryInterestValue = primaryInterest.value;
      const countryCode = country.value;
      if (
        !professionalRoleValues.has(professionalRoleValue)
        || !primaryInterestValues.has(primaryInterestValue)
        || (countryCode !== '' && !countryCodeValues.has(countryCode))
      ) {
        status.textContent = 'Choose a listed option for each field.';
        return;
      }
      submit.disabled = true;
      submit.textContent = 'Saving…';
      status.textContent = '';
      form.removeEventListener('submit', handleSubmit);
      form.hidden = true;
      resolve({
        professionalRole: professionalRoleValue,
        primaryInterest: primaryInterestValue,
        countryCode,
        profileCompletedAt: new Date().toISOString(),
      });
    };
    form.addEventListener('submit', handleSubmit);
  });
};

const recordAuthorizedProfile = async (user: User) => {
  const db = getFirestore();
  const profileRef = doc(db, 'userProfiles', user.uid);
  const existing = await getDoc(profileRef);
  const existingData = existing.exists() ? existing.data() : undefined;
  const now = new Date().toISOString();
  const hasCompletedProfile = existingData
    && typeof existingData.profileCompletedAt === 'string'
    && professionalRoleValues.has(existingData.professionalRole)
    && primaryInterestValues.has(existingData.primaryInterest)
    && (existingData.countryCode === '' || countryCodeValues.has(existingData.countryCode));
  const choices: MemberProfileChoices = hasCompletedProfile
    ? {
        professionalRole: existingData.professionalRole,
        primaryInterest: existingData.primaryInterest,
        countryCode: existingData.countryCode,
        profileCompletedAt: existingData.profileCompletedAt,
      }
    : await requestProfileChoices(user);
  await setDoc(profileRef, {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName ?? '',
    providerIds: user.providerData.map((provider) => provider.providerId),
    ...choices,
    firstSeenAt: existingData?.firstSeenAt ?? now,
    lastSeenAt: now,
    privacyNoticeVersion: '2026-08-16',
  });
};

const createCloudBackend = (user: User, role: EditorialRole) => {
  const db = getFirestore();
  const contentRequest = async <T>(
    id: string,
    action: 'publish' | 'unpublish' | 'preview' | 'archive' | 'restore',
    body: Record<string, unknown>,
  ): Promise<T> => {
    const response = await fetch(`/api/content/drafts/${encodeURIComponent(id)}/${action}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await user.getIdToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({})) as { error?: string } & T;
    if (!response.ok) throw new Error(payload.error ?? 'The publication request failed.');
    return payload;
  };
  const previewDocumentRequest = async (id: string, draft: StudioDraftRecord) => {
    const response = await fetch(`/api/content/drafts/${encodeURIComponent(id)}/preview-document`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await user.getIdToken()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ draft }),
    });
    const payload = await response.text();
    if (!response.ok) {
      let message = 'The production-style preview could not be rendered.';
      try { message = JSON.parse(payload).error ?? message; } catch { /* Keep the bounded fallback. */ }
      throw new Error(message);
    }
    return payload;
  };
  return {
    mode: 'cloud' as const,
    role,
    accountEmail: user.email ?? undefined,
    listDrafts: async () => {
      const drafts = collection(db, 'contentDrafts');
      const snapshot = await getDocs(
        role === 'administrator' || role === 'publisher'
          ? drafts
          : query(drafts, where('ownerUid', '==', user.uid)),
      );
      return Object.fromEntries(snapshot.docs.map((draft) => [draft.id, draft.data() as StudioDraftRecord]));
    },
    saveDraft: async (id: string, draft: StudioDraftRecord, expectedUpdatedAt?: string) => {
      const draftRef = doc(db, 'contentDrafts', id);
      await runTransaction(db, async (transaction) => {
        const current = await transaction.get(draftRef);
        const currentData = current.exists() ? current.data() : undefined;
        if (currentData?.archivedAt) {
          throw new Error('This draft is archived and must be restored before it can be edited.');
        }
        if (currentData && expectedUpdatedAt && currentData.updatedAt !== expectedUpdatedAt) {
          throw new Error('This draft changed in another session. Reload before saving.');
        }
        transaction.set(draftRef, {
          ...draft,
          ownerUid: currentData?.ownerUid ?? user.uid,
          ownerEmail: currentData?.ownerEmail ?? user.email,
        });
      });
    },
    archiveDraft: (id: string, expectedUpdatedAt: string) => contentRequest(id, 'archive', { expectedUpdatedAt }),
    restoreDraft: (id: string, expectedUpdatedAt: string) => contentRequest(id, 'restore', { expectedUpdatedAt }),
    previewDraft: (id: string, draft: StudioDraftRecord) => contentRequest(id, 'preview', { draft }),
    previewDocument: previewDocumentRequest,
    publishDraft: (id: string, expectedUpdatedAt: string, idempotencyKey: string) =>
      contentRequest(id, 'publish', { expectedUpdatedAt, idempotencyKey }),
    unpublishDraft: (id: string, expectedUpdatedAt: string) =>
      contentRequest(id, 'unpublish', { expectedUpdatedAt }),
    listRoleRequests: async () => {
      if (role !== 'administrator') return [];
      const snapshot = await getDocs(query(collection(db, 'roleRequests'), where('status', '==', 'pending')));
      return snapshot.docs.map((request) => request.data() as RoleRequest);
    },
    reviewRoleRequest: async (request: RoleRequest, decision: 'approved' | 'denied') => {
      if (role !== 'administrator') throw new Error('Only administrators can review access requests.');
      const batch = writeBatch(db);
      if (decision === 'approved') {
        batch.update(doc(db, 'studioAccess', request.uid), {
          active: true,
          role: request.requestedRole,
          approvedAt: new Date().toISOString(),
          approvedBy: user.uid,
        });
      }
      batch.update(doc(db, 'roleRequests', request.uid), {
        status: decision,
        reviewedAt: new Date().toISOString(),
        reviewedBy: user.uid,
      });
      await batch.commit();
    },
  } satisfies StudioBackend;
};

const showRoleRequestPanel = async (user: User, role: 'commenter' | 'viewer') => {
  const db = getFirestore();
  const panel = find<HTMLElement>('[data-role-request-panel]');
  const email = find<HTMLElement>('[data-role-request-email]');
  const select = find<HTMLSelectElement>('[data-role-request-select]');
  const submit = find<HTMLButtonElement>('[data-role-request-submit]');
  const cancel = find<HTMLButtonElement>('[data-role-request-cancel]');
  const status = find<HTMLElement>('[data-role-request-status]');
  if (!panel || !select || !submit || !cancel || !status || !user.email) return;

  panel.hidden = false;
  if (email) email.textContent = user.email;
  const requestRef = doc(db, 'roleRequests', user.uid);
  let lastCancelledAt = '';
  let requestApproved = false;

  const showReadyState = (message: string) => {
    select.disabled = false;
    submit.hidden = false;
    submit.disabled = false;
    submit.textContent = 'Send request';
    cancel.hidden = true;
    cancel.disabled = false;
    status.textContent = message;
  };

  const showPendingState = (requestedRole: EditorialRole) => {
    select.value = requestedRole;
    select.disabled = true;
    submit.hidden = true;
    submit.disabled = true;
    cancel.hidden = false;
    cancel.disabled = false;
    status.textContent = `${requestedRole} access requested. An administrator must approve it.`;
  };

  submit.addEventListener('click', async () => {
    if (requestApproved) {
      window.location.reload();
      return;
    }
    submit.disabled = true;
    status.textContent = 'Sending request…';
    try {
      const requestedRole = select.value as EditorialRole;
      await setDoc(requestRef, {
        uid: user.uid,
        email: user.email,
        currentRole: role,
        requestedRole,
        status: 'pending',
        createdAt: new Date().toISOString(),
        reviewedAt: '',
        reviewedBy: '',
        lastCancelledAt,
      });
      showPendingState(requestedRole);
    } catch (error) {
      submit.disabled = false;
      status.textContent = error instanceof Error ? error.message : 'The request could not be sent.';
    }
  });

  cancel.addEventListener('click', async () => {
    cancel.disabled = true;
    status.textContent = 'Cancelling request…';
    try {
      lastCancelledAt = new Date().toISOString();
      await updateDoc(requestRef, {
        status: 'cancelled',
        lastCancelledAt,
      });
      showReadyState('Request cancelled. Choose a role whenever you are ready.');
    } catch (error) {
      cancel.disabled = false;
      status.textContent = error instanceof Error ? error.message : 'The request could not be cancelled.';
    }
  });

  const existing = await getDoc(requestRef);
  if (existing.exists()) {
    const request = existing.data() as RoleRequest;
    lastCancelledAt = request.lastCancelledAt ?? '';
    if (request.status === 'pending') {
      showPendingState(request.requestedRole);
      return;
    }
    if (request.status === 'approved') {
      requestApproved = true;
      status.textContent = 'Your request was approved. Reload Studio to continue.';
      select.disabled = true;
      cancel.hidden = true;
      submit.textContent = 'Reload Studio';
      return;
    }
    showReadyState(
      request.status === 'cancelled'
        ? 'Request cancelled. Choose a role whenever you are ready.'
        : 'Your previous request was not approved. You may submit a different request.',
    );
    return;
  }
  showReadyState('Only an existing administrator can approve this request.');
};

export const initializeStudioBackend = async (): Promise<StudioBackend> => {
  const googleButton = find<HTMLButtonElement>('[data-google-signin]');
  const retryButton = find<HTMLButtonElement>('[data-access-retry]');

  if (!isConfigured) {
    showAccessState(
      'Google sign-in needs configuration',
      'Connect this site to its Firebase project to enable authorized access and cross-device drafts.',
    );
    return new Promise<StudioBackend>(() => undefined);
  }

  const app = getFirebaseClientApp();
  const auth = getAuth(app);
  await setPersistence(auth, browserLocalPersistence);
  const db = getFirestore(app);

  if (googleButton) {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    googleButton.hidden = false;
    googleButton.addEventListener('click', async () => {
      googleButton.disabled = true;
      showAccessState('Signing you in…', 'Choose your Google account to continue.');
      try {
        await signInWithPopup(auth, provider);
      } catch (error) {
        console.error('[studio] Google sign-in failed', error);
        googleButton.disabled = false;
        showAccessState('Could not sign in', signInErrorMessage(error));
      }
    });
  }

  retryButton?.addEventListener('click', async () => {
    clearAuthorizedSession();
    clearMemberSession();
    await signOut(auth);
    window.location.reload();
  });

  return new Promise<StudioBackend>((resolve) => {
    const stopObserving = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        clearAuthorizedSession();
        clearMemberSession();
        showAccessState('Sign in to Content Studio', 'New accounts start as Commenters. Editorial tools require Administrator approval.');
        if (googleButton) googleButton.disabled = false;
        return;
      }

      if (!user.email || !user.emailVerified) {
        showAccessState('Verified email required', 'This Google account does not provide a verified email address.');
        if (retryButton) retryButton.hidden = false;
        return;
      }

      try {
        const accessRef = doc(db, 'studioAccess', user.uid);
        let access = await getDoc(accessRef);
        if (!access.exists()) {
          const invite = await getDoc(doc(db, 'studioInvites', user.email));
          const invitedRole = invite.exists() ? invite.data().role : undefined;
          const initialRole = invite.exists() && invite.data().active === true && typeof invitedRole === 'string'
            ? invitedRole
            : 'commenter';
          await setDoc(accessRef, {
            active: true,
            role: initialRole,
            email: user.email,
            claimedAt: new Date().toISOString(),
          });
          access = await getDoc(accessRef);
        }
        const role = access.exists() ? access.data().role : undefined;
        const allowed = access.exists()
          && access.data().active === true
          && (role === 'administrator' || role === 'publisher' || role === 'author');
        rememberMemberSession(user, role as StudioRole);
        await recordAuthorizedProfile(user);
        if (!allowed && (role === 'commenter' || role === 'viewer')) {
          clearAuthorizedSession();
          showAccessState(
            role === 'commenter' ? 'Commenter access active' : 'View-only access active',
            role === 'commenter'
              ? 'You can participate in comments on published articles. Request an editorial role to enter Content Studio.'
              : 'This account can read permitted content but cannot create or edit content.',
          );
          if (googleButton) googleButton.hidden = true;
          if (retryButton) retryButton.hidden = false;
          await showRoleRequestPanel(user, role);
          return;
        }
        if (!allowed) {
          clearAuthorizedSession();
          showAccessState('Access unavailable', 'This account has an unsupported or inactive role. Contact an administrator.');
          if (googleButton) googleButton.hidden = true;
          if (retryButton) retryButton.hidden = false;
          return;
        }

        const backend = createCloudBackend(user, role as EditorialRole);
        rememberAuthorizedSession(user, role);
        stopObserving();
        unlockStudio(backend);
        document.querySelectorAll<HTMLButtonElement>('[data-studio-signout]').forEach((control) => {
          control.addEventListener('click', async () => {
            clearAuthorizedSession();
            clearMemberSession();
            await signOut(auth);
            window.location.reload();
          });
        });
        resolve(backend);
      } catch (error) {
        console.error('[studio] access check failed', error);
        showAccessState('Access check failed', 'The allowlist could not be checked. Verify Firestore and its security rules, then try again.');
        if (retryButton) retryButton.hidden = false;
      }
    });
  });
};
