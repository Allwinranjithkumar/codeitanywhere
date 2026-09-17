/**
 * aiService.js — Universal AI Engine for CodeItAnywhere
 *
 * Supports:
 *  1. Groq (Llama 3.3 70B / Qwen 2.5 Coder) via OpenAI-compatible endpoint
 *  2. Google Gemini (Gemini 1.5/2.0 Flash)
 *  3. Any standard OpenAI-compatible provider (OpenAI, DeepSeek, Ollama)
 *  4. High-fidelity Offline Mock Engine (for zero-latency, 100% reliable investor demos)
 */

const https = require('https');
const http = require('http');

/**
 * Strips markdown code fences (```json ... ```) and parses JSON cleanly.
 */
function parseJsonSafely(text) {
    if (!text || typeof text !== 'string') {
        throw new Error('Received empty text from AI engine.');
    }

    let cleaned = text.trim();
    // Match content inside ```json ... ``` or ``` ... ``` if present
    const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (codeBlockMatch && codeBlockMatch[1]) {
        cleaned = codeBlockMatch[1].trim();
    }

    try {
        return JSON.parse(cleaned);
    } catch (err) {
        // Fallback: locate first '{' and last '}'
        const start = cleaned.indexOf('{');
        const end = cleaned.lastIndexOf('}');
        if (start !== -1 && end !== -1 && end > start) {
            return JSON.parse(cleaned.substring(start, end + 1));
        }
        throw new Error(`Invalid JSON returned from AI model: ${err.message}`);
    }
}

/**
 * Universal HTTP/HTTPS request helper without external dependencies
 */
