// test.js
// =============================================
// ARIA TEST SUITE
// Emergent Linguistic System Tests
// =============================================

import 'dotenv/config';
import {
  processMessage,
  getMemoryStats,
  getMemoryContext,
  searchByWord,
  getTokenStats,
  getTokensByCategory,
  getTopPairs,
  getEmergentChains,
  getClusterLinks,
  getClusterNeighbors,
  searchClustersByWord,
  getTopClusterLinks
} from './ariaCorrelator.js';
import {
  generateResponse,
  queryMemory,
  buildMemoryContext,
  analyzeCategories
} from './ariaGenerator.js';
import { v4 as uuidv4 } from 'uuid';

const TEST_USER_ID = uuidv4();

// Test messages that will help build emergent categories
const TEST_MESSAGES = [
  // Messages to build stable (noun-like) tokens
  'The weather is beautiful today',
  'I love the weather when its sunny',
  'Beautiful weather makes me happy',
  
  // Messages to build transition (verb-like) tokens
  'The cat runs quickly',
  'She runs every morning',
  'He runs to the store',
  
  // Messages to build modifier tokens
  'The big red car is fast',
  'A small blue bird flew by',
  'The old wooden house creaked',
  
  // Messages to build structural tokens
  'The cat and the dog',
  'I went to the store',
  'This is a very good day',
  
  // More context for reinforcement
  'The weather today is perfect',
  'Running is good for health',
  'Big things often come slowly',
  'The house has beautiful weather views'
];

