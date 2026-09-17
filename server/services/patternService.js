/**
 * patternService.js — DSA Pattern Taxonomy Ingestion
 *
 * Ingests DSA problem patterns from BYTS-SDE_SHEET.xlsx if present in the project,
 * or serves a rich, categorized standard taxonomy based on SDE sheets
 * (Two Pointers, Sliding Window, DP, Graphs, Trees, Heaps, DSU, etc.).
 */

const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');

let cachedPatterns = null;

// Rich standard fallback taxonomy categorized by SDE sheets
const FALLBACK_PATTERNS = [
    // Two Pointers & Arrays
    "Two Pointers - Opposite Direction",
    "Two Pointers - Same Direction",
    "Sliding Window - Fixed Size",
    "Sliding Window - Dynamic Size",
    "Prefix Sum & Difference Array",
    "Kadane's Algorithm (Max Subarray)",
    "Cyclic Sort",
    "Merge Intervals & Overlaps",
    
    // Searching & Sorting
    "Binary Search - Exact Match",
    "Binary Search on Answer / Monotonic",
    "Quickselect / Top K Elements",

    // Linked Lists & Stacks
    "Fast & Slow Pointers (Floyd's Cycle)",
    "In-place Reversal of LinkedList",
    "Monotonic Stack (Next Greater Element)",
    "Monotonic Queue / Min-Max Queue",

    // Trees & Graphs
    "Binary Tree BFS / Level Order",
    "Binary Tree DFS (Pre/In/Post/Euler)",
    "Lowest Common Ancestor (LCA)",
    "Graph BFS - Shortest Path Unweighted",
    "Graph DFS - Cycle Detection & Paths",
    "Dijkstra - Shortest Path Weighted",
    "Topological Sort (Kahn's / DFS)",
    "Disjoint Set Union (DSU / Kruskal)",
    "Trie / Prefix Tree",

    // Heaps & Greedy
    "Min/Max Heap - Priority Queue",
    "Two Heaps (Median of Stream)",
    "Greedy Interval Scheduling",

    // Dynamic Programming
    "1D DP - Fibonacci & Ladder",
    "1D DP - House Robber / Kadane Style",
    "2D DP - Grid Paths & Obstacles",
    "0/1 Knapsack & Subset Sum",
    "Unbounded Knapsack / Coin Change",
    "Longest Common Subsequence (LCS)",
    "Longest Increasing Subsequence (LIS)",
    "Bitmask DP",

    // Backtracking & Math
    "Subsets & Permutations Backtracking",
    "Bitwise XOR & Manipulation",
    "Number Theory (GCD, Sieve, Modular)"
];

/**
 * Returns the list of DSA patterns for problem creation and tagging.
 * Checks for BYTS-SDE_SHEET.xlsx at the root of the project first.
 */
function getDSAPatterns() {
    if (cachedPatterns && cachedPatterns.length > 0) {
        return cachedPatterns;
    }

    const possiblePaths = [
        path.resolve(__dirname, '../../BYTS-SDE_SHEET.xlsx'),
        path.resolve(__dirname, '../BYTS-SDE_SHEET.xlsx'),
        path.resolve(process.cwd(), 'BYTS-SDE_SHEET.xlsx'),
        path.resolve(process.cwd(), 'problems/BYTS-SDE_SHEET.xlsx')
    ];

    let sheetPath = possiblePaths.find(p => fs.existsSync(p));

    if (sheetPath) {
        try {
            console.log(`[PatternService] Ingesting taxonomy from: ${sheetPath}`);
            const workbook = xlsx.readFile(sheetPath);
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const records = xlsx.utils.sheet_to_json(firstSheet);

            const patternSet = new Set();
            for (const row of records) {
                // Look for common column names in SDE sheets
                const val = row['Pattern'] || row['pattern'] || row['Topic'] || row['topic'] || row['Category'] || row['category'];
                if (val && typeof val === 'string' && val.trim().length > 1) {
                    patternSet.add(val.trim());
                }
            }

            if (patternSet.size > 0) {
                cachedPatterns = Array.from(patternSet).sort();
                console.log(`[PatternService] Successfully loaded ${cachedPatterns.length} patterns from sheet.`);
                return cachedPatterns;
            }
        } catch (err) {
            console.warn(`[PatternService] Error reading Excel sheet (${err.message}). Using fallback taxonomy.`);
        }
    }

    // Fallback if sheet is not found or empty
    cachedPatterns = FALLBACK_PATTERNS;
    return cachedPatterns;
}

module.exports = {
    getDSAPatterns,
    FALLBACK_PATTERNS
};
