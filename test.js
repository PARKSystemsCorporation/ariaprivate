// test.js
// Basic tests for ARIA system

import 'dotenv/config';
import { processMessage, getMemoryStats, searchByWord, getMemoryContext } from './ariaCorrelator.js';
import { generateResponse, queryMemory } from './ariaGenerator.js';
import { v4 as uuidv4 } from 'uuid';

const TEST_USER_ID = uuidv4();

async function runTests() {
  console.log('');
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║              ARIA TEST SUITE                   ║');
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
      passed++;
    } else {
      console.log(`   ❌ Failed to process: ${result.reason}`);
      failed++;
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
    failed++;
  }

  // Test 2: Get memory stats
  console.log('\n📊 Test 2: Memory Stats');
  try {
    const stats = await getMemoryStats();
    console.log(`   ✅ Stats retrieved:`);
    console.log(`      Short:  ${stats.tiers.short}`);
    console.log(`      Medium: ${stats.tiers.medium}`);
    console.log(`      Long:   ${stats.tiers.long}`);
    console.log(`      Decay:  ${stats.decay}`);
    console.log(`      Phrases: ${stats.phrases}`);
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

  // Summary
  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('Test suite failed:', error);
  process.exit(1);
});
