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
  deleteDoc,
  updateDoc,
  where,
  writeBatch,
  type Timestamp,
} from 'firebase/firestore';
import {
  countryCodeValues,
  populateCountryOptions,
  primaryInterestValues,
  professionalRoleValues,
} from '../data/member-profile';
import {
  CONTROLLED_TOPICS,
  canAdminRemove,
  canCloseDiscussion,
  canCloseGroup,
  canCreateGroup,
  canUseMemberState,
  canDeleteOwnPost,
  canEditPost,
  canJoinGroup,
  canLeaveGroup,
  canLike,
  canPinDiscussion,
  canPost,
  canStartDiscussion,
  isValidGroupName,
  isValidPostBody,
  isValidReason,
  isValidTitle,
  isAllowedFeedActivity,
  memberStateId,
  parseCommunityPath,
  slugifyGroupName,
  type FollowTargetType,
  type MemberRole,
} from './community-access';
import { getFirebaseClientApp, isFirebaseConfigured } from './firebase-client';

type GroupRecord = {
  id: string;
  name: string;
  slug: string;
  description: string;
  access: string;
  createdByUid: string;
  memberCount: number;
  closed: boolean;
  topics: string[];
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
};

type DiscussionRecord = {
  id: string;
  groupId: string;
  title: string;
  createdByUid: string;
  createdByName: string;
  createdAt?: Timestamp | null;
  lastActivityAt?: Timestamp | null;
  replyCount: number;
  pinned: boolean;
  closed: boolean;
  topics: string[];
};

type PostRecord = {
  id: string;
  discussionId: string;
  groupId: string;
  parentId: string;
  body: string;
  authorName: string;
  authorUid: string;
  createdAt?: Timestamp | null;
  edited: boolean;
  deleted: boolean;
  likeCount: number;
};

const roles = new Set<MemberRole>(['administrator', 'publisher', 'author', 'commenter', 'viewer']);
const memberSessionKey = 'aispanda-member-session-v1';
const editorialSessionKey = 'aispanda-studio-authorized-session-v1';

const roleLabel = (role: MemberRole) => (role === 'viewer' ? 'View Only' : role[0].toUpperCase() + role.slice(1));

const escapeHtml = (value: unknown) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

const timestampMillis = (timestamp?: Timestamp | null) => timestamp?.toMillis?.() ?? 0;

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

const formatDate = (timestamp?: Timestamp | null) => {
  if (!timestamp) return 'Just now';
  return new Intl.DateTimeFormat(navigator.languages, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp.toDate());
};

const topicOptions = () => CONTROLLED_TOPICS.map((topic) => `<option value="${topic}">${topic}</option>`).join('');

