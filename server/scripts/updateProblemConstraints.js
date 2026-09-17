/**
 * updateProblemConstraints.js
 * Updates all problems in PostgreSQL with rigorous, explicit competitive constraints
 * and clean mathematical descriptions (clarifying floor notation ⌊n / 2⌋).
 */

const db = require('../db');

const problemUpdates = [
    {
        id: 1,
        title: 'Majority Element',
        description: `<p>Given an array <code>nums</code> of size <code>n</code>, return the <strong>majority element</strong>.</p>
<p>The <strong>majority element</strong> is the element that appears strictly more than <code>⌊n / 2⌋</code> times (meaning strictly more than half of the total elements in the array, where <code>⌊x⌋</code> denotes the floor function rounding down). You may assume that the majority element always exists in the array.</p>
<p class="mt-3 text-xs text-zinc-400"><strong>Follow-up:</strong> Could you design a solution that runs in linear <code>O(n)</code> time and <code>O(1)</code> auxiliary space (Boyer-Moore Voting Algorithm)?</p>`,
        constraints: [
            'n == nums.length',
            '1 <= n <= 5 * 10^4',
            '-10^9 <= nums[i] <= 10^9',
            'A majority element is guaranteed to always exist in the array.',
            'Time Complexity Target: O(n)',
            'Space Complexity Target: O(1) auxiliary space'
        ]
    },
    {
        id: 2,
        title: 'Longest Palindromic Substring',
        description: `<p>Given a string <code>s</code>, return the <em>longest palindromic substring</em> in <code>s</code>.</p>
<p>A string is palindromic if it reads the same forward and backward.</p>`,
        constraints: [
            '1 <= s.length <= 1000',
            's consists of only lowercase and uppercase English letters and digits.',
            'Time Complexity Target: O(n^2) or O(n) (Manacher\'s Algorithm)',
            'Space Complexity Target: O(1) auxiliary space'
        ]
    },
    {
        id: 3,
        title: 'Longest Palindromic Substring',
        description: `<p>Given a string <code>s</code>, return the <em>longest palindromic substring</em> in <code>s</code>.</p>
<p>A string is palindromic if it reads the same forward and backward.</p>`,
        constraints: [
            '1 <= s.length <= 1000',
            's consists of only lowercase and uppercase English letters and digits.',
            'Time Complexity Target: O(n^2) or O(n) (Manacher\'s Algorithm)',
            'Space Complexity Target: O(1) auxiliary space'
        ]
    },
    {
        id: 4,
        title: 'Longest Palindromic Substring',
        description: `<p>Given a string <code>s</code>, return the <em>longest palindromic substring</em> in <code>s</code>.</p>
<p>A string is palindromic if it reads the same forward and backward.</p>`,
        constraints: [
            '1 <= s.length <= 1000',
            's consists of only lowercase and uppercase English letters and digits.',
            'Time Complexity Target: O(n^2) or O(n) (Manacher\'s Algorithm)',
            'Space Complexity Target: O(1) auxiliary space'
        ]
    },
    {
        id: 5,
        title: 'The Roman Vault Cipher',
        description: `<p>Roman numerals are represented by seven different symbols: <code>I</code>, <code>V</code>, <code>X</code>, <code>L</code>, <code>C</code>, <code>D</code>, and <code>M</code>.</p>
<p>Given a Roman numeral string <code>s</code>, convert it to an integer.</p>`,
        constraints: [
            '1 <= s.length <= 15',
            "s contains only the characters ('I', 'V', 'X', 'L', 'C', 'D', 'M')",
            's is guaranteed to be a valid Roman numeral in the range [1, 3999]',
            'Time Complexity Target: O(n)',
            'Space Complexity Target: O(1)'
        ]
    },
    {
        id: 6,
        title: 'The Roman Vault Cipher',
        description: `<p>Roman numerals are represented by seven different symbols: <code>I</code>, <code>V</code>, <code>X</code>, <code>L</code>, <code>C</code>, <code>D</code>, and <code>M</code>.</p>
<p>Given a Roman numeral string <code>s</code>, convert it to an integer.</p>`,
        constraints: [
            '1 <= s.length <= 15',
            "s contains only the characters ('I', 'V', 'X', 'L', 'C', 'D', 'M')",
            's is guaranteed to be a valid Roman numeral in the range [1, 3999]',
            'Time Complexity Target: O(n)',
            'Space Complexity Target: O(1)'
        ]
    },
    {
        id: 7,
        title: 'The Roman Vault Cipher',
        description: `<p>Roman numerals are represented by seven different symbols: <code>I</code>, <code>V</code>, <code>X</code>, <code>L</code>, <code>C</code>, <code>D</code>, and <code>M</code>.</p>
<p>Given a Roman numeral string <code>s</code>, convert it to an integer.</p>`,
        constraints: [
            '1 <= s.length <= 15',
            "s contains only the characters ('I', 'V', 'X', 'L', 'C', 'D', 'M')",
            's is guaranteed to be a valid Roman numeral in the range [1, 3999]',
            'Time Complexity Target: O(n)',
            'Space Complexity Target: O(1)'
        ]
    },
    {
        id: 8,
        title: 'Deep-Space Satellite Signal Locator',
        description: `<p>A constellation of orbital satellites transmits frequency beacons. Given an array of integers <code>frequencies</code>, find the maximum frequency beacon.</p>`,
        constraints: [
            '1 <= frequencies.length <= 10^5',
            '-10^9 <= frequencies[i] <= 10^9',
            'Time Complexity Target: O(n)',
            'Space Complexity Target: O(1)'
        ]
    },
    {
        id: 9,
        title: 'Orbital Cargo Payload Balancer',
        description: `<p>Given an array of cargo weights <code>weights</code> and an integer <code>target</code>, return the indices of the two weights such that they add up to <code>target</code>.</p>
<p>You may assume that each input will have <strong>exactly one solution</strong>, and you may not use the same element twice. You can return the answer in any order.</p>`,
        constraints: [
            '2 <= weights.length <= 10^4',
            '-10^9 <= weights[i] <= 10^9',
            '-10^9 <= target <= 10^9',
            'Exactly one valid answer exists.',
            'Time Complexity Target: O(n)',
            'Space Complexity Target: O(n)'
        ]
    },
    {
        id: 10,
        title: 'House Robber',
        description: `<p>You are a professional robber planning to rob houses along a street. Each house has a certain amount of money stashed. The only constraint stopping you from robbing each of them is that adjacent houses have security systems connected and <strong>it will automatically contact the police if two adjacent houses were broken into on the same night</strong>.</p>
<p>Given an integer array <code>nums</code> representing the amount of money of each house, return <em>the maximum amount of money you can rob tonight without alerting the police</em>.</p>`,
        constraints: [
            '1 <= nums.length <= 100',
            '0 <= nums[i] <= 400',
            'Time Complexity Target: O(n)',
            'Space Complexity Target: O(1) auxiliary space'
        ]
    },
    {
        id: 11,
        title: 'Pascals Triangle',
        description: `<p>Given an integer <code>numRows</code>, return the first <code>numRows</code> of <strong>Pascal's triangle</strong>.</p>
<p>In Pascal's triangle, each number is the sum of the two numbers directly above it.</p>`,
        constraints: [
            '1 <= numRows <= 30',
            'Time Complexity Target: O(numRows^2)',
            'Space Complexity Target: O(numRows^2)'
        ]
    },
    {
        id: 12,
        title: 'Palindrome Number',
        description: `<p>Given an integer <code>x</code>, return <code>true</code> if <code>x</code> is a <strong>palindrome</strong>, and <code>false</code> otherwise.</p>
<p>An integer is a palindrome when it reads the same forward and backward (e.g. <code>121</code> is, while <code>123</code> is not).</p>`,
        constraints: [
            '-2^31 <= x <= 2^31 - 1',
            'Negative integers cannot be palindromes due to leading negative sign.',
            'Follow-up: Could you solve it without converting the integer to a string?',
            'Time Complexity Target: O(log10(x))',
            'Space Complexity Target: O(1)'
        ]
    },
    {
        id: 13,
        title: 'Cluster Failover Router',
        description: `<p>In a distributed cloud network, <code>N</code> compute nodes are interconnected by <code>M</code> bidirectional fiber links. Determine if there is an active route between source node <code>S</code> and destination node <code>D</code>.</p>`,
        constraints: [
            '1 <= N <= 10^5',
            '0 <= M <= 2 * 10^5',
            '1 <= u, v, S, D <= N',
            'All links are bidirectional; graph contains no multi-edges or self-loops.',
            'Time Complexity Target: O(N + M)',
            'Space Complexity Target: O(N + M)'
        ]
    },
    {
        id: 14,
        title: 'Cluster Failover Router',
        description: `<p>In a distributed cloud network, <code>N</code> compute nodes are interconnected by <code>M</code> bidirectional fiber links. Determine if there is an active route between source node <code>S</code> and destination node <code>D</code>.</p>`,
        constraints: [
            '1 <= N <= 10^5',
            '0 <= M <= 2 * 10^5',
            '1 <= u, v, S, D <= N',
            'All links are bidirectional; graph contains no multi-edges or self-loops.',
            'Time Complexity Target: O(N + M)',
            'Space Complexity Target: O(N + M)'
        ]
    },
    {
        id: 15,
        title: 'Balanced Substring Extraction',
        description: `<p>Given a string <code>s</code>, find the length of the longest substring containing balanced characters.</p>`,
        constraints: [
            '1 <= |s| <= 10^5',
            's consists of lowercase English letters only (\'a\' through \'z\').',
            'Time Complexity Target: O(|s|)',
            'Space Complexity Target: O(1) auxiliary space'
        ]
    },
    {
        id: 16,
        title: 'Cluster Failover Router',
        description: `<p>In a distributed cloud network, <code>N</code> compute nodes are interconnected by <code>M</code> bidirectional fiber links. Determine if there is an active route between source node <code>S</code> and destination node <code>D</code>.</p>`,
        constraints: [
            '1 <= N <= 10^5',
            '0 <= M <= 2 * 10^5',
            '1 <= u, v, S, D <= N',
            'All links are bidirectional; graph contains no multi-edges or self-loops.',
            'Time Complexity Target: O(N + M)',
            'Space Complexity Target: O(N + M)'
        ]
    }
];

async function run() {
    console.log('[UpdateConstraints] Updating problems in PostgreSQL...');
    for (const update of problemUpdates) {
        const constraintsJson = JSON.stringify(update.constraints);
        const res = await db.query(
            `UPDATE problems 
             SET description = $1, constraints = $2, updated_at = NOW() 
             WHERE id = $3`,
            [update.description, constraintsJson, update.id]
        );
        console.log(`[UpdateConstraints] Updated problem #${update.id} (${update.title}): ${res.rowCount} row(s) updated.`);
    }
    console.log('[UpdateConstraints] Finished updating all problems.');
    process.exit(0);
}

run().catch(err => {
    console.error('[UpdateConstraints] Error:', err);
    process.exit(1);
});
