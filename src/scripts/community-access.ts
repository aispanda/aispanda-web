export type MemberRole = 'administrator' | 'publisher' | 'author' | 'commenter' | 'viewer';

export const CONTROLLED_TOPICS = ['General', 'Practice', 'Product', 'Policy', 'Learning'] as const;
export type ControlledTopic = (typeof CONTROLLED_TOPICS)[number];

export const POST_MAX_LENGTH = 5000;
export const TITLE_MAX_LENGTH = 200;
export const GROUP_NAME_MAX_LENGTH = 80;
export const GROUP_DESCRIPTION_MAX_LENGTH = 500;
export const REASON_MAX_LENGTH = 500;

export const FIRST_SLICE_DEFERRED = [
  'Invite-only Groups',
  'site-wide search',
  'structured Post composer',
  'images and mentions',
  'email notifications',
  'answered question state',
  'notification preferences and extra notification types',
  'saved-items hub and Following/Unread filters',
  'reporting queue',
  'Events',
  'Learning paths',
  'Cloud Run moderation API',
  'post-level pins',
] as const;

const participating: MemberRole[] = ['administrator', 'publisher', 'author', 'commenter'];

export const canReadCommunity = (signedIn: boolean, role: MemberRole | null) =>
  signedIn && role !== null;

// Discovery state is private and read-side only. View Only members may use it
// without gaining membership, posting, liking, or any additional access.
export const canUseMemberState = (role: MemberRole | null) => role !== null;

export const FOLLOW_TARGET_TYPES = ['group', 'discussion', 'person'] as const;
export type FollowTargetType = (typeof FOLLOW_TARGET_TYPES)[number];

export const isFollowTargetType = (value: string): value is FollowTargetType =>
  FOLLOW_TARGET_TYPES.includes(value as FollowTargetType);

export const memberStateId = (uid: string, kind: string, targetId: string) =>
  `${uid}_${kind}_${targetId}`;

export const isAllowedFeedActivity = (input: {
  followedGroups: Set<string>;
  followedDiscussions: Set<string>;
  followedPeople: Set<string>;
  groupId: string;
  discussionId: string;
  authorUid: string;
  deleted: boolean;
}) => !input.deleted && (
  input.followedGroups.has(input.groupId)
  || input.followedDiscussions.has(input.discussionId)
  || input.followedPeople.has(input.authorUid)
);

export const canParticipate = (role: MemberRole | null) =>
  role !== null && participating.includes(role);

export const canCreateGroup = (role: MemberRole | null) =>
  role === 'administrator' || role === 'publisher';

export const canJoinGroup = (input: {
  role: MemberRole | null;
  access: string;
  closed: boolean;
  isMember: boolean;
}) => canParticipate(input.role) && input.access === 'open' && !input.closed && !input.isMember;

export const canLeaveGroup = (input: { isMember: boolean }) => input.isMember;

export const canStartDiscussion = (input: {
  role: MemberRole | null;
  isMember: boolean;
  groupClosed: boolean;
}) => canParticipate(input.role) && input.isMember && !input.groupClosed;

export const canPost = (input: {
  role: MemberRole | null;
  isMember: boolean;
  groupClosed: boolean;
  discussionClosed: boolean;
}) => canParticipate(input.role) && input.isMember && !input.groupClosed && !input.discussionClosed;

export const canEditPost = (input: { isOwner: boolean; deleted: boolean }) =>
  input.isOwner && !input.deleted;

export const canDeleteOwnPost = (input: { isOwner: boolean; deleted: boolean }) =>
  input.isOwner && !input.deleted;

export const canAdminRemove = (input: { role: MemberRole | null; deleted: boolean }) =>
  input.role === 'administrator' && !input.deleted;

export const canRewritePost = () => false;

export const canPinDiscussion = (role: MemberRole | null) =>
  role === 'administrator' || role === 'publisher';

export const canCloseDiscussion = (role: MemberRole | null) =>
  role === 'administrator' || role === 'publisher';

export const canCloseGroup = (role: MemberRole | null) => role === 'administrator';

export const canLike = (input: { role: MemberRole | null; deleted: boolean }) =>
  canParticipate(input.role) && !input.deleted;

export const isValidPostBody = (body: string) => {
  const value = body.trim();
  return value.length > 0 && value.length <= POST_MAX_LENGTH;
};

export const isValidTitle = (title: string) => {
  const value = title.trim();
  return value.length > 0 && value.length <= TITLE_MAX_LENGTH;
};

export const isValidGroupName = (name: string) => {
  const value = name.trim();
  return value.length > 0 && value.length <= GROUP_NAME_MAX_LENGTH;
};

export const isValidReason = (reason: string) => {
  const value = reason.trim();
  return value.length > 0 && value.length <= REASON_MAX_LENGTH;
};

export const slugifyGroupName = (name: string) => name
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80);

export type CommunityPage = 'landing' | 'group' | 'discussion';

export const parseCommunityPath = (pathname: string): {
  page: CommunityPage;
  groupId: string;
  discussionId: string;
} => {
  const parts = pathname.replace(/\/+$/, '').split('/').filter(Boolean);
  if (parts[0] !== 'community' || parts.length === 1) {
    return { page: 'landing', groupId: '', discussionId: '' };
  }
  if (parts.length === 2) {
    return { page: 'group', groupId: decodeURIComponent(parts[1]), discussionId: '' };
  }
  return {
    page: 'discussion',
    groupId: decodeURIComponent(parts[1]),
    discussionId: decodeURIComponent(parts[2]),
  };
};
