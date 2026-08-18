import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FIRST_SLICE_DEFERRED,
  canAdminRemove,
  canCloseDiscussion,
  canCloseGroup,
  canCreateGroup,
  canDeleteOwnPost,
  canEditPost,
  canJoinGroup,
  canLeaveGroup,
  canLike,
  canParticipate,
  canPinDiscussion,
  canPost,
  canReadCommunity,
  canRewritePost,
  canStartDiscussion,
  canUseMemberState,
  isAllowedFeedActivity,
  isValidGroupName,
  isValidPostBody,
  isValidReason,
  isValidTitle,
  memberStateId,
  parseCommunityPath,
  slugifyGroupName,
} from '../src/scripts/community-access.ts';

test('signed-in roles including View Only may read community', () => {
  assert.equal(canReadCommunity(true, 'viewer'), true);
  assert.equal(canReadCommunity(true, 'commenter'), true);
  assert.equal(canReadCommunity(false, 'commenter'), false);
  assert.equal(canReadCommunity(true, null), false);
});

test('View Only cannot participate, join, post or like', () => {
  assert.equal(canParticipate('viewer'), false);
  assert.equal(canJoinGroup({ role: 'viewer', access: 'open', closed: false, isMember: false }), false);
  assert.equal(canStartDiscussion({ role: 'viewer', isMember: true, groupClosed: false }), false);
  assert.equal(canPost({ role: 'viewer', isMember: true, groupClosed: false, discussionClosed: false }), false);
  assert.equal(canLike({ role: 'viewer', deleted: false }), false);
});

test('member discovery state is private, non-escalating and silent for person follows', () => {
  assert.equal(canUseMemberState('viewer'), true);
  assert.equal(canUseMemberState(null), false);
  assert.equal(memberStateId('u1', 'person', 'u2'), 'u1_person_u2');
  const follows = {
    followedGroups: new Set(['g1']),
    followedDiscussions: new Set(['d1']),
    followedPeople: new Set(['u2']),
  };
  assert.equal(isAllowedFeedActivity({ ...follows, groupId: 'g9', discussionId: 'd9', authorUid: 'u2', deleted: false }), true);
  assert.equal(isAllowedFeedActivity({ ...follows, groupId: 'g9', discussionId: 'd9', authorUid: 'u9', deleted: false }), false);
  assert.equal(isAllowedFeedActivity({ ...follows, groupId: 'g1', discussionId: 'd1', authorUid: 'u2', deleted: true }), false);
});

test('Author and Commenter cannot create Groups; Administrator and Publisher can', () => {
  assert.equal(canCreateGroup('author'), false);
  assert.equal(canCreateGroup('commenter'), false);
  assert.equal(canCreateGroup('administrator'), true);
  assert.equal(canCreateGroup('publisher'), true);
});

test('join is only for open, unclosed Groups the member has not already joined', () => {
  assert.equal(canJoinGroup({ role: 'commenter', access: 'open', closed: false, isMember: false }), true);
  assert.equal(canJoinGroup({ role: 'commenter', access: 'invite', closed: false, isMember: false }), false);
  assert.equal(canJoinGroup({ role: 'commenter', access: 'open', closed: true, isMember: false }), false);
  assert.equal(canJoinGroup({ role: 'commenter', access: 'open', closed: false, isMember: true }), false);
});

test('members may leave; posting requires membership and open Group and Discussion', () => {
  assert.equal(canLeaveGroup({ isMember: true }), true);
  assert.equal(canLeaveGroup({ isMember: false }), false);
  assert.equal(canPost({ role: 'commenter', isMember: true, groupClosed: false, discussionClosed: false }), true);
  assert.equal(canPost({ role: 'commenter', isMember: false, groupClosed: false, discussionClosed: false }), false);
  assert.equal(canPost({ role: 'commenter', isMember: true, groupClosed: true, discussionClosed: false }), false);
  assert.equal(canPost({ role: 'commenter', isMember: true, groupClosed: false, discussionClosed: true }), false);
});

test('members may edit or delete only their own non-deleted Posts and nobody may rewrite', () => {
  assert.equal(canEditPost({ isOwner: true, deleted: false }), true);
  assert.equal(canEditPost({ isOwner: false, deleted: false }), false);
  assert.equal(canEditPost({ isOwner: true, deleted: true }), false);
  assert.equal(canDeleteOwnPost({ isOwner: true, deleted: false }), true);
  assert.equal(canDeleteOwnPost({ isOwner: false, deleted: false }), false);
  assert.equal(canRewritePost(), false);
});

test('Administrator may remove a live Post; owner delete does not require admin', () => {
  assert.equal(canAdminRemove({ role: 'administrator', deleted: false }), true);
  assert.equal(canAdminRemove({ role: 'publisher', deleted: false }), false);
  assert.equal(canAdminRemove({ role: 'administrator', deleted: true }), false);
  assert.equal(isValidReason('off-topic and uncivil'), true);
  assert.equal(isValidReason('   '), false);
});

test('Publisher and Administrator may pin or close Discussions; only Administrator closes Groups', () => {
  assert.equal(canPinDiscussion('publisher'), true);
  assert.equal(canCloseDiscussion('administrator'), true);
  assert.equal(canPinDiscussion('commenter'), false);
  assert.equal(canCloseGroup('administrator'), true);
  assert.equal(canCloseGroup('publisher'), false);
});

test('validates names, titles, bodies and slugs', () => {
  assert.equal(isValidGroupName('Practice circle'), true);
  assert.equal(isValidTitle('How do you evaluate a model?'), true);
  assert.equal(isValidPostBody('A useful first Post.'), true);
  assert.equal(isValidPostBody(''), false);
  assert.equal(slugifyGroupName('Practice Circle!'), 'practice-circle');
});

test('deferred first-slice capabilities stay named so they are not dropped', () => {
  assert.ok(FIRST_SLICE_DEFERRED.includes('Invite-only Groups'));
  assert.ok(FIRST_SLICE_DEFERRED.includes('site-wide search'));
  assert.ok(FIRST_SLICE_DEFERRED.includes('structured Post composer'));
  assert.ok(FIRST_SLICE_DEFERRED.includes('email notifications'));
  assert.equal(FIRST_SLICE_DEFERRED.includes('bookmarks'), false);
  assert.equal(FIRST_SLICE_DEFERRED.includes('follows'), false);
});

test('community URLs parse landing, group, and discussion from the path', () => {
  assert.deepEqual(parseCommunityPath('/community'), { page: 'landing', groupId: '', discussionId: '' });
  assert.deepEqual(parseCommunityPath('/community/'), { page: 'landing', groupId: '', discussionId: '' });
  assert.deepEqual(parseCommunityPath('/community/abc'), { page: 'group', groupId: 'abc', discussionId: '' });
  assert.deepEqual(parseCommunityPath('/community/abc/def'), { page: 'discussion', groupId: 'abc', discussionId: 'def' });
});
