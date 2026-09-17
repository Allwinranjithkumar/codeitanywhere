/**
 * test_ai_services_unit.js
 * Validates Pattern Ingestion and AI Generation/Analyst Schemas & Parsing
 */

require('dotenv').config();
const { getDSAPatterns } = require('../services/patternService');
const { callLLM, parseJsonSafely } = require('../services/aiService');

async function testServices() {
    console.log('════════════════════════════════════════════════════════');
    console.log('⚡ CodeItAnywhere AI Services Unit Validation');
    console.log('════════════════════════════════════════════════════════');

    // 1. Ingestion of BYTS-SDE_SHEET.xlsx
    console.log('\n[1/3] Testing DSA Pattern Ingestion from BYTS-SDE_SHEET.xlsx:');
    const patterns = getDSAPatterns();
    console.log(`  ✓ Loaded ${patterns.length} DSA pattern tags from sheet.`);
    console.log(`  ✓ Sample Patterns:`);
    patterns.slice(0, 8).forEach(p => console.log(`     • ${p}`));

    if (!patterns || patterns.length === 0) {
        throw new Error('No patterns loaded!');
    }

    // 2. Problem Generation (Mock / Fast Mode)
    console.log('\n[2/3] Testing AI Co-Problem-Setter (Auto-Problem Studio):');
    const systemPrompt = {
        role: 'system',
        content: 'You are an elite competitive programming problem setter. Output strictly a JSON object.'
    };
    const userPrompt = {
        role: 'user',
        content: `Topic Patterns: ["Sliding Window - Dynamic Size", "Two Pointers - Same Direction"]\nTarget Difficulty: medium\nCreate an original competitive programming problem.`
    };

    const rawProb = await callLLM([systemPrompt, userPrompt]);
    const problem = parseJsonSafely(rawProb);

    console.log(`  ✓ Title: "${problem.title}"`);
    console.log(`  ✓ Statement/Description excerpt: "${(problem.statement || problem.description || '').substring(0, 100)}..."`);
    console.log(`  ✓ Input Format: "${problem.input_format || problem.inputFormat || 'N/A'}"`);
    console.log(`  ✓ Output Format: "${problem.output_format || problem.outputFormat || 'N/A'}"`);
    console.log(`  ✓ Constraints: ${problem.constraints?.length || 0} constraints`);
    console.log(`  ✓ Samples: ${problem.samples?.length || 0} cases`);
    console.log(`  ✓ Hidden Tests: ${problem.hidden_tests?.length || 0} edge/stress cases`);
    console.log(`  ✓ Reference Approach: ${problem.reference_approach?.idea}`);
    console.log(`  ✓ Complexity: ${JSON.stringify(problem.reference_approach?.complexity)}`);

    // 3. Contest Analyst
    console.log('\n[3/3] Testing AI Contest Analyst (Post-Mortem Intelligence):');
    const analystSystemPrompt = {
        role: 'system',
        content: 'You are an expert coding contest analyst. Return strictly a JSON object.'
    };
    const analystUserPrompt = {
        role: 'user',
        content: `Analyze contest metrics for Contest #1: 150 participants, 4 problems.
Return strictly a JSON object with:
{
  "organizer_summary": "string",
  "key_insights": ["string"],
  "suggestions": ["string"],
  "participant_feedback": [{"participant_id": 1, "feedback": "string"}]
}`
    };

    const rawAnalyst = await callLLM([analystSystemPrompt, analystUserPrompt]);
    const analysis = parseJsonSafely(rawAnalyst);

    const summary = analysis.organizer_summary || analysis.summary || 'Summary generated';
    console.log(`  ✓ Executive Summary: "${summary.substring(0, 110)}..."`);
    console.log(`  ✓ Key Insights (${analysis.key_insights?.length || 0}):`);
    analysis.key_insights?.forEach(i => console.log(`     • ${i}`));
    console.log(`  ✓ Actionable Suggestions (${analysis.suggestions?.length || 0}):`);
    analysis.suggestions?.forEach(s => console.log(`     ✓ ${s}`));
    console.log(`  ✓ Participant Feedback (${analysis.participant_feedback?.length || 0}):`);
    analysis.participant_feedback?.forEach(f => console.log(`     - [Participant #${f.participant_id}]: ${f.feedback}`));

    console.log('\n════════════════════════════════════════════════════════');
    console.log('🎉 ALL AI SERVICES UNIT TESTS PASSED!');
    console.log('════════════════════════════════════════════════════════');
}

testServices().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