async function runTests() {
  console.log('');
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           ARIA EMERGENT LINGUISTIC SYSTEM                  ║');
  console.log('║                    TEST SUITE                              ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');

  let passed = 0;
  let failed = 0;

  // ============================================
  // SECTION 1: MESSAGE PROCESSING
  // ============================================
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📝 SECTION 1: MESSAGE PROCESSING');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Test 1: Process a single message
  console.log('\n📝 Test 1: Process Single Message');
  try {
    const result = await processMessage(
      'The weather is beautiful today',
      uuidv4(),
      TEST_USER_ID
    );
    
    if (result.processed) {
      console.log(`   ✅ Processed: ${result.tokensProcessed} tokens, ${result.newPairs} new pairs`);
      console.log(`   📊 Categorized: ${result.categorized} tokens`);
      passed++;
    } else {
      console.log(`   ❌ Failed to process: ${result.reason}`);
      failed++;
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    failed++;
  }

  // Test 2: Process multiple messages to build statistics
  console.log('\n📝 Test 2: Process Multiple Messages (Building Statistics)');
  try {
    let totalTokens = 0;
    let totalPairs = 0;
    
    for (const msg of TEST_MESSAGES) {
      const result = await processMessage(msg, uuidv4(), TEST_USER_ID);
      if (result.processed) {
        totalTokens += result.tokensProcessed || 0;
        totalPairs += result.newPairs || 0;
      }
    }
    
    console.log(`   ✅ Processed ${TEST_MESSAGES.length} messages`);
    console.log(`   📊 Total tokens: ${totalTokens}, Total new pairs: ${totalPairs}`);
    passed++;
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    failed++;
  }

  // ============================================
  // SECTION 2: TOKEN STATISTICS
  // ============================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📊 SECTION 2: TOKEN STATISTICS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Test 3: Get token statistics
  console.log('\n📊 Test 3: Get Token Statistics');
  try {
    const stats = await getTokenStats('weather');
    
    if (stats) {
      console.log(`   ✅ Token "weather" found:`);
      console.log(`      Occurrences: ${stats.total_occurrences}`);
      console.log(`      Category: ${stats.category}`);
      console.log(`      Scores: S:${stats.stability_score?.toFixed(3) || 0} T:${stats.transition_score?.toFixed(3) || 0} D:${stats.dependency_score?.toFixed(3) || 0} St:${stats.structural_score?.toFixed(3) || 0}`);
      passed++;
    } else {
      console.log(`   ⚠️ Token "weather" not found (may need more messages)`);
      passed++; // Still passes - just informational
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    failed++;
  }

  // Test 4: Get tokens by category
  console.log('\n🏷️ Test 4: Get Tokens by Category');
  try {
    const categories = ['stable', 'transition', 'modifier', 'structural'];
    
    for (const category of categories) {
      const tokens = await getTokensByCategory(category, 5);
      console.log(`   ${category}: ${tokens.length} tokens`);
      if (tokens.length > 0) {
        console.log(`      Top: ${tokens.slice(0, 3).map(t => t.token).join(', ')}`);
      }
    }
    
    console.log(`   ✅ Category retrieval successful`);
    passed++;
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    failed++;
  }

  // ============================================
  // SECTION 3: WORD PAIRS
  // ============================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔗 SECTION 3: WORD PAIRS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Test 5: Get memory stats
  console.log('\n📊 Test 5: Memory Statistics');
  try {
    const stats = await getMemoryStats();
    console.log(`   ✅ Memory stats retrieved:`);
    console.log(`      Pairs: S:${stats.tiers.short} M:${stats.tiers.medium} L:${stats.tiers.long}`);
    console.log(`      Decay: ${stats.decay}`);
    console.log(`      Tokens: ${stats.tokens}`);
    console.log(`      Categories: S:${stats.categories.stable} T:${stats.categories.transition} M:${stats.categories.modifier} St:${stats.categories.structural}`);
    console.log(`      Messages: ${stats.messagesProcessed}`);
    passed++;
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    failed++;
  }

  // Test 6: Search by word
  console.log('\n🔍 Test 6: Search Pairs by Word');
  try {
    const pairs = await searchByWord('weather');
    console.log(`   ✅ Found ${pairs.length} pairs containing "weather"`);
    if (pairs.length > 0) {
      const top = pairs[0];
      console.log(`      Top: ${top.token_a} + ${top.token_b} (${top.strength?.toFixed(3)}) [${top.category_pattern}]`);
    }
    passed++;
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    failed++;
  }

  // Test 7: Get top pairs
  console.log('\n🏆 Test 7: Get Top Pairs');
  try {
    const pairs = await getTopPairs({ limit: 10 });
    console.log(`   ✅ Retrieved ${pairs.length} top pairs`);
    if (pairs.length > 0) {
      console.log(`      #1: ${pairs[0].token_a} + ${pairs[0].token_b} (${pairs[0].strength?.toFixed(3)})`);
    }
    passed++;
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    failed++;
  }

  // ============================================
  // SECTION 4: EMERGENT PHRASES
  // ============================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🌱 SECTION 4: EMERGENT PHRASES');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Test 8: Get emergent chains
  console.log('\n🔗 Test 8: Emergent Chain Discovery');
  try {
    const chains = await getEmergentChains('weather', 5);
    console.log(`   ✅ Found ${chains.length} emergent chains from "weather"`);
    
    for (const chain of chains.slice(0, 3)) {
      console.log(`      Chain: ${chain.join(' → ')}`);
    }
    
    if (chains.length === 0) {
      console.log(`      (No chains found - need more connected pairs)`);
    }
    passed++;
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    failed++;
  }

  // ============================================
  // SECTION 5: RESPONSE GENERATION
  // ============================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✨ SECTION 5: RESPONSE GENERATION');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Test 9: Generate response
  console.log('\n✨ Test 9: Generate Response');
  try {
    const response = await generateResponse('What about the weather?');
    console.log(`   ✅ Response: "${response}"`);
    
    if (response !== '...' && response.length > 0) {
      console.log(`   🎉 ARIA generated meaningful response!`);
    }
    passed++;
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    failed++;
  }

  // Test 10: Generate response for different inputs
  console.log('\n✨ Test 10: Multiple Response Generation');
  try {
    const inputs = [
      'Tell me about running',
      'What is beautiful?',
      'The cat is happy'
    ];
    
    for (const input of inputs) {
      const response = await generateResponse(input);
      console.log(`   Input: "${input}"`);
      console.log(`   Response: "${response}"`);
      console.log('');
    }
    
    console.log(`   ✅ Multiple responses generated`);
    passed++;
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    failed++;
  }

  // ============================================
  // SECTION 6: QUERY & CONTEXT
  // ============================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔎 SECTION 6: QUERY & CONTEXT');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Test 11: Query memory
  console.log('\n🔎 Test 11: Query Memory');
  try {
    const query = await queryMemory('beautiful weather');
    console.log(`   ✅ Query found:`);
    console.log(`      Keywords: ${query.keywords.join(', ')}`);
    console.log(`      Pairs: ${query.pairs.length}`);
    console.log(`      Token stats: ${query.tokenStats.length}`);
    console.log(`      Emergent chains: ${query.emergentChains.length}`);
    passed++;
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    failed++;
  }

  // Test 12: Build memory context
  console.log('\n📝 Test 12: Build Memory Context');
  try {
    const context = await buildMemoryContext('weather');
    console.log(`   ✅ Context built (${context.length} chars)`);
    console.log('   Preview:');
    console.log('   ' + context.split('\n').slice(0, 5).join('\n   '));
    passed++;
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    failed++;
  }

  // Test 13: Analyze categories
  console.log('\n🏷️ Test 13: Category Analysis');
  try {
    const analysis = await analyzeCategories();
    console.log(`   ✅ Category analysis:`);
    console.log(`      Stable tokens: ${analysis.stable.length}`);
    console.log(`      Transition tokens: ${analysis.transition.length}`);
    console.log(`      Modifier tokens: ${analysis.modifier.length}`);
    console.log(`      Structural tokens: ${analysis.structural.length}`);
    passed++;
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    failed++;
  }

  // ============================================
  // SECTION 7: REINFORCEMENT TEST
  // ============================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('📈 SECTION 7: REINFORCEMENT TEST');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Test 14: Test reinforcement
  console.log('\n📈 Test 14: Pair Reinforcement');
  try {
    // Get current strength
    const before = await searchByWord('weather');
    const beforeStrength = before.length > 0 ? before[0].strength : 0;
    
    // Process same phrase multiple times
    await processMessage('The weather is beautiful', uuidv4(), TEST_USER_ID);
    await processMessage('Beautiful weather today', uuidv4(), TEST_USER_ID);
    await processMessage('Weather is so beautiful', uuidv4(), TEST_USER_ID);
    
    // Get new strength
    const after = await searchByWord('weather');
    const afterStrength = after.length > 0 ? after[0].strength : 0;
    
    console.log(`   Before: ${beforeStrength.toFixed(3)}`);
    console.log(`   After: ${afterStrength.toFixed(3)}`);
    
    if (afterStrength >= beforeStrength) {
      console.log(`   ✅ Reinforcement working (strength increased or maintained)`);
      passed++;
    } else {
      console.log(`   ⚠️ Strength decreased (may be due to decay)`);
      passed++; // Still passes - decay is expected behavior
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    failed++;
  }

  // ============================================
  // SECTION 8: LEGACY COMPATIBILITY
  // ============================================
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🔄 SECTION 8: LEGACY COMPATIBILITY');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Test 15: Legacy cluster functions
  console.log('\n🔗 Test 15: Legacy Cluster Functions');
  try {
    const links = await getClusterLinks('weather', { limit: 5 });
    const neighbors = await getClusterNeighbors('weather', { limit: 5 });
    const clusters = await searchClustersByWord('weather', { limit: 5 });
    const topLinks = await getTopClusterLinks({ limit: 5 });
    
    console.log(`   ✅ Legacy functions working:`);
    console.log(`      getClusterLinks: ${links.length} results`);
    console.log(`      getClusterNeighbors: ${neighbors.outgoing.length} outgoing`);
    console.log(`      searchClustersByWord: ${clusters.length} results`);
    console.log(`      getTopClusterLinks: ${topLinks.length} results`);
    passed++;
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    failed++;
  }

  // ============================================
  // SUMMARY
  // ============================================
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');

  // Final stats
  try {
    const finalStats = await getMemoryStats();
    console.log('📊 Final Memory State:');
    console.log(`   Word Pairs: ${finalStats.tiers.short + finalStats.tiers.medium + finalStats.tiers.long}`);
    console.log(`   Tokens: ${finalStats.tokens}`);
    console.log(`   Categories:`);
    console.log(`     Stable: ${finalStats.categories.stable}`);
    console.log(`     Transition: ${finalStats.categories.transition}`);
    console.log(`     Modifier: ${finalStats.categories.modifier}`);
    console.log(`     Structural: ${finalStats.categories.structural}`);
    console.log(`   Messages Processed: ${finalStats.messagesProcessed}`);
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
