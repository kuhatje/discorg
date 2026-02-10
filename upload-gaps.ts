/**
 * Script to upload gaps.json to Firebase Firestore
 *
 * Usage:
 *   npx tsx scripts/upload-gaps.ts [orgUid] [gapsFilePath]
 *
 * Example:
 *   npx tsx scripts/upload-gaps.ts lancedb-org ./gaps.json
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';

// Parse command line arguments
const args = process.argv.slice(2);
const orgUid = args[0] || 'lancedb-org';
const gapsFilePath = args[1] || './gaps.json';

console.log(`📦 Uploading gaps to Firebase for org: ${orgUid}`);
console.log(`📄 Reading from: ${gapsFilePath}`);

// Initialize Firebase Admin SDK
// NOTE: You need to set GOOGLE_APPLICATION_CREDENTIALS environment variable
// or provide the path to your service account key
try {
  initializeApp();
  console.log('✅ Firebase Admin initialized');
} catch (error) {
  console.error('❌ Error initializing Firebase Admin:', error);
  console.log('\nMake sure you have set GOOGLE_APPLICATION_CREDENTIALS environment variable:');
  console.log('  export GOOGLE_APPLICATION_CREDENTIALS="path/to/serviceAccountKey.json"');
  process.exit(1);
}

const db = getFirestore();

interface GapData {
  repository: {
    name: string;
    code_source: string;
    docs_source: string;
  };
  analysis: {
    run_hash: string;
    run_timestamp: string;
    total_gaps_detected: number;
    validated_gaps: number;
    dismissed_gaps: number;
    last_validation: string;
    validation_notes: string;
  };
  gaps: Array<{
    id: string;
    title: string;
    gap: string;
    category: string;
    description: string;
    files: string[];
    source: {
      type: string;
      url: string;
    };
    detectedDate: string;
    evidence: Array<{
      id: string;
      type: string;
      content: string;
      citation: string;
      context: string;
    }>;
    whyItMatters: string;
    validationSteps: Array<{
      id: string;
      instruction: string;
      isChecked: boolean;
      link: {
        label: string;
        url: string;
      } | null;
    }>;
    status: string;
    assignedTo: {
      id: string;
      name: string;
      role: string;
      avatar: string | null;
    };
    verdict: string | null;
    verdictReason: string;
    comments: any[];
    linearIssue: any | null;
    createdBy: {
      id: string;
      name: string;
      role: string;
      avatar: string | null;
    };
    metadata: {
      severity: string;
      confidence: number;
      priority_score: number;
      dimension: string;
      issue_group: string;
      suggested_fix: string;
      has_code_changes: boolean;
      validated: boolean;
    };
  }>;
}

async function uploadGaps() {
  try {
    // Read the gaps.json file
    const gapsData: GapData = JSON.parse(
      fs.readFileSync(path.resolve(gapsFilePath), 'utf-8')
    );

    console.log(`\n📊 Found ${gapsData.gaps.length} gaps to upload`);
    console.log(`📦 Repository: ${gapsData.repository.name}`);
    console.log(`🔍 Analysis run: ${gapsData.analysis.run_hash} (${gapsData.analysis.run_timestamp})`);

    // Create a batch for efficient uploads
    const batch = db.batch();
    const findingsPath = `orgs/${orgUid}/findings`;

    // Upload each gap
    for (const gap of gapsData.gaps) {
      const docRef = db.collection(findingsPath).doc(gap.id);

      // Transform the data to match Firestore format
      const firestoreGap = {
        ...gap,
        // Ensure detectedDate is a string (ISO format)
        detectedDate: gap.detectedDate,
        // Ensure all nested objects are properly structured
        source: gap.source || { type: 'docs', url: gapsData.repository.code_source },
        assignedTo: gap.assignedTo || {
          id: 'user_unassigned',
          name: 'Unassigned',
          role: 'unassigned',
          avatar: null,
        },
        verdict: gap.verdict || null,
        verdictReason: gap.verdictReason || '',
        comments: gap.comments || [],
        linearIssue: gap.linearIssue || null,
        createdBy: gap.createdBy || {
          id: 'oqoqo',
          name: 'Oqoqo',
          role: 'reviewer',
          avatar: null,
        },
      };

      batch.set(docRef, firestoreGap);
      console.log(`  ✓ Queued: ${gap.id} - ${gap.title}`);
    }

    // Also create a metadata document for the repository
    const metadataRef = db.collection(`orgs/${orgUid}/metadata`).doc('lancedb');
    batch.set(metadataRef, {
      repository: gapsData.repository,
      analysis: gapsData.analysis,
      lastUpdated: new Date().toISOString(),
    });

    // Commit the batch
    console.log(`\n🚀 Uploading ${gapsData.gaps.length} gaps to Firebase...`);
    await batch.commit();

    console.log(`\n✅ Successfully uploaded ${gapsData.gaps.length} gaps to Firestore!`);
    console.log(`📍 Collection path: ${findingsPath}`);
    console.log(`\n🔗 View in Firebase Console:`);
    console.log(`   https://console.firebase.google.com/project/_/firestore/data/~2Forgs~2F${orgUid}~2Ffindings`);
  } catch (error) {
    console.error('❌ Error uploading gaps:', error);
    process.exit(1);
  }
}

// Run the upload
uploadGaps();
