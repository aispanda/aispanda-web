import { getApp, getApps, initializeApp } from 'firebase/app';
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
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Timestamp,
} from 'firebase/firestore';
import { countryCodes } from '../data/countries';

type MemberRole = 'administrator' | 'publisher' | 'author' | 'commenter' | 'viewer';

type CommentRecord = {
  id: string;
  articleSlug: string;
  parentId: string;
  body: string;
  authorName: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
  edited: boolean;
  deleted: boolean;
  deletedAt?: Timestamp | null;
  likeCount: number;
  pinned: boolean;
  pinnedAt?: Timestamp | null;
};

type ProfileChoices = {
  professionalRole: string;
  primaryInterest: string;
  countryCode: string;
  profileCompletedAt: string;
};

const firebaseConfig = {
  apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY,
  authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.PUBLIC_FIREBASE_APP_ID,
};

const isConfigured = Object.values(firebaseConfig).every(
  (value) => typeof value === 'string' && value.length > 0,
);

const roles = new Set<MemberRole>(['administrator', 'publisher', 'author', 'commenter', 'viewer']);
const professionalRoleValues = new Set([
  'prefer-not-to-say',
  'student',
  'educator-researcher',
  'technology-ai-practitioner',
  'business-operations-leader',
  'public-sector-policy',
  'writer-creator',
  'independent-learner',
  'other',
]);
const primaryInterestValues = new Set([
  'prefer-not-to-say',
  'practical-ai',
  'ai-strategy',
  'open-reusable-ai',
  'ai-policy-social-impact',
  'education-training',
  'community-discussion',
  'other',
]);
const countryCodeValues = new Set<string>(countryCodes);

const memberSessionKey = 'aispanda-member-session-v1';
const editorialSessionKey = 'aispanda-studio-authorized-session-v1';

const roleLabel = (role: MemberRole) => role === 'viewer' ? 'View Only' : role[0].toUpperCase() + role.slice(1);

const signInErrorMessage = (error: unknown) => {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : '';
  if (code === 'auth/popup-blocked') return 'This browser blocked the Google sign-in window. Allow pop-ups and try again.';
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'The Google sign-in window closed before sign-in finished.';
  }
  if (code === 'auth/network-request-failed') return 'The connection to Google failed. Check the network and try again.';
  return error instanceof Error ? error.message : 'Google sign-in did not complete.';
};

const rememberMemberSession = (user: User, role: MemberRole) => {
  window.localStorage.setItem(memberSessionKey, JSON.stringify({
    uid: user.uid,
    role,
    expiresAt: Date.now() + 60 * 60 * 1000,
  }));
  window.dispatchEvent(new StorageEvent('storage', { key: memberSessionKey }));
};

const clearMemberSessions = () => {
  window.localStorage.removeItem(memberSessionKey);
  window.localStorage.removeItem(editorialSessionKey);
  window.dispatchEvent(new StorageEvent('storage', { key: memberSessionKey }));
};

const populateCountryOptions = (select: HTMLSelectElement) => {
  if (select.options.length > 1) return;
  let displayNames: Intl.DisplayNames | undefined;
  try {
    displayNames = new Intl.DisplayNames(navigator.languages, { type: 'region' });
  } catch {
    displayNames = undefined;
  }
  const collator = new Intl.Collator(navigator.languages, { sensitivity: 'base' });
  const options = countryCodes
    .map((code) => ({ code, label: displayNames?.of(code) ?? code }))
    .sort((left, right) => collator.compare(left.label, right.label));
  for (const { code, label } of options) {
    const option = document.createElement('option');
    option.value = code;
    option.textContent = label;
    select.append(option);
  }
};