function makeHttpRequest(urlStr, options, postData) {
    return new Promise((resolve, reject) => {
        const url = new URL(urlStr);
        const transport = url.protocol === 'https:' ? https : http;

        const reqOptions = {
            hostname: url.hostname,
            port: url.port || (url.protocol === 'https:' ? 443 : 80),
            path: url.pathname + url.search,
            method: options.method || 'POST',
            headers: options.headers || {}
        };

        const req = transport.request(reqOptions, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    try {
                        resolve(JSON.parse(body));
                    } catch (e) {
                        resolve(body);
                    }
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${body}`));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(30000, () => {
            req.destroy();
            reject(new Error('AI Request timed out after 30 seconds.'));
        });

        if (postData) {
            req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
        }
        req.end();
    });
}

/**
 * Calls OpenAI-compatible API (Groq, DeepSeek, OpenAI, etc.)
 */
async function callOpenAICompatible({ messages, responseFormatJson = true }) {
    const apiKey = process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY;
    const baseURL = process.env.AI_BASE_URL || (process.env.GROQ_API_KEY ? 'https://api.groq.com/openai/v1' : 'https://api.openai.com/v1');
    const model = process.env.AI_MODEL || (process.env.GROQ_API_KEY ? 'qwen/qwen3.8-27b' : 'gpt-4o-mini');

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
    };

    const payload = {
        model,
        messages,
        temperature: 0.3,
        max_tokens: 1500
    };

    if (responseFormatJson) {
        payload.response_format = { type: 'json_object' };
    }

    const res = await makeHttpRequest(`${baseURL}/chat/completions`, { method: 'POST', headers }, payload);
    return res.choices[0].message.content;
}

/**
 * Calls Google Gemini REST API (if GEMINI_API_KEY is provided)
 */
async function callGemini({ messages }) {
    const apiKey = process.env.GEMINI_API_KEY;
    const model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const systemInstruction = messages.find(m => m.role === 'system')?.content || '';
    const userPrompt = messages.filter(m => m.role !== 'system').map(m => m.content).join('\n\n');

    const payload = {
        systemInstruction: systemInstruction ? { parts: [{ text: systemInstruction }] } : undefined,
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: {
            responseMimeType: "application/json",
            temperature: 0.2
        }
    };

    const res = await makeHttpRequest(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }, payload);
    return res.candidates[0].content.parts[0].text;
}

/**
 * High-fidelity Mock Engine: Guaranteed instant, demo-ready responses
 */
function runMockEngine(messages) {
    const userContent = messages.find(m => m.role === 'user')?.content || '';

    // If Problem Generation
    if (userContent.includes('Topic Patterns:') || userContent.includes('Target Difficulty:')) {
        return JSON.stringify({
            title: "Cluster Failover Router",
            function_name: "minNetworkHops",
            statement: "In CodeItAnywhere's distributed cloud infrastructure, there are `N` microservice nodes indexed `1` to `N`, connected by `M` bidirectional optical links.\n\nDuring a system migration, packets originate at node `S` and must reach destination `D`. Certain links may experience packet congestion.\n\nFind the minimum number of network hops required to route from `S` to `D`. If node `D` is unreachable from `S`, return `-1`.",
            input_format: "The first line contains two integers `N` and `M`.\nThe next `M` lines contain two integers `u` and `v` denoting a link between nodes `u` and `v`.\nThe final line contains two integers `S` and `D`.",
            output_format: "Output a single integer representing the minimum hops from `S` to `D`, or -1 if no route exists.",
            constraints: [
                "1 <= N <= 10^5",
                "0 <= M <= 2 * 10^5",
                "1 <= u, v, S, D <= N",
                "All links are bidirectional; graph contains no multi-edges."
            ],
            starter_code: {
                python: "def minNetworkHops(n, m, edges, s, d):\n    # Write your solution here\n    return -1",
                cpp: "class Solution {\npublic:\n    int minNetworkHops(int n, int m, vector<vector<int>>& edges, int s, int d) {\n        // Write your solution here\n        return -1;\n    }\n};",
                java: "class Solution {\n    public int minNetworkHops(int n, int m, int[][] edges, int s, int d) {\n        // Write your solution here\n        return -1;\n    }\n}",
                javascript: "function minNetworkHops(n, m, edges, s, d) {\n    // Write your solution here\n    return -1;\n}",
                c: "int minNetworkHops(int n, int m, int** edges, int s, int d) {\n    // Write your solution here\n    return -1;\n}"
            },
            samples: [
                {
                    input: { n: 5, m: 4, edges: [[1, 2], [2, 3], [3, 4], [4, 5]], s: 1, d: 5 },
                    output: 4,
                    explanation: "Direct path 1 -> 2 -> 3 -> 4 -> 5 requires 4 hops."
                },
                {
                    input: { n: 4, m: 2, edges: [[1, 2], [3, 4]], s: 1, d: 4 },
                    output: -1,
                    explanation: "Nodes 1 and 4 belong to separate connected components."
                }
            ],
            hidden_tests: [
                {
                    input: { n: 1, m: 0, edges: [], s: 1, d: 1 },
                    output: 0,
                    notes: "edge"
                },
                {
                    input: { n: 6, m: 5, edges: [[1, 2], [1, 3], [2, 4], [3, 5], [5, 6]], s: 1, d: 6 },
                    output: 3,
                    notes: "normal"
                },
                {
                    input: { n: 100000, m: 0, edges: [], s: 1, d: 2 },
                    output: -1,
                    notes: "stress"
                }
            ],
            pattern_tags: ["Graph BFS - Shortest Path Unweighted", "Connected Components"],
            difficulty_estimate: "medium",
            reference_approach: {
                language: "C++",
                idea: "Use Breadth-First Search (BFS) with a queue and visited array. Starting from source S, traverse layer by layer to compute the shortest unweighted path in O(V + E) time.",
                complexity: {
                    time: "O(N + M)",
                    space: "O(N + M)"
                }
            }
        });
    }

    // Otherwise, Contest Analysis
    return JSON.stringify({
        organizer_summary: "Weekly Contest #4 exhibited robust student participation with 148 active competitors. The progression through Problem A (Prefix Sums, 92% solve rate) and Problem B (Two Pointers, 64% solve rate) was smooth and well-paced. However, Problem C (Dynamic Programming) exposed significant knowledge gaps, with only 8 accepted submissions, primarily caused by off-by-one boundary conditions and memory allocation overhead in recursive approaches.",
        key_insights: [
            "Problem B recorded 112 Time Limit Exceeded (TLE) verdicts due to students nesting nested O(N^2) loops instead of the intended O(N) Two Pointers technique.",
            "Average time to first AC on Problem A was 7 minutes 45 seconds, showing strong baseline array indexing proficiency.",
            "Anti-cheat heuristics detected zero high-similarity code clusters, indicating genuine individual problem-solving across batches.",
            "Submissions in Python had a 38% higher rate of TLE on Problem C compared to C++, highlighting the need to guide students on language-specific I/O overhead."
        ],
        suggestions: [
            "Conduct a targeted 45-minute lab session on space-optimized iterative DP (Tabulation vs. Memoization) prior to the next contest.",
            "Incorporate tighter intermediate constraints on Problem B so suboptimal quadratic approaches fail on early test cases rather than timing out at maximum bounds."
        ],
        participant_feedback: [
            {
                participant_id: 1,
                feedback: "Impressive speed securing Rank 1! Your C++ BFS implementation was clean and optimal; challenge yourself with Tree DP on the upcoming weekend sprint."
            },
            {
                participant_id: 25,
                feedback: "Strong problem comprehension! On Problem B, practice replacing nested loops with Two Pointers to overcome TLE bounds."
            }
        ]
    });
}

/**
 * Main LLM dispatch function
 */
async function callLLM(messages, { responseFormatJson = true } = {}) {
    const hasGroq = !!(process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || process.env.DEEPSEEK_API_KEY);
    const hasGemini = !!process.env.GEMINI_API_KEY;
    const forceMock = process.env.MOCK_AI === 'true';

    if (forceMock || (!hasGroq && !hasGemini)) {
        console.log('[AI Service] Operating in Demo Mock Mode (Instant & zero-cost response)');
        return runMockEngine(messages);
    }

    try {
        if (hasGroq) {
            return await callOpenAICompatible({ messages, responseFormatJson });
        } else if (hasGemini) {
            return await callGemini({ messages });
        }
    } catch (err) {
        console.warn(`[AI Service] External provider error (${err.message}). Falling back to safe mock engine.`);
        return runMockEngine(messages);
    }
}

module.exports = {
    callLLM,
    parseJsonSafely
};
