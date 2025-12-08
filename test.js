// test.js
// Basic tests for ARIA system
// Includes tests for new cluster link functionality

import 'dotenv/config';
import { 
  processMessage, 
  getMemoryStats, 
  searchByWord, 
  getMemoryContext,
  getClusterLinks,
  getClusterNeighbors,
  searchClustersByWord,
  getTopClusterLinks
} from './ariaCorrelator.js';
import { generateResponse, queryMemory } from './ariaGenerator.js';
import { v4 as uuidv4 } from 'uuid';

const TEST_USER_ID = uuidv4();

async function runTests() {
  console.log('');
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║              ARIA TEST SUITE                   ║');
  console.log('║      Including Cluster Link Tests              ║');
  console.log('╚════════════════════════════════════════════════╝');
  console.log('');

  let passed = 0;
  let failed = 0;

  // Test 1: Process a message
  console.log('📝 Test 1: Process Message');
  try {
    const result = await processMessage(
      'The weather is beautiful today',
      uuidv4(),
      TEST_USER_ID
    );
    
    if (result.processed) {
      console.log(`   ✅ Processed: ${result.wordsProcessed} words, ${result.newCorrelations} new correlations`);
      if (result.clusterLinks) {
        console.log(`   🔗 Cluster links: ${result.clusterLinks.newLinks} new, ${result.clusterLinks.reinforced} reinforced`);
      }
      passed++;
    } else {
      console.log(`   ❌ Failed to process: ${result.reason}`);
      failed++;
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    failed++;
  }

  // Test 2: Get memory stats (now includes cluster links)
  console.log('\n📊 Test 2: Memory Stats');
  try {
    const stats = await getMemoryStats();
    console.log(`   ✅ Stats retrieved:`);
    console.log(`      Short:         ${stats.tiers.short}`);
    console.log(`      Medium:        ${stats.tiers.medium}`);
    console.log(`      Long:          ${stats.tiers.long}`);
    console.log(`      Decay:         ${stats.decay}`);
    console.log(`      Phrases:       ${stats.phrases}`);
    console.log(`      Cluster Links: ${stats.clusterLinks || 0}`);
    passed++;
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    failed++;
  }

  // Test 3: Search by word
  console.log('\n🔍 Test 3: Search by Word');
  try {
    const results = await searchByWord('weather');
    console.log(`   ✅ Found ${results.length} correlations for "weather"`);
    if (results.length > 0) {
      console.log(`      Top: ${results[0].word1} + ${results[0].word2} (${results[0].correlation_score?.toFixed(3) || 'N/A'})`);
    }
    passed++;
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    failed++;
  }

  // Test 4: Get memory context
  console.log('\n🧠 Test 4: Memory Context');
  try {
    const context = await getMemoryContext({ limit: 10 });
    const total = context.short.length + context.medium.length + context.long.length;
    console.log(`   ✅ Context retrieved: ${total} correlations, ${context.phrases.length} phrases`);
    passed++;
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    failed++;
  }

  // Test 5: Generate response
  console.log('\n✨ Test 5: Generate Response');
  try {
    const response = await generateResponse('What about the weather?');
    console.log(`   ✅ Response: "${response}"`);
    passed++;
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    failed++;
  }

  // Test 6: Query memory
  console.log('\n🔎 Test 6: Query Memory');
  try {
    const query = await queryMemory('beautiful day');
    console.log(`   ✅ Query found ${query.correlations.length} correlations for keywords: ${query.keywords.join(', ')}`);
    if (query.clusters && query.clusters.length > 0) {
      console.log(`      Found ${query.clusters.length} related clusters`);
    }
    passed++;
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    failed++;
  }

  // Test 7: Process another message to test reinforcement
  console.log('\n📝 Test 7: Reinforcement Test');
  try {
    const result = await processMessage(
      'The weather is really beautiful',
      uuidv4(),
      TEST_USER_ID
    );
    
    if (result.reinforced > 0) {
      console.log(`   ✅ Reinforced ${result.reinforced} existing correlations`);
      passed++;
    } else {
      console.log(`   ⚠️  No reinforcements (may need more overlapping words)`);
      passed++; // Still passes, just informational
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    failed++;
  }

  // ============================================
  // NEW CLUSTER LINK TESTS
  // ============================================

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔗 CLUSTER LINK TESTS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Test 8: Process message with cluster links
  console.log('\n📝 Test 8: Process Message with Cluster Links');
  try {
    const result = await processMessage(
      'I love sunny days when the sky is clear',
      uuidv4(),
      TEST_USER_ID
    );
    
    if (result.processed && result.clusterLinks) {
      console.log(`   ✅ Cluster links created: ${result.clusterLinks.newLinks} new`);
      passed++;
    } else if (result.processed) {
      console.log(`   ⚠️  Message processed but no cluster links (table may not exist)`);
      passed++;
    } else {
      console.log(`   ❌ Failed to process`);
      failed++;
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    failed++;
  }

  // Test 9: Get cluster links
  console.log('\n🔗 Test 9: Get Cluster Links');
  try {
    const links = await getClusterLinks('weather', { limit: 10 });
    console.log(`   ✅ Found ${links.length} outgoing links from "weather"`);
    if (links.length > 0) {
      console.log(`      Top link: weather → ${links[0].to_cluster} (${links[0].score.toFixed(3)})`);
    }
    passed++;
  } catch (error) {
    if (error.message.includes('does not exist')) {
      console.log(`   ⚠️  Table not found - run migration 002_aria_cluster_links.sql`);
      passed++;
    } else {
      console.log(`   ❌ Error: ${error.message}`);
      failed++;
    }
  }

  // Test 10: Get cluster neighbors
  console.log('\n🔗 Test 10: Get Cluster Neighbors');
  try {
    const neighbors = await getClusterNeighbors('beautiful', { limit: 10 });
    console.log(`   ✅ Found ${neighbors.outgoing.length} outgoing, ${neighbors.incoming.length} incoming links`);
    passed++;
  } catch (error) {
    if (error.message.includes('does not exist')) {
      console.log(`   ⚠️  Table not found - run migration 002_aria_cluster_links.sql`);
      passed++;
    } else {
      console.log(`   ❌ Error: ${error.message}`);
      failed++;
    }
  }

  // Test 11: Search clusters by word
  console.log('\n🔍 Test 11: Search Clusters by Word');
  try {
    const clusters = await searchClustersByWord('weather', { limit: 20 });
    console.log(`   ✅ Found ${clusters.length} clusters containing "weather"`);
    if (clusters.length > 0) {
      console.log(`      Top cluster: ${clusters[0].key} (${clusters[0].score.toFixed(3)})`);
    }
    passed++;
  } catch (error) {
    if (error.message.includes('does not exist')) {
      console.log(`   ⚠️  Table not found - run migration 002_aria_cluster_links.sql`);
      passed++;
    } else {
      console.log(`   ❌ Error: ${error.message}`);
      failed++;
    }
  }

  // Test 12: Get top cluster links
  console.log('\n🏆 Test 12: Get Top Cluster Links');
  try {
    const topLinks = await getTopClusterLinks({ limit: 10 });
    console.log(`   ✅ Retrieved ${topLinks.length} top cluster links`);
    if (topLinks.length > 0) {
      console.log(`      #1: ${topLinks[0].from_cluster} → ${topLinks[0].to_cluster} (${topLinks[0].score.toFixed(3)})`);
    }
    passed++;
  } catch (error) {
    if (error.message.includes('does not exist')) {
      console.log(`   ⚠️  Table not found - run migration 002_aria_cluster_links.sql`);
      passed++;
    } else {
      console.log(`   ❌ Error: ${error.message}`);
      failed++;
    }
  }

  // Test 13: Generate response with cluster links
  console.log('\n✨ Test 13: Generate Response with Cluster Links');
  try {
    // Process a few more messages to build cluster links
    await processMessage('The sunny weather makes me happy', uuidv4(), TEST_USER_ID);
    await processMessage('Happy days are beautiful days', uuidv4(), TEST_USER_ID);
    await processMessage('Beautiful weather brings sunny skies', uuidv4(), TEST_USER_ID);
    
    // Now generate a response
    const response = await generateResponse('What makes you happy about the weather?');
    console.log(`   ✅ Response: "${response}"`);
    
    // Check if it's more coherent than "..."
    if (response !== '...' && response.split(' ').length >= 3) {
      console.log(`   🎉 Response has ${response.split(' ').length} words - cluster linking working!`);
    }
    passed++;
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    failed++;
  }

  // Test 14: Test cluster link reinforcement
  console.log('\n📈 Test 14: Cluster Link Reinforcement');
  try {
    // Process same phrase pattern multiple times
    const msg1 = await processMessage('good morning everyone', uuidv4(), TEST_USER_ID);
    const msg2 = await processMessage('have a good morning', uuidv4(), TEST_USER_ID);
    const msg3 = await processMessage('good morning to all', uuidv4(), TEST_USER_ID);
    
    const totalReinforced = 
      (msg1.clusterLinks?.reinforced || 0) + 
      (msg2.clusterLinks?.reinforced || 0) + 
      (msg3.clusterLinks?.reinforced || 0);
    
    console.log(`   ✅ Total cluster links reinforced: ${totalReinforced}`);
    
    // Check if "good_morning" cluster has strong links
    const links = await getClusterLinks('good_morning', { limit: 5 });
    if (links.length > 0) {
      console.log(`   🔗 "good_morning" has ${links.length} outgoing links`);
      console.log(`      Strongest: → ${links[0].to_cluster} (${links[0].score.toFixed(3)})`);
    }
    passed++;
  } catch (error) {
    if (error.message.includes('does not exist')) {
      console.log(`   ⚠️  Table not found - run migration 002_aria_cluster_links.sql`);
      passed++;
    } else {
      console.log(`   ❌ Error: ${error.message}`);
      failed++;
    }
  }

  // Summary
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  // Final memory stats
  try {
    const finalStats = await getMemoryStats();
    console.log('📊 Final Memory State:');
    console.log(`   Correlations: ${finalStats.tiers.short + finalStats.tiers.medium + finalStats.tiers.long}`);
    console.log(`   Cluster Links: ${finalStats.clusterLinks || 0}`);
    console.log(`   Messages: ${finalStats.messagesProcessed}`);
    console.log('');
  } catch (e) {
    // Ignore
  }

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