export const initializeComments = () => {
  const root = document.querySelector<HTMLElement>('[data-comments]');
  if (!root || root.dataset.initialized === 'true') return;
  root.dataset.initialized = 'true';

  const articleSlug = root.dataset.articleSlug ?? '';
  const find = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector);
  const list = find<HTMLElement>('[data-comments-list]');
  const count = find<HTMLElement>('[data-comments-count]');
  const notice = find<HTMLElement>('[data-comments-notice]');
  const signedOut = find<HTMLElement>('[data-comments-signed-out]');
  const signInButton = find<HTMLButtonElement>('[data-comments-signin]');
  const member = find<HTMLElement>('[data-comments-member]');
  const memberName = find<HTMLElement>('[data-comments-member-name]');
  const memberRole = find<HTMLElement>('[data-comments-member-role]');
  const signOutButton = find<HTMLButtonElement>('[data-comments-signout]');
  const composer = find<HTMLFormElement>('[data-comments-composer]');
  const body = find<HTMLTextAreaElement>('[data-comments-body]');
  const submit = find<HTMLButtonElement>('[data-comments-submit]');
  const characterCount = find<HTMLElement>('[data-comments-character-count]');
  const viewOnly = find<HTMLElement>('[data-comments-view-only]');
  const profileForm = find<HTMLFormElement>('[data-comments-profile]');
  const profileRole = find<HTMLSelectElement>('[data-comments-profile-role]');
  const profileInterest = find<HTMLSelectElement>('[data-comments-profile-interest]');
  const profileCountry = find<HTMLSelectElement>('[data-comments-profile-country]');
  const profileSubmit = find<HTMLButtonElement>('[data-comments-profile-submit]');

  if (!articleSlug || !list || !count || !notice) return;

  let currentUser: User | null = null;
  let currentRole: MemberRole | null = null;
  let comments: CommentRecord[] = [];
  let ownedCommentIds = new Set<string>();
  let likedCommentIds = new Set<string>();

  const setNotice = (message = '', isError = false) => {
    notice.textContent = message;
    notice.hidden = message.length === 0;
    notice.toggleAttribute('data-error', isError);
  };

  if (!isConfigured) {
    list.innerHTML = '<p class="comments-empty">Comments are unavailable because sign-in has not been configured.</p>';
    count.textContent = 'Unavailable';
    if (signedOut) signedOut.hidden = true;
    return;
  }

  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  const auth = getAuth(app);
  const db = getFirestore(app);
  const commentsRef = collection(db, 'publishedContent', articleSlug, 'comments');
  const commentOwnersRef = collection(db, 'publishedContent', articleSlug, 'commentOwners');
  const commentLikesRef = collection(db, 'publishedContent', articleSlug, 'commentLikes');

  const formatDate = (timestamp?: Timestamp | null) => {
    if (!timestamp) return 'Just now';
    return new Intl.DateTimeFormat(navigator.languages, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(timestamp.toDate());
  };

  const makeButton = (label: string, action: () => void | Promise<void>) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => void action());
    return button;
  };

  const addComment = async (commentBody: string, parentId = '') => {
    if (!currentUser || !currentRole || currentRole === 'viewer') throw new Error('Sign in with commenting access first.');
    const value = commentBody.trim();
    if (!value || value.length > 5000) throw new Error('Comments must be between 1 and 5,000 characters.');
    const commentRef = doc(commentsRef);
    const ownerRef = doc(commentOwnersRef, commentRef.id);
    const batch = writeBatch(db);
    batch.set(commentRef, {
      articleSlug,
      parentId,
      body: value,
      authorName: currentUser.displayName ?? '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      edited: false,
      deleted: false,
      deletedAt: null,
      likeCount: 0,
      pinned: false,
      pinnedAt: null,
    });
    batch.set(ownerRef, {
      commentId: commentRef.id,
      authorUid: currentUser.uid,
      createdAt: serverTimestamp(),
    });
    await batch.commit();
    ownedCommentIds.add(commentRef.id);
  };

  const showReplyForm = (container: HTMLElement, parentId: string) => {
    root.querySelectorAll('.comment-reply-form').forEach((form) => form.remove());
    const form = document.createElement('form');
    form.className = 'comment-reply-form';
    const textarea = document.createElement('textarea');
    textarea.rows = 3;
    textarea.maxLength = 5000;
    textarea.required = true;
    textarea.placeholder = 'Write a reply…';
    textarea.setAttribute('aria-label', 'Reply');
    const actions = document.createElement('div');
    actions.className = 'comment-form-actions';
    const cancel = makeButton('Cancel', () => form.remove());
    cancel.className = 'comments-link-button';
    const post = document.createElement('button');
    post.className = 'comments-button';
    post.type = 'submit';
    post.textContent = 'Post reply';
    actions.append(cancel, post);
    form.append(textarea, actions);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      post.disabled = true;
      try {
        await addComment(textarea.value, parentId);
        form.remove();
        await loadComments();
        setNotice('Reply posted.');
      } catch (error) {
        post.disabled = false;
        setNotice(error instanceof Error ? error.message : 'The reply could not be posted.', true);
      }
    });
    container.append(form);
    textarea.focus();
  };

  const showEditForm = (container: HTMLElement, comment: CommentRecord) => {
    const bodyElement = container.querySelector<HTMLElement>('.comment-body');
    const actionsElement = container.querySelector<HTMLElement>('.comment-actions');
    if (!bodyElement || !actionsElement) return;
    bodyElement.hidden = true;
    actionsElement.hidden = true;
    const form = document.createElement('form');
    form.className = 'comment-editor';
    const textarea = document.createElement('textarea');
    textarea.rows = 3;
    textarea.maxLength = 5000;
    textarea.required = true;
    textarea.value = comment.body;
    textarea.setAttribute('aria-label', 'Edit comment');
    const formActions = document.createElement('div');
    formActions.className = 'comment-form-actions';
    const cancel = makeButton('Cancel', () => {
      form.remove();
      bodyElement.hidden = false;
      actionsElement.hidden = false;
    });
    cancel.className = 'comments-link-button';
    const save = document.createElement('button');
    save.className = 'comments-button';
    save.type = 'submit';
    save.textContent = 'Save changes';
    formActions.append(cancel, save);
    form.append(textarea, formActions);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const value = textarea.value.trim();
      if (!value) return;
      save.disabled = true;
      try {
        await updateDoc(doc(commentsRef, comment.id), {
          body: value,
          edited: true,
          updatedAt: serverTimestamp(),
        });
        await loadComments();
        setNotice('Comment updated.');
      } catch (error) {
        save.disabled = false;
        setNotice(error instanceof Error ? error.message : 'The comment could not be updated.', true);
      }
    });
    container.append(form);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  };

  const deleteComment = async (comment: CommentRecord) => {
    if (!window.confirm('Delete this comment? Replies will remain visible.')) return;
    try {
      await updateDoc(doc(commentsRef, comment.id), {
        body: '',
        deleted: true,
        deletedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        pinned: false,
        pinnedAt: null,
      });
      await loadComments();
      setNotice('Comment deleted.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The comment could not be deleted.', true);
    }
  };

  const toggleLike = async (comment: CommentRecord) => {
    if (!currentUser || !currentRole || currentRole === 'viewer') {
      setNotice('Sign in with commenting access to like a comment.');
      return;
    }
    const likeId = `${comment.id}_${currentUser.uid}`;
    const likeRef = doc(commentLikesRef, likeId);
    const commentRef = doc(commentsRef, comment.id);
    const batch = writeBatch(db);
    const liked = likedCommentIds.has(comment.id);
    if (liked) {
      batch.delete(likeRef);
      batch.update(commentRef, { likeCount: increment(-1) });
    } else {
      batch.set(likeRef, {
        commentId: comment.id,
        userUid: currentUser.uid,
        createdAt: serverTimestamp(),
      });
      batch.update(commentRef, { likeCount: increment(1) });
    }
    try {
      await batch.commit();
      if (liked) likedCommentIds.delete(comment.id);
      else likedCommentIds.add(comment.id);
      await loadComments();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The like could not be updated.', true);
    }
  };

  const togglePin = async (comment: CommentRecord) => {
    if (!currentRole || !['administrator', 'publisher'].includes(currentRole) || comment.parentId !== '') return;
    try {
      await updateDoc(doc(commentsRef, comment.id), {
        pinned: !comment.pinned,
        pinnedAt: comment.pinned ? null : serverTimestamp(),
      });
      await loadComments();
      setNotice(comment.pinned ? 'Comment unpinned.' : 'Comment pinned.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The pin could not be updated.', true);
    }
  };

  const renderComment = (comment: CommentRecord, rootId: string, isReply = false) => {
    const container = document.createElement('article');
    container.className = isReply ? 'comment-reply' : 'comment-thread';
    container.dataset.commentId = comment.id;

    const meta = document.createElement('div');
    meta.className = 'comment-meta';
    const author = document.createElement('span');
    author.className = 'comment-author';
    author.textContent = comment.authorName || 'Member';
    const date = document.createElement('time');
    date.className = 'comment-date';
    date.textContent = formatDate(comment.createdAt);
    if (comment.createdAt) date.dateTime = comment.createdAt.toDate().toISOString();
    meta.append(author, date);
    if (comment.pinned && !comment.deleted) {
      const pinned = document.createElement('span');
      pinned.className = 'comment-pinned';
      pinned.textContent = 'Pinned';
      meta.append(pinned);
    }
    if (comment.edited && !comment.deleted) {
      const edited = document.createElement('span');
      edited.className = 'comment-edited';
      edited.textContent = 'Edited';
      meta.append(edited);
    }

    const commentBody = document.createElement('p');
    commentBody.className = 'comment-body';
    commentBody.textContent = comment.deleted ? 'This comment was deleted.' : comment.body;
    commentBody.classList.toggle('is-deleted', comment.deleted);
    container.append(meta, commentBody);

    const canWrite = Boolean(currentUser && currentRole && currentRole !== 'viewer');
    const ownsComment = ownedCommentIds.has(comment.id);
    const canDelete = Boolean(!comment.deleted && currentUser && (ownsComment || currentRole === 'administrator'));
    const canEdit = Boolean(!comment.deleted && currentUser && (ownsComment || currentRole === 'administrator'));
    const canPin = Boolean(!comment.deleted && comment.parentId === '' && ['administrator', 'publisher'].includes(currentRole ?? ''));
    if (!comment.deleted || canEdit || canDelete || canPin) {
      const actions = document.createElement('div');
      actions.className = 'comment-actions';
      if (canWrite && !comment.deleted) actions.append(makeButton('Reply', () => showReplyForm(container, rootId)));
      if (!comment.deleted) {
        const likeLabel = likedCommentIds.has(comment.id) ? 'Unlike' : 'Like';
        const likeCount = Number.isInteger(comment.likeCount) ? comment.likeCount : 0;
        const likeButton = makeButton(`${likeLabel}${likeCount > 0 ? ` · ${likeCount}` : ''}`, () => toggleLike(comment));
        likeButton.disabled = !canWrite;
        actions.append(likeButton);
      }
      if (canEdit) actions.append(makeButton('Edit', () => showEditForm(container, comment)));
      if (canDelete) actions.append(makeButton('Delete', () => deleteComment(comment)));
      if (canPin) actions.append(makeButton(comment.pinned ? 'Unpin' : 'Pin', () => togglePin(comment)));
      container.append(actions);
    }
    return container;
  };

  const renderComments = () => {
    list.replaceChildren();
    const visibleCount = comments.filter((comment) => !comment.deleted).length;
    count.textContent = `${visibleCount} ${visibleCount === 1 ? 'comment' : 'comments'}`;
    if (comments.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'comments-empty';
      empty.textContent = 'No comments yet. Start the conversation.';
      list.append(empty);
      return;
    }

    const roots = comments
      .filter((comment) => comment.parentId === '')
      .sort((left, right) => Number(right.pinned && !right.deleted) - Number(left.pinned && !left.deleted));
    const rootIds = new Set(roots.map((comment) => comment.id));
    for (const orphan of comments.filter((comment) => comment.parentId && !rootIds.has(comment.parentId))) roots.push(orphan);
    for (const rootComment of roots) {
      const rootElement = renderComment(rootComment, rootComment.id);
      const replies = comments.filter((comment) => comment.parentId === rootComment.id);
      if (replies.length > 0) {
        const replyList = document.createElement('div');
        replyList.className = 'comment-replies';
        for (const reply of replies) replyList.append(renderComment(reply, rootComment.id, true));
        rootElement.append(replyList);
      }
      list.append(rootElement);
    }
  };

  const loadComments = async () => {
    try {
      const snapshot = await getDocs(query(commentsRef, orderBy('createdAt', 'asc'), limit(200)));
      comments = snapshot.docs.map((comment) => ({
        id: comment.id,
        ...(comment.data() as Omit<CommentRecord, 'id'>),
      }));
      renderComments();
    } catch (error) {
      console.error('[comments] load failed', error);
      list.innerHTML = '<p class="comments-empty">Comments could not be loaded. Please try again later.</p>';
      count.textContent = 'Unavailable';
    }
  };

  const loadOwnedCommentIds = async (user: User) => {
    const snapshot = await getDocs(query(
      commentOwnersRef,
      where('authorUid', '==', user.uid),
      limit(200),
    ));
    ownedCommentIds = new Set(snapshot.docs.map((owner) => owner.id));
  };

  const loadLikedCommentIds = async (user: User) => {
    const snapshot = await getDocs(query(
      commentLikesRef,
      where('userUid', '==', user.uid),
      limit(200),
    ));
    likedCommentIds = new Set(snapshot.docs.map((like) => String(like.data().commentId ?? '')));
  };

  const requestProfileChoices = (): Promise<ProfileChoices> => {
    if (!profileForm || !profileRole || !profileInterest || !profileCountry || !profileSubmit) {
      return Promise.reject(new Error('The member profile form is unavailable.'));
    }
    populateCountryOptions(profileCountry);
    if (signedOut) signedOut.hidden = true;
    profileForm.hidden = false;
    return new Promise((resolve) => {
      const handleSubmit = (event: SubmitEvent) => {
        event.preventDefault();
        const countryCode = profileCountry.value;
        if (
          !professionalRoleValues.has(profileRole.value)
          || !primaryInterestValues.has(profileInterest.value)
          || (countryCode !== '' && !countryCodeValues.has(countryCode))
        ) {
          setNotice('Choose a listed option for each field.', true);
          return;
        }
        profileSubmit.disabled = true;
        profileSubmit.textContent = 'Saving…';
        profileForm.removeEventListener('submit', handleSubmit);
        profileForm.hidden = true;
        resolve({
          professionalRole: profileRole.value,
          primaryInterest: profileInterest.value,
          countryCode,
          profileCompletedAt: new Date().toISOString(),
        });
      };
      profileForm.addEventListener('submit', handleSubmit);
    });
  };

  const ensureProfile = async (user: User) => {
    const profileRef = doc(db, 'userProfiles', user.uid);
    const existing = await getDoc(profileRef);
    const data = existing.exists() ? existing.data() : undefined;
    const complete = data
      && typeof data.profileCompletedAt === 'string'
      && professionalRoleValues.has(data.professionalRole)
      && primaryInterestValues.has(data.primaryInterest)
      && (data.countryCode === '' || countryCodeValues.has(data.countryCode));
    const choices: ProfileChoices = complete
      ? {
          professionalRole: data.professionalRole,
          primaryInterest: data.primaryInterest,
          countryCode: data.countryCode,
          profileCompletedAt: data.profileCompletedAt,
        }
      : await requestProfileChoices();
    const now = new Date().toISOString();
    await setDoc(profileRef, {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName ?? '',
      providerIds: user.providerData.map((provider) => provider.providerId),
      ...choices,
      firstSeenAt: data?.firstSeenAt ?? now,
      lastSeenAt: now,
      privacyNoticeVersion: '2026-08-16',
    });
  };

  const ensureAccess = async (user: User): Promise<MemberRole> => {
    const accessRef = doc(db, 'studioAccess', user.uid);
    let access = await getDoc(accessRef);
    if (!access.exists()) {
      const invite = await getDoc(doc(db, 'studioInvites', user.email ?? ''));
      const invitedRole = invite.exists() ? invite.data().role : undefined;
      const initialRole = invite.exists() && invite.data().active === true && roles.has(invitedRole)
        ? invitedRole as MemberRole
        : 'commenter';
      await setDoc(accessRef, {
        active: true,
        role: initialRole,
        email: user.email,
        claimedAt: new Date().toISOString(),
      });
      access = await getDoc(accessRef);
    }
    const role = access.data()?.role;
    if (access.data()?.active !== true || !roles.has(role)) throw new Error('This account does not have an active role.');
    return role as MemberRole;
  };

  const showSignedOut = () => {
    currentUser = null;
    currentRole = null;
    ownedCommentIds = new Set();
    likedCommentIds = new Set();
    if (signedOut) signedOut.hidden = false;
    if (member) member.hidden = true;
    if (composer) composer.hidden = true;
    if (viewOnly) viewOnly.hidden = true;
    if (profileForm) profileForm.hidden = true;
    renderComments();
  };

  body?.addEventListener('input', () => {
    if (characterCount) characterCount.textContent = `${body.value.length.toLocaleString()} / 5,000`;
  });

  composer?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!body || !submit) return;
    submit.disabled = true;
    setNotice();
    try {
      await addComment(body.value);
      body.value = '';
      if (characterCount) characterCount.textContent = '0 / 5,000';
      await loadComments();
      setNotice('Comment posted.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The comment could not be posted.', true);
    } finally {
      submit.disabled = false;
    }
  });

  signInButton?.addEventListener('click', async () => {
    signInButton.disabled = true;
    setNotice('Choose your Google account to continue.');
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await signInWithPopup(auth, provider);
    } catch (error) {
      signInButton.disabled = false;
      setNotice(signInErrorMessage(error), true);
    }
  });

  signOutButton?.addEventListener('click', async () => {
    await signOut(auth);
    clearMemberSessions();
    setNotice('Signed out.');
  });

  void setPersistence(auth, browserLocalPersistence).then(() => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        clearMemberSessions();
        showSignedOut();
        if (signInButton) signInButton.disabled = false;
        return;
      }
      if (!user.email || !user.emailVerified) {
        setNotice('A verified Google email address is required.', true);
        return;
      }
      try {
        const role = await ensureAccess(user);
        await ensureProfile(user);
        currentUser = user;
        currentRole = role;
        await Promise.all([loadOwnedCommentIds(user), loadLikedCommentIds(user)]);
        rememberMemberSession(user, role);
        if (signedOut) signedOut.hidden = true;
        if (member) member.hidden = false;
        if (memberName) memberName.textContent = user.displayName || user.email;
        if (memberRole) memberRole.textContent = `· ${roleLabel(role)}`;
        if (composer) composer.hidden = role === 'viewer';
        if (viewOnly) viewOnly.hidden = role !== 'viewer';
        if (profileSubmit) {
          profileSubmit.disabled = false;
          profileSubmit.textContent = 'Continue';
        }
        setNotice();
        renderComments();
      } catch (error) {
        console.error('[comments] account setup failed', error);
        setNotice(error instanceof Error ? error.message : 'Your account could not be prepared for comments.', true);
      }
    });
  });

  void loadComments();
};
