import { readFileSync } from 'node:fs';
import { after, before, beforeEach, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

const projectId = 'demo-aispanda';
const rulesPath = fileURLToPath(new URL('../firestore.rules', import.meta.url));
const adminUid = 'admin-user';
const authorUid = 'author-user';

let environment;

const draft = (ownerUid = adminUid) => ({
  title: 'Governed publication',
  body: '<p>Verified body</p>',
  excerpt: 'Verified excerpt',
  slug: 'governed-publication',
  tags: 'governance, publishing',
  publicationStatus: 'draft',
  updatedAt: '2026-08-26T00:00:00.000Z',
  revisions: [],
  ownerUid,
  ownerEmail: `${ownerUid}@example.test`,
  publicationReleaseId: '',
  publicationLiveUrl: '',
});

const contextFor = (uid, email = `${uid}@example.test`) =>
  environment.authenticatedContext(uid, {
    email,
    email_verified: true,
  });

const seedAccess = async (uid, role) => {
  await environment.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'studioAccess', uid), {
      active: true,
      role,
      email: `${uid}@example.test`,
      claimedAt: '2026-08-26T00:00:00.000Z',
    });
  });
};

before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync(rulesPath, 'utf8'),
    },
  });
});

beforeEach(async () => {
  await environment.clearFirestore();
  await seedAccess(adminUid, 'administrator');
  await seedAccess(authorUid, 'author');
});

after(async () => {
  await environment?.cleanup();
});

describe('content draft boundary', () => {
  test('administrator can read a server-created draft but cannot write it from the browser', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'contentDrafts', 'draft-1'), draft());
    });
    const database = contextFor(adminUid).firestore();
    const reference = doc(database, 'contentDrafts', 'draft-1');

    await assertSucceeds(getDoc(reference));
    await assertFails(updateDoc(reference, { title: 'Browser rewrite' }));
    await assertFails(deleteDoc(reference));
    await assertFails(setDoc(doc(database, 'contentDrafts', 'new-draft'), draft()));
  });

  test('author cannot read or update another author\'s draft', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'contentDrafts', 'draft-2'), draft(adminUid));
    });

    const reference = doc(contextFor(authorUid).firestore(), 'contentDrafts', 'draft-2');
    await assertFails(getDoc(reference));
    await assertFails(updateDoc(reference, { title: 'Taken over' }));
  });

  test('browser cannot forge publication pointers or delete a draft', async () => {
    const database = contextFor(adminUid).firestore();
    const forged = doc(database, 'contentDrafts', 'forged-draft');
    await assertFails(setDoc(forged, {
      ...draft(),
      publicationReleaseId: 'release-forged',
      publicationLiveUrl: 'https://aispanda.com/forged',
    }));

    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'contentDrafts', 'draft-3'), draft());
    });
    const reference = doc(database, 'contentDrafts', 'draft-3');
    await assertFails(updateDoc(reference, {
      publicationReleaseId: 'release-forged',
      publicationLiveUrl: 'https://aispanda.com/forged',
    }));
    await assertFails(deleteDoc(reference));
  });

  test('an archived draft remains readable but cannot be overwritten', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), 'contentDrafts', 'archived-draft'), {
        ...draft(),
        archivedAt: '2026-08-26T01:00:00.000Z',
        archivedBy: adminUid,
      });
    });

    const reference = doc(contextFor(adminUid).firestore(), 'contentDrafts', 'archived-draft');
    await assertSucceeds(getDoc(reference));
    await assertFails(updateDoc(reference, { title: 'Reopened accidentally' }));
  });
});

describe('server-owned publication boundary', () => {
  test('browser clients cannot read or write publication state', async () => {
    await environment.withSecurityRulesDisabled(async (context) => {
      await Promise.all([
        setDoc(doc(context.firestore(), 'publishedContent', 'private-release'), { title: 'Private' }),
        setDoc(doc(context.firestore(), 'contentPublicationIndex', 'draft-1'), { slug: 'private-release' }),
        setDoc(doc(context.firestore(), 'contentPublicationRequests', 'request-1'), { status: 'complete' }),
        setDoc(doc(context.firestore(), 'contentPreviewReceipts', 'receipt-1'), { status: 'ready' }),
        setDoc(doc(context.firestore(), 'contentReleases', 'release-1'), { slug: 'private-release' }),
        setDoc(doc(context.firestore(), 'contentReleasePayloads', 'release-1_page'), { kind: 'page' }),
        setDoc(doc(context.firestore(), 'contentAuditEvents', 'event-1'), { action: 'publish' }),
        setDoc(doc(context.firestore(), 'contentAssets', 'asset-1'), { status: 'ready' }),
        setDoc(doc(context.firestore(), 'contentAssetPublicRefs', 'asset-1'), { active: true }),
      ]);
    });

    const database = contextFor(adminUid).firestore();
    for (const [collection, id] of [
      ['publishedContent', 'private-release'],
      ['contentPublicationIndex', 'draft-1'],
      ['contentPublicationRequests', 'request-1'],
      ['contentPreviewReceipts', 'receipt-1'],
      ['contentReleases', 'release-1'],
      ['contentReleasePayloads', 'release-1_page'],
      ['contentAuditEvents', 'event-1'],
      ['contentAssets', 'asset-1'],
      ['contentAssetPublicRefs', 'asset-1'],
    ]) {
      const reference = doc(database, collection, id);
      await assertFails(getDoc(reference));
      await assertFails(setDoc(reference, { forged: true }));
    }
  });
});