export const initializeCommunity = () => {
  const root = document.querySelector<HTMLElement>('[data-community]');
  if (!root || root.dataset.initialized === 'true') return;
  root.dataset.initialized = 'true';

  const route = parseCommunityPath(window.location.pathname);
  const page = route.page;
  const groupId = route.groupId;
  const discussionId = route.discussionId;
  const find = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector);
  const notice = find<HTMLElement>('[data-community-notice]');
  const signedOut = find<HTMLElement>('[data-community-signed-out]');
  const signInButton = find<HTMLButtonElement>('[data-community-signin]');
  const memberBox = find<HTMLElement>('[data-community-member]');
  const memberName = find<HTMLElement>('[data-community-member-name]');
  const memberRole = find<HTMLElement>('[data-community-member-role]');
  const signOutButton = find<HTMLButtonElement>('[data-community-signout]');
  const viewOnly = find<HTMLElement>('[data-community-view-only]');
  const profileForm = find<HTMLFormElement>('[data-community-profile]');
  const profileRole = find<HTMLSelectElement>('[data-community-profile-role]');
  const profileInterest = find<HTMLSelectElement>('[data-community-profile-interest]');
  const profileCountry = find<HTMLSelectElement>('[data-community-profile-country]');
  const profileSubmit = find<HTMLButtonElement>('[data-community-profile-submit]');
  const main = find<HTMLElement>('[data-community-main]');

  const setNotice = (message = '', isError = false) => {
    if (!notice) return;
    notice.textContent = message;
    notice.hidden = message.length === 0;
    notice.toggleAttribute('data-error', isError);
  };

  if (!isFirebaseConfigured) {
    if (main) main.innerHTML = '<p class="community-empty">Community is unavailable because sign-in has not been configured.</p>';
    if (signedOut) signedOut.hidden = true;
    return;
  }

  const app = getFirebaseClientApp();
  const auth = getAuth(app);
  const db = getFirestore(app);
  const groupsRef = collection(db, 'communityGroups');
  const membersRef = collection(db, 'communityGroupMembers');
  const discussionsRef = collection(db, 'communityDiscussions');
  const postsRef = collection(db, 'communityPosts');
  const ownersRef = collection(db, 'communityPostOwners');
  const likesRef = collection(db, 'communityPostLikes');
  const moderationRef = collection(db, 'communityModerationActions');
  const bookmarksRef = collection(db, 'communityDiscussionBookmarks');
  const followsRef = collection(db, 'communityFollows');
  const readStatesRef = collection(db, 'communityDiscussionReadStates');

  let currentUser: User | null = null;
  let currentRole: MemberRole | null = null;
  let isMember = false;
  let group: GroupRecord | null = null;
  let discussion: DiscussionRecord | null = null;
  let posts: PostRecord[] = [];
  let ownedPostIds = new Set<string>();
  let likedPostIds = new Set<string>();
  let bookmarkedDiscussionIds = new Set<string>();
  let followedTargets = new Set<string>();
  let openedAtByDiscussion = new Map<string, number>();

  const memberDocId = (id: string, uid: string) => `${id}_${uid}`;
  const likeDocId = (postId: string, uid: string) => `${postId}_${uid}`;
  const stateId = (kind: string, targetId: string) => memberStateId(currentUser?.uid ?? '', kind, targetId);
  const followKey = (kind: FollowTargetType, targetId: string) => `${kind}:${targetId}`;
  const isFollowed = (kind: FollowTargetType, targetId: string) => followedTargets.has(followKey(kind, targetId));

  const loadMemberState = async (user: User) => {
    if (!canUseMemberState(currentRole)) return;
    const readPrivateState = async (label: string, read: () => Promise<Awaited<ReturnType<typeof getDocs>>>) => {
      try {
        return await read();
      } catch (error) {
        console.warn(`[community] ${label} is unavailable until the latest Firestore rules are deployed.`, error);
        return null;
      }
    };
    const [bookmarks, follows, reads] = await Promise.all([
      readPrivateState('Bookmarks', () => getDocs(query(bookmarksRef, where('uid', '==', user.uid), limit(200)))),
      readPrivateState('Follows', () => getDocs(query(followsRef, where('uid', '==', user.uid), limit(300)))),
      readPrivateState('Read state', () => getDocs(query(readStatesRef, where('uid', '==', user.uid), limit(300)))),
    ]);
    bookmarkedDiscussionIds = new Set((bookmarks?.docs ?? []).map((item) => String(item.data().discussionId ?? '')));
    followedTargets = new Set((follows?.docs ?? []).map((item) => followKey(
      String(item.data().targetType ?? '') as FollowTargetType,
      String(item.data().targetId ?? ''),
    )));
    openedAtByDiscussion = new Map((reads?.docs ?? []).map((item) => [
      String(item.data().discussionId ?? ''),
      timestampMillis(item.data().lastOpenedAt as Timestamp | null),
    ]));
  };

  const queueFollow = (batch: ReturnType<typeof writeBatch>, kind: FollowTargetType, targetId: string) => {
    if (!currentUser || isFollowed(kind, targetId)) return;
    batch.set(doc(followsRef, stateId(kind, targetId)), {
      uid: currentUser.uid,
      targetType: kind,
      targetId,
      createdAt: serverTimestamp(),
    });
  };

  const toggleFollow = async (kind: FollowTargetType, targetId: string) => {
    if (!currentUser || !canUseMemberState(currentRole)) return;
    const key = followKey(kind, targetId);
    const ref = doc(followsRef, stateId(kind, targetId));
    if (followedTargets.has(key)) {
      await deleteDoc(ref);
      followedTargets.delete(key);
    } else {
      await setDoc(ref, {
        uid: currentUser.uid,
        targetType: kind,
        targetId,
        createdAt: serverTimestamp(),
      });
      followedTargets.add(key);
    }
  };

  const toggleBookmark = async (discussionIdToToggle: string) => {
    if (!currentUser || !canUseMemberState(currentRole)) return;
    const ref = doc(bookmarksRef, stateId('bookmark', discussionIdToToggle));
    if (bookmarkedDiscussionIds.has(discussionIdToToggle)) {
      await deleteDoc(ref);
      bookmarkedDiscussionIds.delete(discussionIdToToggle);
    } else {
      await setDoc(ref, {
        uid: currentUser.uid,
        discussionId: discussionIdToToggle,
        createdAt: serverTimestamp(),
      });
      bookmarkedDiscussionIds.add(discussionIdToToggle);
    }
  };

  const markDiscussionOpened = async (discussionIdToMark: string) => {
    if (!currentUser || !canUseMemberState(currentRole)) return;
    openedAtByDiscussion.set(discussionIdToMark, Date.now());
    await setDoc(doc(readStatesRef, stateId('read', discussionIdToMark)), {
      uid: currentUser.uid,
      discussionId: discussionIdToMark,
      lastOpenedAt: serverTimestamp(),
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
    if (complete) return;
    if (!profileForm || !profileRole || !profileInterest || !profileCountry || !profileSubmit) {
      throw new Error('The member profile form is unavailable.');
    }
    populateCountryOptions(profileCountry);
    if (signedOut) signedOut.hidden = true;
    profileForm.hidden = false;
    const choices = await new Promise<{ professionalRole: string; primaryInterest: string; countryCode: string; profileCompletedAt: string }>((resolve) => {
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
    let accessDoc = await getDoc(accessRef);
    if (!accessDoc.exists()) {
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
      accessDoc = await getDoc(accessRef);
    }
    const role = accessDoc.data()?.role;
    if (accessDoc.data()?.active !== true || !roles.has(role)) throw new Error('This account does not have an active role.');
    return role as MemberRole;
  };

  const loadOwnedAndLiked = async (user: User) => {
    if (page !== 'discussion' || !discussionId) return;
    const [owners, likes] = await Promise.all([
      getDocs(query(ownersRef, where('authorUid', '==', user.uid), limit(200))),
      getDocs(query(likesRef, where('userUid', '==', user.uid), limit(200))),
    ]);
    ownedPostIds = new Set(owners.docs.map((item) => item.id));
    likedPostIds = new Set(likes.docs.map((item) => String(item.data().postId ?? '')));
  };

  const renderInbox = async (groups: GroupRecord[]) => {
    const followedGroups = new Set([...followedTargets]
      .filter((item) => item.startsWith('group:'))
      .map((item) => item.slice('group:'.length)));
    const followedDiscussions = new Set([...followedTargets]
      .filter((item) => item.startsWith('discussion:'))
      .map((item) => item.slice('discussion:'.length)));
    const followedPeople = new Set([...followedTargets]
      .filter((item) => item.startsWith('person:'))
      .map((item) => item.slice('person:'.length)));
    const hasFollows = followedGroups.size + followedDiscussions.size + followedPeople.size > 0;
    if (!hasFollows) {
      return '<section class="community-inbox"><h2>Your inbox</h2><p class="community-hint">Follow a Group, Discussion, or person to see allowed new activity here. Following is private; the person you follow is not notified.</p></section>';
    }
    const visibleGroupIds = new Set(groups.map((item) => item.id));
    const snapshot = await getDocs(query(postsRef, orderBy('createdAt', 'desc'), limit(50)));
    const activities = snapshot.docs
      .map((item) => ({ id: item.id, ...(item.data() as Omit<PostRecord, 'id'>) }))
      .filter((item) => visibleGroupIds.has(item.groupId))
      .filter((item) => isAllowedFeedActivity({
        followedGroups,
        followedDiscussions,
        followedPeople,
        groupId: item.groupId,
        discussionId: item.discussionId,
        authorUid: item.authorUid,
        deleted: item.deleted,
      }))
      .slice(0, 12);
    const body = activities.length === 0
      ? '<p class="community-hint">Nothing new from the Groups, Discussions, or people you follow.</p>'
      : `<ul class="community-inbox-list">${activities.map((item) => `
          <li><a href="/community/${escapeHtml(item.groupId)}/${escapeHtml(item.discussionId)}">
            <strong>${escapeHtml(item.authorName || 'Member')} posted in a Discussion</strong>
            <span>${escapeHtml(item.body.slice(0, 160))}${item.body.length > 160 ? '…' : ''}</span>
          </a></li>`).join('')}</ul>`;
    return `<section class="community-inbox"><h2>Your inbox</h2><p class="community-hint">Private activity from things you follow. No email and no notification is sent to people you follow.</p>${body}</section>`;
  };

  const renderLanding = async () => {
    if (!main) return;
    const snapshot = await getDocs(query(groupsRef, orderBy('updatedAt', 'desc'), limit(50)));
    const groups = snapshot.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<GroupRecord, 'id'>) }));
    const canCreate = canCreateGroup(currentRole);
    const list = groups.length === 0
      ? '<p class="community-empty">No Groups yet. An Administrator or Publisher can create the first one.</p>'
      : `<ul class="community-list">${groups.map((item) => `
          <li>
            <a href="/community/${item.id}">
              <strong>${item.name}</strong>
              <span>${item.closed ? 'Closed' : 'Open to members'} · ${item.memberCount} ${item.memberCount === 1 ? 'member' : 'members'}</span>
              <p>${item.description || ''}</p>
            </a>
          </li>`).join('')}</ul>`;
    const form = canCreate ? `
      <form class="community-composer" data-create-group>
        <h2>Create a Group</h2>
        <label>Name <input name="name" maxlength="80" required></label>
        <label>Purpose <textarea name="description" rows="3" maxlength="500"></textarea></label>
        <label>Topic
          <select name="topic">
            <option value="">None</option>
            ${topicOptions()}
          </select>
        </label>
        <button class="community-button" type="submit">Create Group</button>
      </form>` : '';
    main.innerHTML = `${await renderInbox(groups)}<h2>Groups</h2>${list}${form}`;
    main.insertAdjacentHTML('afterbegin', `
      <div class="community-toolbar">
        <label>Find a Group <input type="search" data-group-search placeholder="Search Groups" maxlength="80"></label>
        <label>Sort <select data-group-sort><option value="recent">Recently active</option><option value="name">Name</option></select></label>
      </div>`);
    const groupList = main.querySelector<HTMLUListElement>('.community-list');
    const groupEntries = groups.map((item, index) => ({ item, element: groupList?.children[index] as HTMLElement | undefined }));
    groupEntries.forEach(({ item, element }) => {
      if (!element) return;
      const follow = document.createElement('button');
      follow.type = 'button';
      follow.className = 'community-link-button';
      follow.dataset.followGroup = item.id;
      follow.textContent = isFollowed('group', item.id) ? 'Following' : 'Follow Group';
      follow.addEventListener('click', async () => {
        await toggleFollow('group', item.id);
        follow.textContent = isFollowed('group', item.id) ? 'Following' : 'Follow Group';
        setNotice(isFollowed('group', item.id) ? 'You are following this Group.' : 'You unfollowed this Group.');
        if (main) main.querySelector<HTMLElement>('.community-inbox')?.replaceWith(document.createRange().createContextualFragment(await renderInbox(groups)));
      });
      element.append(follow);
    });
    const groupSearch = main.querySelector<HTMLInputElement>('[data-group-search]');
    const groupSort = main.querySelector<HTMLSelectElement>('[data-group-sort]');
    const rerenderGroups = () => {
      const term = groupSearch?.value.trim().toLowerCase() ?? '';
      const sorted = [...groupEntries].sort((left, right) => groupSort?.value === 'name'
        ? left.item.name.localeCompare(right.item.name)
        : timestampMillis(right.item.updatedAt as Timestamp | null) - timestampMillis(left.item.updatedAt as Timestamp | null));
      sorted.forEach(({ item, element }) => {
        if (!element || !groupList) return;
        element.hidden = !`${item.name} ${item.description}`.toLowerCase().includes(term);
        groupList.append(element);
      });
    };
    groupSearch?.addEventListener('input', rerenderGroups);
    groupSort?.addEventListener('change', rerenderGroups);
    const createForm = main.querySelector<HTMLFormElement>('[data-create-group]');
    createForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!currentUser || !currentRole) return;
      const data = new FormData(createForm);
      const name = String(data.get('name') ?? '');
      const description = String(data.get('description') ?? '').trim();
      const topic = String(data.get('topic') ?? '');
      if (!isValidGroupName(name)) {
        setNotice('Enter a Group name up to 80 characters.', true);
        return;
      }
      try {
        const groupRef = doc(groupsRef);
        const memberRef = doc(membersRef, memberDocId(groupRef.id, currentUser.uid));
        const batch = writeBatch(db);
        batch.set(groupRef, {
          name: name.trim(),
          slug: slugifyGroupName(name) || groupRef.id,
          description,
          access: 'open',
          createdByUid: currentUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          memberCount: 1,
          closed: false,
          closedAt: null,
          topics: topic ? [topic] : [],
        });
        batch.set(memberRef, {
          groupId: groupRef.id,
          uid: currentUser.uid,
          joinedAt: serverTimestamp(),
        });
        await batch.commit();
        window.location.href = `/community/${groupRef.id}`;
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'The Group could not be created.', true);
      }
    });
  };

  const loadGroup = async () => {
    const snap = await getDoc(doc(groupsRef, groupId));
    if (!snap.exists()) throw new Error('This Group was not found.');
    group = { id: snap.id, ...(snap.data() as Omit<GroupRecord, 'id'>) };
    if (currentUser) {
      const member = await getDoc(doc(membersRef, memberDocId(groupId, currentUser.uid)));
      isMember = member.exists();
    } else {
      isMember = false;
    }
  };

  const renderGroup = async () => {
    if (!main || !group || !currentRole) return;
    const snapshot = await getDocs(query(discussionsRef, where('groupId', '==', groupId), limit(100)));
    const discussions = snapshot.docs
      .map((item) => ({ id: item.id, ...(item.data() as Omit<DiscussionRecord, 'id'>) }))
      .sort((left, right) => Number(right.pinned) - Number(left.pinned)
        || (right.lastActivityAt?.toMillis() ?? 0) - (left.lastActivityAt?.toMillis() ?? 0));
    const joinable = canJoinGroup({ role: currentRole, access: group.access, closed: group.closed, isMember });
    const leavable = canLeaveGroup({ isMember });
    const canStart = canStartDiscussion({ role: currentRole, isMember, groupClosed: group.closed });
    const list = discussions.length === 0
      ? '<p class="community-empty">No Discussions yet. Start one with a clear title.</p>'
      : `<ul class="community-list">${discussions.map((item) => `
          <li>
            <a href="/community/${groupId}/${item.id}">
              <strong>${item.title}</strong>
              <span>${item.pinned ? 'Pinned · ' : ''}${item.closed ? 'Closed · ' : ''}${item.replyCount} ${item.replyCount === 1 ? 'reply' : 'replies'} · ${formatDate(item.lastActivityAt)}</span>
            </a>
          </li>`).join('')}</ul>`;
    main.innerHTML = `
      <header class="community-group-head">
        <p class="eyebrow">Group</p>
        <h1>${group.name}</h1>
        <p>${group.description || 'Open to members.'}</p>
        <p class="community-meta">${group.closed ? 'Closed' : 'Open to members'} · ${group.memberCount} ${group.memberCount === 1 ? 'member' : 'members'}</p>
        <div class="community-actions">
          ${joinable ? '<button class="community-button" type="button" data-join>Join Group</button>' : ''}
          ${leavable ? '<button class="community-link-button" type="button" data-leave>Leave Group</button>' : ''}
          ${canCloseGroup(currentRole) ? `<button class="community-link-button" type="button" data-close-group>${group.closed ? 'Reopen Group' : 'Close Group'}</button>` : ''}
        </div>
      </header>
      <h2>Discussions</h2>
      ${list}
      ${canStart ? `
        <form class="community-composer" data-start-discussion>
          <h2>Start a discussion</h2>
          <label>Title <input name="title" maxlength="200" required></label>
          <label>Opening Post <textarea name="body" rows="4" maxlength="5000" required></textarea></label>
          <label>Topic
            <select name="topic">
              <option value="">None</option>
              ${topicOptions()}
            </select>
          </label>
          <label class="community-check"><input type="checkbox" name="follow" checked> Follow this Discussion for new activity</label>
          <button class="community-button" type="submit">Start discussion</button>
        </form>` : isMember ? '' : '<p class="community-hint">Join this Group to start a Discussion or reply.</p>'}
    `;
    const discussionHeading = [...main.querySelectorAll('h2')].find((item) => item.textContent === 'Discussions');
    discussionHeading?.insertAdjacentHTML('afterend', `
      <div class="community-toolbar">
        <label>Find a Discussion <input type="search" data-discussion-search placeholder="Search Discussions" maxlength="120"></label>
        <label>Topic <select data-discussion-topic><option value="">All topics</option>${topicOptions()}</select></label>
        <label>Sort <select data-discussion-sort><option value="recent">Recent activity</option><option value="oldest">Oldest first</option><option value="discussed">Most discussed</option></select></label>
      </div>`);
    const discussionList = main.querySelector<HTMLUListElement>('.community-list');
    const discussionEntries = discussions.map((item, index) => ({ item, element: discussionList?.children[index] as HTMLElement | undefined }));
    discussionEntries.forEach(({ item, element }) => {
      if (!element) return;
      const details = document.createElement('div');
      details.className = 'community-list-actions';
      if (openedAtByDiscussion.get(item.id) === undefined
        || openedAtByDiscussion.get(item.id)! < timestampMillis(item.lastActivityAt as Timestamp | null)) {
        const unread = document.createElement('span');
        unread.className = 'community-unread';
        unread.textContent = 'Unread';
        details.append(unread);
      }
      const bookmark = document.createElement('button');
      bookmark.type = 'button';
      bookmark.className = 'community-link-button';
      bookmark.textContent = bookmarkedDiscussionIds.has(item.id) ? 'Bookmarked' : 'Bookmark';
      bookmark.addEventListener('click', async () => {
        await toggleBookmark(item.id);
        bookmark.textContent = bookmarkedDiscussionIds.has(item.id) ? 'Bookmarked' : 'Bookmark';
        setNotice(bookmarkedDiscussionIds.has(item.id) ? 'Discussion bookmarked privately.' : 'Discussion removed from your bookmarks.');
      });
      details.append(bookmark);
      const follow = document.createElement('button');
      follow.type = 'button';
      follow.className = 'community-link-button';
      follow.textContent = isFollowed('discussion', item.id) ? 'Following' : 'Follow';
      follow.addEventListener('click', async () => {
        await toggleFollow('discussion', item.id);
        follow.textContent = isFollowed('discussion', item.id) ? 'Following' : 'Follow';
        setNotice(isFollowed('discussion', item.id) ? 'You are following this Discussion.' : 'You unfollowed this Discussion.');
      });
      details.append(follow);
      element.append(details);
    });
    const discussionSearch = main.querySelector<HTMLInputElement>('[data-discussion-search]');
    const discussionTopic = main.querySelector<HTMLSelectElement>('[data-discussion-topic]');
    const discussionSort = main.querySelector<HTMLSelectElement>('[data-discussion-sort]');
    const rerenderDiscussions = () => {
      const term = discussionSearch?.value.trim().toLowerCase() ?? '';
      const selectedTopic = discussionTopic?.value ?? '';
      const sorted = [...discussionEntries].sort((left, right) => {
        if (discussionSort?.value === 'oldest') return timestampMillis(left.item.createdAt as Timestamp | null) - timestampMillis(right.item.createdAt as Timestamp | null);
        if (discussionSort?.value === 'discussed') return right.item.replyCount - left.item.replyCount;
        return Number(right.item.pinned) - Number(left.item.pinned)
          || timestampMillis(right.item.lastActivityAt as Timestamp | null) - timestampMillis(left.item.lastActivityAt as Timestamp | null);
      });
      sorted.forEach(({ item, element }) => {
        if (!element || !discussionList) return;
        const matches = `${item.title} ${item.topics.join(' ')}`.toLowerCase().includes(term)
          && (!selectedTopic || item.topics.includes(selectedTopic));
        element.hidden = !matches;
        discussionList.append(element);
      });
    };
    discussionSearch?.addEventListener('input', rerenderDiscussions);
    discussionTopic?.addEventListener('change', rerenderDiscussions);
    discussionSort?.addEventListener('change', rerenderDiscussions);

    main.querySelector<HTMLButtonElement>('[data-join]')?.addEventListener('click', async () => {
      if (!currentUser || !group) return;
      const batch = writeBatch(db);
      batch.set(doc(membersRef, memberDocId(group.id, currentUser.uid)), {
        groupId: group.id,
        uid: currentUser.uid,
        joinedAt: serverTimestamp(),
      });
      batch.update(doc(groupsRef, group.id), { memberCount: increment(1), updatedAt: serverTimestamp() });
      await batch.commit();
      await loadGroup();
      await renderGroup();
      setNotice('You joined this Group.');
    });
    main.querySelector<HTMLButtonElement>('[data-leave]')?.addEventListener('click', async () => {
      if (!currentUser || !group) return;
      const batch = writeBatch(db);
      batch.delete(doc(membersRef, memberDocId(group.id, currentUser.uid)));
      batch.update(doc(groupsRef, group.id), { memberCount: increment(-1), updatedAt: serverTimestamp() });
      await batch.commit();
      await loadGroup();
      await renderGroup();
      setNotice('You left this Group.');
    });
    main.querySelector<HTMLButtonElement>('[data-close-group]')?.addEventListener('click', async () => {
      if (!group) return;
      await updateDoc(doc(groupsRef, group.id), {
        closed: !group.closed,
        closedAt: group.closed ? null : serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await loadGroup();
      await renderGroup();
    });
    main.querySelector<HTMLFormElement>('[data-start-discussion]')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!currentUser || !group) return;
      const form = event.currentTarget as HTMLFormElement;
      const data = new FormData(form);
      const title = String(data.get('title') ?? '');
      const body = String(data.get('body') ?? '');
      const topic = String(data.get('topic') ?? '');
      if (!isValidTitle(title) || !isValidPostBody(body)) {
        setNotice('A Discussion needs a title and an opening Post of up to 5,000 characters.', true);
        return;
      }
      try {
        const discussionRef = doc(discussionsRef);
        const postRef = doc(postsRef);
        const batch = writeBatch(db);
        batch.set(discussionRef, {
          groupId: group.id,
          title: title.trim(),
          createdByUid: currentUser.uid,
          createdByName: currentUser.displayName ?? '',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          lastActivityAt: serverTimestamp(),
          replyCount: 0,
          pinned: false,
          pinnedAt: null,
          closed: false,
          closedAt: null,
          topics: topic ? [topic] : [],
        });
          batch.set(postRef, {
            discussionId: discussionRef.id,
            groupId: group.id,
            parentId: '',
            body: body.trim(),
            authorName: currentUser.displayName ?? '',
            authorUid: currentUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          edited: false,
          deleted: false,
          deletedAt: null,
          likeCount: 0,
        });
          batch.set(doc(ownersRef, postRef.id), {
          postId: postRef.id,
          authorUid: currentUser.uid,
          createdAt: serverTimestamp(),
        });
        if (data.get('follow') === 'on') queueFollow(batch, 'discussion', discussionRef.id);
        await batch.commit();
        if (data.get('follow') === 'on') followedTargets.add(followKey('discussion', discussionRef.id));
        window.location.href = `/community/${group.id}/${discussionRef.id}`;
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'The Discussion could not be started.', true);
      }
    });
  };

  const loadDiscussion = async () => {
    const snap = await getDoc(doc(discussionsRef, discussionId));
    if (!snap.exists()) throw new Error('This Discussion was not found.');
    discussion = { id: snap.id, ...(snap.data() as Omit<DiscussionRecord, 'id'>) };
    const postSnap = await getDocs(query(postsRef, where('discussionId', '==', discussionId), orderBy('createdAt', 'asc'), limit(200)));
    posts = postSnap.docs.map((item) => ({ id: item.id, ...(item.data() as Omit<PostRecord, 'id'>) }));
    await markDiscussionOpened(discussionId);
  };

  const addPost = async (body: string, parentId: string, followAfterPosting: boolean) => {
    if (!currentUser || !group || !discussion) throw new Error('Sign in and join the Group first.');
    if (!canPost({ role: currentRole, isMember, groupClosed: group.closed, discussionClosed: discussion.closed })) {
      throw new Error('You cannot post in this Discussion.');
    }
    if (!isValidPostBody(body)) throw new Error('Posts must be between 1 and 5,000 characters.');
    const postRef = doc(postsRef);
    const batch = writeBatch(db);
    batch.set(postRef, {
      discussionId: discussion.id,
      groupId: group.id,
      parentId,
      body: body.trim(),
      authorName: currentUser.displayName ?? '',
      authorUid: currentUser.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      edited: false,
      deleted: false,
      deletedAt: null,
      likeCount: 0,
    });
    batch.set(doc(ownersRef, postRef.id), {
      postId: postRef.id,
      authorUid: currentUser.uid,
      createdAt: serverTimestamp(),
    });
    batch.update(doc(discussionsRef, discussion.id), {
      lastActivityAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      replyCount: increment(parentId ? 1 : 0),
    });
    if (followAfterPosting) queueFollow(batch, 'discussion', discussion.id);
    await batch.commit();
    if (followAfterPosting) followedTargets.add(followKey('discussion', discussion.id));
    ownedPostIds.add(postRef.id);
  };

  const renderPost = (post: PostRecord, openingAuthor: string) => {
    const article = document.createElement('article');
    article.className = post.parentId ? 'community-reply' : 'community-post';
    const isOwner = ownedPostIds.has(post.id);
    const bodyText = post.deleted ? 'This Post was removed.' : post.body;
    article.innerHTML = `
      <div class="community-post-meta">
        <strong>${post.authorName || 'Member'}</strong>
        <span>${formatDate(post.createdAt)}${post.edited && !post.deleted ? ' · Edited' : ''}</span>
        ${post.parentId ? `<span>Replying to ${openingAuthor}</span>` : ''}
      </div>
      <p class="community-post-body${post.deleted ? ' is-deleted' : ''}"></p>
      <div class="community-post-actions"></div>
    `;
    const bodyEl = article.querySelector<HTMLElement>('.community-post-body');
    if (bodyEl) bodyEl.textContent = bodyText;
    const actions = article.querySelector<HTMLElement>('.community-post-actions');
    if (!actions || !currentRole || post.deleted) return article;

    const addButton = (label: string, handler: () => void) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.addEventListener('click', handler);
      actions.append(button);
    };

    if (canUseMemberState(currentRole) && post.authorUid && post.authorUid !== currentUser?.uid) {
      addButton(isFollowed('person', post.authorUid) ? 'Following person' : 'Follow person', async () => {
        await toggleFollow('person', post.authorUid);
        await renderDiscussion();
        setNotice(isFollowed('person', post.authorUid) ? 'You are following this person. They are not notified.' : 'You unfollowed this person.');
      });
    }

    if (canLike({ role: currentRole, deleted: post.deleted })) {
      const liked = likedPostIds.has(post.id);
      addButton(`${liked ? 'Unlike' : 'Like'}${post.likeCount ? ` · ${post.likeCount}` : ''}`, async () => {
        if (!currentUser) return;
        const likeRef = doc(likesRef, likeDocId(post.id, currentUser.uid));
        const postRef = doc(postsRef, post.id);
        const likeBatch = writeBatch(db);
        if (liked) {
          likeBatch.delete(likeRef);
          likeBatch.update(postRef, { likeCount: increment(-1) });
          likedPostIds.delete(post.id);
        } else {
          likeBatch.set(likeRef, { postId: post.id, userUid: currentUser.uid, createdAt: serverTimestamp() });
          likeBatch.update(postRef, { likeCount: increment(1) });
          likedPostIds.add(post.id);
        }
        await likeBatch.commit();
        await loadDiscussion();
        await renderDiscussion();
      });
    }
    if (canEditPost({ isOwner, deleted: post.deleted })) {
      addButton('Edit', () => {
        const textarea = document.createElement('textarea');
        textarea.rows = 4;
        textarea.maxLength = 5000;
        textarea.value = post.body;
        const save = document.createElement('button');
        save.className = 'community-button';
        save.type = 'button';
        save.textContent = 'Save';
        save.addEventListener('click', async () => {
          if (!isValidPostBody(textarea.value)) {
            setNotice('Edited Posts must be between 1 and 5,000 characters.', true);
            return;
          }
          await updateDoc(doc(postsRef, post.id), {
            body: textarea.value.trim(),
            edited: true,
            updatedAt: serverTimestamp(),
          });
          await loadDiscussion();
          await renderDiscussion();
        });
        actions.replaceChildren(textarea, save);
      });
    }
    if (canDeleteOwnPost({ isOwner, deleted: post.deleted })) {
      addButton('Delete', async () => {
        await updateDoc(doc(postsRef, post.id), {
          body: '',
          deleted: true,
          deletedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        await loadDiscussion();
        await renderDiscussion();
        setNotice('Your Post was removed.');
      });
    }
    if (!isOwner && canAdminRemove({ role: currentRole, deleted: post.deleted })) {
      addButton('Remove with reason', () => {
        const reason = document.createElement('textarea');
        reason.rows = 2;
        reason.maxLength = 500;
        reason.placeholder = 'Why is this being removed?';
        const confirm = document.createElement('button');
        confirm.className = 'community-button';
        confirm.type = 'button';
        confirm.textContent = 'Remove Post';
        confirm.addEventListener('click', async () => {
          if (!currentUser || !isValidReason(reason.value)) {
            setNotice('An Administrator must record a reason before removing someone else’s Post.', true);
            return;
          }
          const batch = writeBatch(db);
          batch.update(doc(postsRef, post.id), {
            body: '',
            deleted: true,
            deletedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          batch.set(doc(moderationRef, `remove_${post.id}`), {
            targetType: 'post',
            targetId: post.id,
            action: 'remove',
            reason: reason.value.trim(),
            actorUid: currentUser.uid,
            createdAt: serverTimestamp(),
          });
          if (data.get('follow') === 'on') queueFollow(batch, 'discussion', discussionRef.id);
          await batch.commit();
          await loadDiscussion();
          await renderDiscussion();
          setNotice('The Post was removed and the reason was recorded.');
        });
        actions.replaceChildren(reason, confirm);
      });
    }
    return article;
  };

  const renderDiscussion = async () => {
    if (!main || !group || !discussion || !currentRole) return;
    const opening = posts.find((item) => item.parentId === '') ?? posts[0];
    const replies = posts.filter((item) => item.parentId !== '');
    const canWrite = canPost({ role: currentRole, isMember, groupClosed: group.closed, discussionClosed: discussion.closed });
    main.innerHTML = `
      <p class="eyebrow"><a href="/community/${group.id}">${group.name}</a></p>
      <h1>${discussion.title}</h1>
      <p class="community-meta">${discussion.closed ? 'Closed · ' : ''}${discussion.pinned ? 'Pinned · ' : ''}${formatDate(discussion.lastActivityAt)}</p>
      <div class="community-actions">
        ${canUseMemberState(currentRole) ? `<button class="community-link-button" type="button" data-bookmark-discussion>${bookmarkedDiscussionIds.has(discussion.id) ? 'Remove bookmark' : 'Bookmark privately'}</button>` : ''}
        ${canUseMemberState(currentRole) ? `<button class="community-link-button" type="button" data-follow-discussion>${isFollowed('discussion', discussion.id) ? 'Following' : 'Follow Discussion'}</button>` : ''}
        ${canPinDiscussion(currentRole) ? `<button class="community-link-button" type="button" data-pin>${discussion.pinned ? 'Unpin' : 'Pin'}</button>` : ''}
        ${canCloseDiscussion(currentRole) ? `<button class="community-link-button" type="button" data-close>${discussion.closed ? 'Reopen' : 'Close'}</button>` : ''}
      </div>
      <div data-posts></div>
      ${canWrite ? `
        <form class="community-composer" data-reply>
          <label for="community-reply">Write a reply</label>
          <textarea id="community-reply" name="body" rows="4" maxlength="5000" required></textarea>
          <label class="community-check"><input type="checkbox" name="follow" checked> Follow this Discussion for new activity</label>
          <button class="community-button" type="submit">Post reply</button>
        </form>` : discussion.closed ? '<p class="community-hint">This Discussion is closed.</p>' : '<p class="community-hint">Join the Group to reply.</p>'}
    `;
    const list = main.querySelector('[data-posts]');
    if (opening) list?.append(renderPost(opening, opening.authorName || 'Member'));
    for (const reply of replies) list?.append(renderPost(reply, opening?.authorName || 'Member'));
    main.querySelector<HTMLButtonElement>('[data-bookmark-discussion]')?.addEventListener('click', async (event) => {
      if (!discussion) return;
      await toggleBookmark(discussion.id);
      const button = event.currentTarget as HTMLButtonElement;
      button.textContent = bookmarkedDiscussionIds.has(discussion.id) ? 'Remove bookmark' : 'Bookmark privately';
      setNotice(bookmarkedDiscussionIds.has(discussion.id) ? 'Discussion bookmarked privately.' : 'Discussion removed from your bookmarks.');
    });
    main.querySelector<HTMLButtonElement>('[data-follow-discussion]')?.addEventListener('click', async (event) => {
      if (!discussion) return;
      await toggleFollow('discussion', discussion.id);
      const button = event.currentTarget as HTMLButtonElement;
      button.textContent = isFollowed('discussion', discussion.id) ? 'Following' : 'Follow Discussion';
      setNotice(isFollowed('discussion', discussion.id) ? 'You are following this Discussion.' : 'You unfollowed this Discussion.');
    });
    main.querySelector<HTMLButtonElement>('[data-pin]')?.addEventListener('click', async () => {
      if (!discussion || !currentUser) return;
      await updateDoc(doc(discussionsRef, discussion.id), {
        pinned: !discussion.pinned,
        pinnedAt: discussion.pinned ? null : serverTimestamp(),
      });
      await loadDiscussion();
      await renderDiscussion();
    });
    main.querySelector<HTMLButtonElement>('[data-close]')?.addEventListener('click', async () => {
      if (!discussion) return;
      await updateDoc(doc(discussionsRef, discussion.id), {
        closed: !discussion.closed,
        closedAt: discussion.closed ? null : serverTimestamp(),
      });
      await loadDiscussion();
      await renderDiscussion();
    });
    main.querySelector<HTMLFormElement>('[data-reply]')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget as HTMLFormElement;
      const body = String(new FormData(form).get('body') ?? '');
      try {
        await addPost(body, opening?.id ?? '', new FormData(form).get('follow') === 'on');
        form.reset();
        await loadDiscussion();
        await renderDiscussion();
        setNotice('Reply posted.');
      } catch (error) {
        setNotice(error instanceof Error ? error.message : 'The reply could not be posted.', true);
      }
    });
  };

  const showSignedOut = () => {
    currentUser = null;
    currentRole = null;
    isMember = false;
    bookmarkedDiscussionIds = new Set();
    followedTargets = new Set();
    openedAtByDiscussion = new Map();
    if (signedOut) signedOut.hidden = false;
    if (memberBox) memberBox.hidden = true;
    if (viewOnly) viewOnly.hidden = true;
    if (profileForm) profileForm.hidden = true;
    if (main) {
      main.innerHTML = '<p class="community-empty">Sign in with Google to view Groups and Discussions.</p>';
    }
  };

  const renderPage = async () => {
    if (!currentUser || !currentRole) return;
    if (viewOnly) viewOnly.hidden = currentRole !== 'viewer';
    try {
      if (page === 'landing') await renderLanding();
      if (page === 'group') {
        await loadGroup();
        await renderGroup();
      }
      if (page === 'discussion') {
        await loadGroup();
        await loadDiscussion();
        await renderDiscussion();
      }
    } catch (error) {
      console.error('[community] render failed', error);
      if (main) main.innerHTML = `<p class="community-empty">${error instanceof Error ? error.message : 'Community could not be loaded.'}</p>`;
    }
  };

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
        rememberMemberSession(user, role);
        if (signedOut) signedOut.hidden = true;
        if (memberBox) memberBox.hidden = false;
        if (memberName) memberName.textContent = user.displayName || user.email;
        if (memberRole) memberRole.textContent = roleLabel(role);
        await loadMemberState(user);
        await loadOwnedAndLiked(user);
        setNotice();
        await renderPage();
      } catch (error) {
        console.error('[community] account setup failed', error);
        setNotice(error instanceof Error ? error.message : 'Your account could not be prepared for Community.', true);
      }
    });
  });
};
