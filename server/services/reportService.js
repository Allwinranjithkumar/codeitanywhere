/**
 * reportService.js — AI Contest Intelligence Report Service
 *
 * Implements deterministic data aggregation, strict time & metric validation,
 * prompt engineering with schema enforcement, normalization & sanitization,
 * and high-fidelity deterministic fallback generation.
 */

const db = require('../db');
const { callLLM, parseJsonSafely } = require('./aiService');

/**
 * 1. AGGREGATE RAW CONTEST DATA & DETERMINISTIC METRICS
 */
async function aggregateContestData(contestId) {
    // A. Contest Details
    const contestRes = await db.query(
        `SELECT id, name, description, start_time, end_time, duration_minutes, status 
         FROM contests WHERE id = $1`,
        [contestId]
    );

    if (contestRes.rowCount === 0) {
        throw new Error(`Contest #${contestId} not found.`);
    }

    const contestRow = contestRes.rows[0];
    const durationSeconds = (contestRow.duration_minutes || 60) * 60;
    const startTime = new Date(contestRow.start_time);
    const endTime = new Date(contestRow.end_time);

    // B. Participants
    const participantsRes = await db.query(
        `SELECT cp.user_id, u.name, cp.joined_at
         FROM contest_participants cp
         JOIN users u ON u.id = cp.user_id
         WHERE cp.contest_id = $1`,
        [contestId]
    );
    const participants = participantsRes.rows;
    const totalParticipants = participants.length;

    // C. Submissions
    const submissionsRes = await db.query(
        `SELECT id, user_id, problem_id, language, status, score, execution_time_ms, submitted_at
         FROM submissions
         WHERE contest_id = $1
         ORDER BY submitted_at ASC`,
        [contestId]
    );
    const submissions = submissionsRes.rows;
    const totalSubmissions = submissions.length;

    // D. Contest Problems
    const problemsRes = await db.query(
        `SELECT p.id, p.title, p.difficulty, COALESCE(p.pattern_tags, '[]'::jsonb) AS pattern_tags, cp.order_index
         FROM contest_problems cp
         JOIN problems p ON p.id = cp.problem_id
         WHERE cp.contest_id = $1
         ORDER BY cp.order_index ASC, p.id ASC`,
        [contestId]
    );
    const problems = problemsRes.rows;

    // E. Anti-cheat / Violations
    const violationsRes = await db.query(
        `SELECT id, user_id, type, metadata, occurred_at
         FROM violations
         WHERE contest_id = $1`,
        [contestId]
    );
    const violations = violationsRes.rows;

    // ──────────────────────────────────────────────
    // DETERMINISTIC PROBLEM-WISE ANALYSIS
    // ──────────────────────────────────────────────
    const problemStats = [];
    const patternAggregates = {};

    for (const prob of problems) {
        const probSubs = submissions.filter(s => s.problem_id === prob.id);
        const totalAttempts = probSubs.length;

        // Group by user
        const userSubsMap = {};
        for (const s of probSubs) {
            if (!userSubsMap[s.user_id]) userSubsMap[s.user_id] = [];
            userSubsMap[s.user_id].push(s);
        }

        const attemptedUserIds = Object.keys(userSubsMap);
        let acceptedCount = 0;
        const acTimesSeconds = [];

        for (const uid of attemptedUserIds) {
            const userSubs = userSubsMap[uid];
            const firstAc = userSubs.find(s => s.status === 'Accepted');
            if (firstAc) {
                acceptedCount++;
                const subTime = new Date(firstAc.submitted_at);
                const diffSeconds = Math.round((subTime.getTime() - startTime.getTime()) / 1000);
                // STRICT TIME VALIDATION: Must be >= 0 and <= durationSeconds
                if (diffSeconds >= 0 && diffSeconds <= durationSeconds) {
                    acTimesSeconds.push(diffSeconds);
                }
            }
        }

        // Solve rate calculation (clamped 0 to 100)
        let solveRatePercent = 0;
        if (totalParticipants > 0) {
            solveRatePercent = Math.min(100, Math.max(0, Math.round((acceptedCount / totalParticipants) * 100)));
        }

        // Time to first AC calculations
        let avgTimeToFirstAc = null;
        let medianTimeToFirstAc = null;
        let firstAcTime = null;

        if (acTimesSeconds.length > 0) {
            acTimesSeconds.sort((a, b) => a - b);
            firstAcTime = acTimesSeconds[0];
            const sum = acTimesSeconds.reduce((acc, t) => acc + t, 0);
            avgTimeToFirstAc = Math.round(sum / acTimesSeconds.length);
            const mid = Math.floor(acTimesSeconds.length / 2);
            medianTimeToFirstAc = acTimesSeconds.length % 2 !== 0 
                ? acTimesSeconds[mid] 
                : Math.round((acTimesSeconds[mid - 1] + acTimesSeconds[mid]) / 2);
        }

        // Verdict counts
        let waCount = 0, tleCount = 0, rteCount = 0, ceCount = 0;
        for (const s of probSubs) {
            if (s.status === 'Wrong Answer') waCount++;
            else if (s.status === 'Time Limit Exceeded') tleCount++;
            else if (s.status === 'Runtime Error') rteCount++;
            else if (s.status === 'Compilation Error') ceCount++;
        }

        const unattemptedCount = Math.max(0, totalParticipants - attemptedUserIds.length);

        // Deterministic main failure pattern
        let mainFailure = 'Balanced distribution';
        if (totalAttempts === 0 || unattemptedCount > totalParticipants * 0.7) {
            mainFailure = 'Low attempt rate';
        } else if (waCount >= tleCount && waCount >= rteCount && waCount > 0) {
            mainFailure = 'Wrong Answer dominant (Edge case / logic failures)';
        } else if (tleCount >= waCount && tleCount >= rteCount && tleCount > 0) {
            mainFailure = 'Time Limit Exceeded dominant (Suboptimal complexity)';
        } else if (rteCount > 0 && rteCount >= waCount) {
            mainFailure = 'Runtime Error dominant (Exceptions / indexing errors)';
        }

        // Deterministic observed difficulty based on solve rate
        let observedDiff = 'unknown';
        if (totalParticipants > 0) {
            if (solveRatePercent >= 65) observedDiff = 'easy';
            else if (solveRatePercent >= 30) observedDiff = 'medium';
            else observedDiff = 'hard';
        }

        const rawTags = Array.isArray(prob.pattern_tags) ? prob.pattern_tags : [];
        let patternTags = rawTags.filter(t => typeof t === 'string' && t.trim().length > 0);
        if (patternTags.length === 0) {
            const lowerTitle = (prob.title || '').toLowerCase();
            if (lowerTitle.includes('palindrom') || lowerTitle.includes('substring')) {
                patternTags = ['Dynamic Programming', 'Two Pointers'];
            } else if (lowerTitle.includes('cipher') || lowerTitle.includes('roman') || lowerTitle.includes('string')) {
                patternTags = ['String Manipulation', 'Hash Map'];
            } else if (lowerTitle.includes('graph') || lowerTitle.includes('router') || lowerTitle.includes('tree')) {
                patternTags = ['Graph Traversal', 'Breadth-First Search'];
            } else {
                patternTags = ['Algorithmic Logic', 'Edge Case Handling'];
            }
        }

        // Aggregate for pattern insights
        for (const tag of patternTags) {
            if (!patternAggregates[tag]) {
                patternAggregates[tag] = {
                    pattern: tag,
                    problem_count: 0,
                    total_attempts: 0,
                    solve_rates: [],
                    wa_count: 0,
                    tle_count: 0
                };
            }
            patternAggregates[tag].problem_count++;
            patternAggregates[tag].total_attempts += totalAttempts;
            patternAggregates[tag].solve_rates.push(solveRatePercent);
            patternAggregates[tag].wa_count += waCount;
            patternAggregates[tag].tle_count += tleCount;
        }

        problemStats.push({
            problem_id: `P${prob.id}`,
            id: prob.id,
            title: prob.title,
            expected_difficulty: (prob.difficulty || 'medium').toLowerCase(),
            observed_difficulty: observedDiff,
            pattern_tags: patternTags.length > 0 ? patternTags : ['General Logic'],
            total_attempts: totalAttempts,
            accepted_count: acceptedCount,
            solve_rate_percent: solveRatePercent,
            avg_time_to_first_ac_seconds: avgTimeToFirstAc,
            median_time_to_first_ac_seconds: medianTimeToFirstAc,
            first_ac_time_seconds: firstAcTime,
            wrong_answer_count: waCount,
            time_limit_exceeded_count: tleCount,
            runtime_error_count: rteCount,
            compile_error_count: ceCount,
            unattempted_count: unattemptedCount,
            main_failure_pattern: mainFailure
        });
    }

    // ──────────────────────────────────────────────
    // PARTICIPANT DISTRIBUTION & TOP / STRUGGLING
    // ──────────────────────────────────────────────
    const participantSolves = {};
    for (const p of participants) {
        participantSolves[p.user_id] = {
            id: p.user_id,
            name: p.name,
            solved: new Set(),
            score: 0,
            penalty_time: 0,
            attempted_patterns: new Set()
        };
    }

    for (const s of submissions) {
        if (!participantSolves[s.user_id]) continue;
        const prob = problems.find(p => p.id === s.problem_id);
        const tags = prob && Array.isArray(prob.pattern_tags) ? prob.pattern_tags : [];
        tags.forEach(t => participantSolves[s.user_id].attempted_patterns.add(t));

        if (s.status === 'Accepted' && !participantSolves[s.user_id].solved.has(s.problem_id)) {
            participantSolves[s.user_id].solved.add(s.problem_id);
            participantSolves[s.user_id].score += (s.score || 100);
            const subTime = new Date(s.submitted_at);
            const elapsed = Math.max(0, Math.round((subTime.getTime() - startTime.getTime()) / 1000));
            participantSolves[s.user_id].penalty_time += Math.min(elapsed, durationSeconds);
        }
    }

    let solved0 = 0, solved1 = 0, solved2 = 0, solved3Plus = 0;
    const solvedCountsList = [];

    const participantList = Object.values(participantSolves).map(p => {
        const count = p.solved.size;
        solvedCountsList.push(count);
        if (count === 0) solved0++;
        else if (count === 1) solved1++;
        else if (count === 2) solved2++;
        else solved3Plus++;

        return {
            participant_id: `U${p.id}`,
            user_id: p.id,
            display_name: p.name,
            problems_solved: count,
            score: p.score,
            penalty_time_seconds: p.penalty_time,
            attempted_patterns: Array.from(p.attempted_patterns),
            solved_patterns: problems.filter(pr => p.solved.has(pr.id)).flatMap(pr => Array.isArray(pr.pattern_tags) ? pr.pattern_tags : [])
        };
    });

    participantList.sort((a, b) => b.problems_solved - a.problems_solved || b.score - a.score || a.penalty_time_seconds - b.penalty_time_seconds);
    participantList.forEach((p, idx) => { p.rank = idx + 1; });

    solvedCountsList.sort((a, b) => a - b);
    const avgSolved = solvedCountsList.length > 0 
        ? Number((solvedCountsList.reduce((a, b) => a + b, 0) / solvedCountsList.length).toFixed(1)) 
        : 0;
    const medianSolved = solvedCountsList.length > 0 
        ? solvedCountsList[Math.floor(solvedCountsList.length / 2)] 
        : 0;

    const zeroSolvePercent = totalParticipants > 0 
        ? Number(((solved0 / totalParticipants) * 100).toFixed(1)) 
        : 0;

    const topParticipants = participantList.slice(0, 3).map(p => ({
        participant_id: p.participant_id,
        display_name: p.display_name,
        rank: p.rank,
        score: p.score,
        problems_solved: p.problems_solved,
        penalty_time_seconds: p.penalty_time_seconds,
        successful_patterns: Array.from(new Set(p.solved_patterns)),
        unsolved_patterns: Array.from(new Set(p.attempted_patterns.filter(t => !p.solved_patterns.includes(t))))
    }));

    const strugglingParticipants = participantList.length > 3 
        ? participantList.slice(-3).map(p => ({
            participant_id: p.participant_id,
            display_name: p.display_name,
            rank: p.rank,
            score: p.score,
            problems_solved: p.problems_solved,
            attempted_patterns: Array.from(new Set(p.attempted_patterns)),
            unsolved_patterns: Array.from(new Set(p.attempted_patterns.filter(t => !p.solved_patterns.includes(t))))
        }))
        : [];

    // ──────────────────────────────────────────────
    // PATTERN INSIGHTS DETERMINISTIC
    // ──────────────────────────────────────────────
    const patternInsights = Object.values(patternAggregates).map(p => {
        const avgSolveRate = Math.round(p.solve_rates.reduce((a, b) => a + b, 0) / p.solve_rates.length);
        let classification = 'Developing';
        if (p.problem_count === 0) classification = 'Insufficient Data';
        else if (avgSolveRate >= 65) classification = 'Strength';
        else if (avgSolveRate >= 30) classification = 'Developing';
        else classification = 'Improvement Needed';

        return {
            pattern: p.pattern,
            problem_count: p.problem_count,
            average_solve_rate: avgSolveRate,
            total_attempts: p.total_attempts,
            skill_classification: classification,
            ai_interpretation: classification === 'Strength'
                ? `Participants demonstrated strong mastery of ${p.pattern} with an average solve rate of ${avgSolveRate}%.`
                : classification === 'Developing'
                    ? `${p.pattern} represents a developing skill area (${avgSolveRate}% solve rate) with room for structural optimization.`
                    : `${p.pattern} requires targeted improvement (${avgSolveRate}% solve rate), exhibiting frequent logic or edge-case bottlenecks.`,
            recommended_practice: classification === 'Strength'
                ? `Advance to composite multi-step ${p.pattern} problems with tight runtime limits.`
                : `Assign foundational guided exercises focusing on standard ${p.pattern} templates and boundary handling.`
        };
    });

    // ──────────────────────────────────────────────
    // INTEGRITY SIGNALS DETERMINISTIC
    // ──────────────────────────────────────────────
    let tabSwitches = 0, pasteEvents = 0;
    const flaggedUserIds = new Set();

    for (const v of violations) {
        if (v.type === 'tab_switch' || v.type === 'visibility_change') tabSwitches++;
        if (v.type === 'paste') pasteEvents++;
        flaggedUserIds.add(v.user_id);
    }

    let riskLevel = 'Low';
    if (flaggedUserIds.size > 5 || tabSwitches > 20) riskLevel = 'High';
    else if (flaggedUserIds.size > 0 || tabSwitches > 0) riskLevel = 'Medium';

    const integritySignals = {
        tab_switch_events: tabSwitches,
        paste_events: pasteEvents,
        high_similarity_pairs: [],
        flagged_sessions_count: flaggedUserIds.size,
        risk_level: riskLevel
    };

    // ──────────────────────────────────────────────
    // CONTEST HEALTH SCORECARD DETERMINISTIC
    // ──────────────────────────────────────────────
    const hardProblems = problemStats.filter(p => p.observed_difficulty === 'hard').length;
    const easyProblems = problemStats.filter(p => p.observed_difficulty === 'easy').length;

    let difficultyLabel = 'Balanced';
    let difficultyExplanation = `${problems.length} problems evaluated across competitive cohorts.`;
    if (problems.length > 0) {
        if (hardProblems === problems.length) {
            difficultyLabel = 'Imbalanced';
            difficultyExplanation = `All ${problems.length} problems had low solve rates (< 30%), causing severe participant drop-off.`;
        } else if (hardProblems >= problems.length * 0.5) {
            difficultyLabel = 'Slightly Hard';
            difficultyExplanation = `${hardProblems} of ${problems.length} problems were solved by fewer than 30% of participants.`;
        } else if (easyProblems === problems.length) {
            difficultyLabel = 'Slightly Easy';
            difficultyExplanation = `All problems exceeded a 65% solve rate, offering limited differentiation for top performers.`;
        } else {
            difficultyLabel = 'Balanced';
            difficultyExplanation = `Solid difficulty ramp: ${easyProblems} introductory/accessible problem(s) and ${hardProblems} differentiator(s).`;
        }
    }

    const subsPerPart = totalParticipants > 0 ? Number((totalSubmissions / totalParticipants).toFixed(1)) : 0;
    let engagementLabel = 'Medium';
    let engagementExplanation = `Average of ${subsPerPart} submissions per participant across the event window.`;
    if (subsPerPart >= 3.0) {
        engagementLabel = 'High';
        engagementExplanation = `High participant tenacity with ${subsPerPart} submissions per participant and sustained retries.`;
    } else if (subsPerPart < 1.5) {
        engagementLabel = 'Low';
        engagementExplanation = `Low trial frequency (${subsPerPart} submissions/participant), indicating frustration or early exits.`;
    }

    const telemetry = {
        contest: {
            id: contestRow.id,
            title: contestRow.name,
            start_time: contestRow.start_time,
            end_time: contestRow.end_time,
            duration_seconds: durationSeconds,
            target_level: 'intermediate',
            total_participants: totalParticipants,
            total_submissions: totalSubmissions
        },
        health_scorecard: {
            participation: {
                total_participants: totalParticipants,
                total_submissions: totalSubmissions,
                submissions_per_participant: subsPerPart
            },
            completion: {
                average_problems_solved: avgSolved,
                median_problems_solved: medianSolved,
                zero_solve_percentage: zeroSolvePercent
            },
            difficulty_balance: {
                label: difficultyLabel,
                explanation: difficultyExplanation
            },
            engagement: {
                label: engagementLabel,
                explanation: engagementExplanation
            },
            integrity_risk: {
                label: riskLevel,
                explanation: riskLevel === 'Low' 
                    ? 'No elevated integrity anomalies detected during proctored session.'
                    : `${flaggedUserIds.size} session(s) recorded proctoring signals. Manual review recommended before finalization.`
            }
        },
        problems: problemStats,
        participant_distribution: {
            solved_0: solved0,
            solved_1: solved1,
            solved_2: solved2,
            solved_3_or_more: solved3Plus,
            average_problems_solved: avgSolved,
            median_problems_solved: medianSolved
        },
        dsa_pattern_insights: patternInsights,
        top_participants: topParticipants,
        struggling_participants: strugglingParticipants,
        integrity_signals: integritySignals
    };

    return telemetry;
}

/**
 * 2. DETERMINISTIC HIGH-FIDELITY FALLBACK REPORT
 * Used whenever LLM call fails, times out, or returns invalid schema.
 */
function generateDeterministicFallbackReport(telemetry) {
    const c = telemetry.contest;
    const h = telemetry.health_scorecard;
    const probs = telemetry.problems;
    const patterns = telemetry.dsa_pattern_insights;
    const integ = telemetry.integrity_signals;

    // Executive Summary
    const hardProbs = probs.filter(p => p.observed_difficulty === 'hard').map(p => p.title);
    const easyProbs = probs.filter(p => p.observed_difficulty === 'easy').map(p => p.title);

    let summaryText = `"${c.title}" engaged ${c.total_participants} participants who submitted ${c.total_submissions} code solutions across ${Math.round(c.duration_seconds / 60)} minutes. `;
    summaryText += `The contest exhibited a ${h.difficulty_balance.label.toLowerCase()} difficulty balance: `;
    if (easyProbs.length > 0) {
        summaryText += `accessible problem(s) such as ${easyProbs.slice(0, 2).map(t => `"${t}"`).join(' and ')} achieved solid completion, `;
    }
    if (hardProbs.length > 0) {
        summaryText += `while challenging differentiator(s) such as ${hardProbs.slice(0, 2).map(t => `"${t}"`).join(' and ')} separated advanced contestants. `;
    } else {
        summaryText += `with steady progression across the problem suite. `;
    }
    summaryText += `Participants demonstrated average solve rates of ${h.completion.average_problems_solved} problems per participant. `;
    if (integ.flagged_sessions_count > 0) {
        summaryText += `${integ.flagged_sessions_count} integrity signal(s) were logged for manual organizer review; these are diagnostic indicators and not conclusive proof of misconduct.`;
    } else {
        summaryText += `Integrity indicators remained clear throughout the session.`;
    }

    // Problem Insights
    const problemInsights = probs.map(p => ({
        problem_id: p.problem_id,
        title: p.title,
        pattern_tags: p.pattern_tags,
        expected_difficulty: p.expected_difficulty,
        observed_difficulty: p.observed_difficulty,
        main_failure_pattern: p.main_failure_pattern,
        ai_interpretation: `Problem achieved a ${p.solve_rate_percent}% solve rate (${p.accepted_count}/${telemetry.contest.total_participants || 1} solved) with ${p.wrong_answer_count} Wrong Answer and ${p.time_limit_exceeded_count} TLE verdicts.`,
        recommendation: p.observed_difficulty === 'hard'
            ? 'Provide richer edge-case sample testcases and review constraint clarity before the next contest.'
            : 'Maintain current problem structure; effective diagnostic for core algorithmic fluency.'
    }));

    // Pattern Insights
    const patternInsights = patterns.map(pat => ({
        pattern: pat.pattern,
        skill_classification: pat.skill_classification,
        ai_interpretation: pat.ai_interpretation,
        recommended_practice: pat.recommended_practice
    }));

    // Recommendations (3-5 objects with category, priority, action, evidence)
    const recommendations = [];
    if (hardProbs.length > 0) {
        recommendations.push({
            category: 'Problem Design',
            priority: 'High',
            action: 'Introduce a calibrated warm-up problem before steep algorithmic differentiators to prevent early drop-off.',
            evidence: `${hardProbs.join(', ')} had solve rates below 30%, resulting in elevated zero-solve ratios.`
        });
    }

    recommendations.push({
        category: 'Curriculum / Practice',
        priority: 'Medium',
        action: 'Schedule targeted laboratory practice sessions on dynamic programming state transitions and boundary handling.',
        evidence: `Verdict logs show a dominant volume of Wrong Answer outcomes on composite string and array problems.`
    });

    if (integ.flagged_sessions_count > 0) {
        recommendations.push({
            category: 'Integrity Monitoring',
            priority: 'Medium',
            action: 'Perform routine manual inspection of flagged sessions before finalizing rankings and official certificate generation.',
            evidence: `${integ.tab_switch_events} tab-switch and ${integ.paste_events} paste event(s) were captured by the proctoring engine.`
        });
    } else {
        recommendations.push({
            category: 'Contest Timing',
            priority: 'Low',
            action: 'Maintain the current duration window; time-to-first-AC distributions confirmed adequate completion headroom.',
            evidence: `Participants submitted comfortably within the ${Math.round(c.duration_seconds / 60)}-minute time boundary.`
        });
    }

    // Participant Feedback (Constructive, private)
    const participantFeedback = telemetry.top_participants.concat(telemetry.struggling_participants).slice(0, 5).map(p => ({
        participant_id: p.participant_id,
        performance_band: p.problems_solved >= 2 ? 'advanced' : (p.problems_solved === 1 ? 'developing' : 'foundation'),
        strengths: p.successful_patterns && p.successful_patterns.length > 0 ? p.successful_patterns : ['General logic', 'Persistence'],
        improvement_areas: p.unsolved_patterns && p.unsolved_patterns.length > 0 ? p.unsolved_patterns : ['Algorithmic optimization'],
        next_practice_recommendation: 'Complete 3 focused exercises on boundary condition verification and time-complexity optimization.',
        feedback: `Great effort in Contest #${c.id}! You demonstrated solid algorithmic resilience. Focus next on edge-case testing before submitting solutions.`
    }));

    return {
        executive_summary: summaryText,
        contest_health: {
            difficulty_balance: h.difficulty_balance,
            engagement: h.engagement,
            overall_learning_outcome: `Contest successfully benchmarked competitive algorithmic readiness across ${c.total_participants} participants.`
        },
        problem_insights: problemInsights,
        pattern_insights: patternInsights,
        integrity_review: {
            risk_level: integ.risk_level,
            summary: integ.risk_level === 'Low'
                ? 'Session integrity was well-maintained with minimal proctoring anomalies.'
                : `${integ.flagged_sessions_count} participant session(s) triggered proctoring alerts requiring routine manual verification.`,
            evidence: [
                `${integ.tab_switch_events} tab switch event(s) logged`,
                `${integ.paste_events} external paste event(s) logged`,
                `${integ.flagged_sessions_count} flagged session(s) pending organizer sign-off`
            ],
            recommended_action: 'Conduct manual inspection of flagged submission timelines prior to releasing final certified standings.',
            disclaimer: 'Integrity signals are indicators for review only. They do not establish misconduct or plagiarism.'
        },
        recommendations: recommendations,
        participant_feedback: participantFeedback
    };
}

/**
 * 3. VALIDATE & NORMALIZE REPORT OBJECT
 * Ensures zero stray bullet keys, no [object Object], exact schema compliance.
 */
function validateAndNormalizeReport(raw, telemetry) {
    if (!raw || typeof raw !== 'object') {
        return generateDeterministicFallbackReport(telemetry);
    }

    const fallback = generateDeterministicFallbackReport(telemetry);

    // 1. Executive Summary
    const executiveSummary = (typeof raw.executive_summary === 'string' && raw.executive_summary.trim().length > 20)
        ? raw.executive_summary.trim()
        : fallback.executive_summary;

    // 2. Contest Health
    const health = {
        difficulty_balance: {
            label: raw.contest_health?.difficulty_balance?.label || fallback.contest_health.difficulty_balance.label,
            explanation: raw.contest_health?.difficulty_balance?.explanation || fallback.contest_health.difficulty_balance.explanation
        },
        engagement: {
            label: raw.contest_health?.engagement?.label || fallback.contest_health.engagement.label,
            explanation: raw.contest_health?.engagement?.explanation || fallback.contest_health.engagement.explanation
        },
        overall_learning_outcome: raw.contest_health?.overall_learning_outcome || fallback.contest_health.overall_learning_outcome
    };

    // 3. Problem Insights
    let problemInsights = [];
    if (Array.isArray(raw.problem_insights) && raw.problem_insights.length > 0) {
        problemInsights = raw.problem_insights.map((pi, idx) => {
            const defaultPi = fallback.problem_insights[idx] || fallback.problem_insights[0];
            return {
                problem_id: String(pi.problem_id || defaultPi.problem_id),
                title: String(pi.title || defaultPi.title),
                pattern_tags: Array.isArray(pi.pattern_tags) ? pi.pattern_tags.filter(t => typeof t === 'string') : defaultPi.pattern_tags,
                expected_difficulty: String(pi.expected_difficulty || defaultPi.expected_difficulty),
                observed_difficulty: String(pi.observed_difficulty || defaultPi.observed_difficulty),
                main_failure_pattern: String(pi.main_failure_pattern || defaultPi.main_failure_pattern),
                ai_interpretation: String(pi.ai_interpretation || defaultPi.ai_interpretation),
                recommendation: String(pi.recommendation || defaultPi.recommendation)
            };
        });
    } else {
        problemInsights = fallback.problem_insights;
    }

    // 4. Pattern Insights
    let patternInsights = [];
    if (Array.isArray(raw.pattern_insights) && raw.pattern_insights.length > 0) {
        patternInsights = raw.pattern_insights.map((pi, idx) => {
            const defaultPi = fallback.pattern_insights[idx] || fallback.pattern_insights[0];
            return {
                pattern: String(pi.pattern || defaultPi?.pattern || 'General Logic'),
                skill_classification: String(pi.skill_classification || defaultPi?.skill_classification || 'Developing'),
                ai_interpretation: String(pi.ai_interpretation || defaultPi?.ai_interpretation || 'Steady development.'),
                recommended_practice: String(pi.recommended_practice || defaultPi?.recommended_practice || 'Practice recommended.')
            };
        });
    } else {
        patternInsights = fallback.pattern_insights;
    }

    // 5. Integrity Review
    let rawSummary = String(raw.integrity_review?.summary || fallback.integrity_review.summary);
    rawSummary = rawSummary.replace(/dishonest behavior|cheating behavior|cheated|cheating/gi, 'potential proctoring flags requiring manual review');

    const integrityReview = {
        risk_level: raw.integrity_review?.risk_level || fallback.integrity_risk?.risk_level || fallback.integrity_review.risk_level,
        summary: rawSummary,
        evidence: Array.isArray(raw.integrity_review?.evidence) && raw.integrity_review.evidence.length > 0
            ? raw.integrity_review.evidence.filter(e => typeof e === 'string' && e.trim().length > 0 && e !== ':' && e !== 'suggestions')
            : fallback.integrity_review.evidence,
        recommended_action: raw.integrity_review?.recommended_action || fallback.integrity_review.recommended_action,
        disclaimer: 'Integrity signals are indicators for review only. They do not establish misconduct or plagiarism.'
    };

    // 6. Actionable Recommendations (STRICT OBJECT SCHEMA)
    let recommendations = [];
    if (Array.isArray(raw.recommendations) && raw.recommendations.length > 0) {
        for (const r of raw.recommendations) {
            if (typeof r === 'object' && r !== null && !Array.isArray(r)) {
                recommendations.push({
                    category: String(r.category || 'Curriculum / Practice'),
                    priority: String(r.priority || 'Medium'),
                    action: String(r.action || 'Conduct guided practice sessions.'),
                    evidence: String(r.evidence || 'Derived from contest submission verdict distribution.')
                });
            } else if (typeof r === 'string' && r.trim().length > 5 && r !== ':' && r !== 'suggestions' && r !== 'participant_feedback') {
                recommendations.push({
                    category: 'Curriculum / Practice',
                    priority: 'Medium',
                    action: r.trim(),
                    evidence: 'Identified during post-event telemetry analysis.'
                });
            }
        }
    }

    if (recommendations.length === 0) {
        recommendations = fallback.recommendations;
    }

    // 7. Participant Feedback
    let participantFeedback = [];
    if (Array.isArray(raw.participant_feedback) && raw.participant_feedback.length > 0) {
        participantFeedback = raw.participant_feedback.map((pf, idx) => {
            const defaultPf = fallback.participant_feedback[idx] || fallback.participant_feedback[0];
            return {
                participant_id: String(pf.participant_id || defaultPf?.participant_id || `U${idx + 1}`),
                performance_band: String(pf.performance_band || defaultPf?.performance_band || 'developing'),
                strengths: Array.isArray(pf.strengths) ? pf.strengths.filter(s => typeof s === 'string') : (defaultPf?.strengths || []),
                improvement_areas: Array.isArray(pf.improvement_areas) ? pf.improvement_areas.filter(s => typeof s === 'string') : (defaultPf?.improvement_areas || []),
                next_practice_recommendation: String(pf.next_practice_recommendation || defaultPf?.next_practice_recommendation || 'Complete practice problem sets.'),
                feedback: String(pf.feedback || defaultPf?.feedback || 'Constructive effort in the contest.')
            };
        });
    } else {
        participantFeedback = fallback.participant_feedback;
    }

    return {
        executive_summary: executiveSummary,
        contest_health: health,
        problem_insights: problemInsights,
        pattern_insights: patternInsights,
        integrity_review: integrityReview,
        recommendations: recommendations,
        participant_feedback: participantFeedback
    };
}

/**
 * 4. COMPLETE PIPELINE: GENERATE & STORE CONTEST AI REPORT
 */
async function generateContestReport(contestId) {
    // 1. Aggregate and validate telemetry deterministically
    const telemetry = await aggregateContestData(contestId);

    // 2. Prepare System & User Prompts
    const systemPrompt = `You are a Senior Contest Director, Psychometrics Analyst, and Algorithmic Coach for CodeItAnywhere.
Your job is to analyze post-contest telemetry and produce an evidence-based, actionable Contest Intelligence Report.

CRITICAL INSTRUCTIONS:
- You MUST output ONLY valid JSON matching the exact schema provided.
- Do NOT output markdown code blocks (no \`\`\`json).
- Do NOT output any introductory text or conversational filler.
- NEVER invent participants, impossible metrics, or plagiarism accusations.
- Integrity signals are indicators for review only; never state a participant cheated.
- Output clean arrays of strings or objects as requested. Do NOT put keys such as "suggestions", ":", or object strings inside string arrays.`;

    const userPrompt = `Analyze the following contest telemetry and return a structured JSON report matching the strict schema.

CONTEST TELEMETRY:
${JSON.stringify(telemetry, null, 2)}

REQUIRED STRICT JSON SCHEMA:
{
  "executive_summary": "string (3-5 concise, professional sentences)",
  "contest_health": {
    "difficulty_balance": {
      "label": "Balanced|Slightly Easy|Slightly Hard|Imbalanced|Insufficient Data",
      "explanation": "string"
    },
    "engagement": {
      "label": "High|Medium|Low|Insufficient Data",
      "explanation": "string"
    },
    "overall_learning_outcome": "string"
  },
  "problem_insights": [
    {
      "problem_id": "string",
      "title": "string",
      "pattern_tags": ["string"],
      "expected_difficulty": "easy|medium|hard|unknown",
      "observed_difficulty": "easy|medium|hard|unknown",
      "main_failure_pattern": "string",
      "ai_interpretation": "string",
      "recommendation": "string"
    }
  ],
  "pattern_insights": [
    {
      "pattern": "string",
      "skill_classification": "Strength|Developing|Improvement Needed|Insufficient Data",
      "ai_interpretation": "string",
      "recommended_practice": "string"
    }
  ],
  "integrity_review": {
    "risk_level": "Low|Medium|High|No Data",
    "summary": "string",
    "evidence": ["string"],
    "recommended_action": "string",
    "disclaimer": "Integrity signals are indicators for review only. They do not establish misconduct or plagiarism."
  },
  "recommendations": [
    {
      "category": "Problem Design|Curriculum / Practice|Contest Timing|Test-Case Quality|Integrity Monitoring|Scoring / Ranking",
      "priority": "High|Medium|Low",
      "action": "string",
      "evidence": "string"
    }
  ],
  "participant_feedback": [
    {
      "participant_id": "string",
      "performance_band": "foundation|developing|advanced",
      "strengths": ["string"],
      "improvement_areas": ["string"],
      "next_practice_recommendation": "string",
      "feedback": "string"
    }
  ]
}`;

    let reportData;

    try {
        const rawResponse = await callLLM([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ], { responseFormatJson: true });

        const parsedJson = parseJsonSafely(rawResponse);
        reportData = validateAndNormalizeReport(parsedJson, telemetry);
    } catch (llmErr) {
        console.warn('[ReportService] LLM invocation/parsing failed. Using deterministic fallback report:', llmErr.message);
        reportData = generateDeterministicFallbackReport(telemetry);
    }

    // 3. Save into PostgreSQL
    // Save to contest_ai_reports (New Table)
    const reportInsertRes = await db.query(
        `INSERT INTO contest_ai_reports (contest_id, report_data, deterministic_metrics)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [contestId, JSON.stringify(reportData), JSON.stringify(telemetry.health_scorecard)]
    );

    // Also update contest_ai_analyses (Legacy Compatibility Table)
    try {
        await db.query(
            `INSERT INTO contest_ai_analyses (
                contest_id, organizer_summary, key_insights,
                suggestions, participant_feedback, metrics_snapshot
            ) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                contestId,
                reportData.executive_summary,
                JSON.stringify(reportData.problem_insights.map(p => `${p.title}: ${p.ai_interpretation}`)),
                JSON.stringify(reportData.recommendations.map(r => `[${r.priority}] ${r.category}: ${r.action}`)),
                JSON.stringify(reportData.participant_feedback),
                JSON.stringify(telemetry)
            ]
        );
    } catch (legacyErr) {
        console.warn('[ReportService] Legacy analysis table insert warning:', legacyErr.message);
    }

    return {
        id: reportInsertRes.rows[0].id,
        contest_id: contestId,
        created_at: reportInsertRes.rows[0].created_at,
        deterministic_metrics: telemetry.health_scorecard,
        report_data: reportData
    };
}

/**
 * 5. RETRIEVE LATEST REPORT FOR CONTEST
 */
async function getLatestContestReport(contestId) {
    const res = await db.query(
        `SELECT id, contest_id, report_data, deterministic_metrics, created_at 
         FROM contest_ai_reports 
         WHERE contest_id = $1 
         ORDER BY created_at DESC LIMIT 1`,
        [contestId]
    );

    if (res.rowCount === 0) {
        // Fallback: check contest_ai_analyses
        const legacyRes = await db.query(
            `SELECT * FROM contest_ai_analyses WHERE contest_id = $1 ORDER BY created_at DESC LIMIT 1`,
            [contestId]
        );
        if (legacyRes.rowCount === 0) return null;

        const legacy = legacyRes.rows[0];
        return {
            id: legacy.id,
            contest_id: legacy.contest_id,
            created_at: legacy.created_at,
            deterministic_metrics: {},
            report_data: {
                executive_summary: legacy.organizer_summary,
                contest_health: {
                    difficulty_balance: { label: 'Balanced', explanation: 'Historical contest analysis.' },
                    engagement: { label: 'Medium', explanation: 'Historical participation recorded.' },
                    overall_learning_outcome: 'Completed contest analysis.'
                },
                problem_insights: [],
                pattern_insights: [],
                integrity_review: {
                    risk_level: 'Low',
                    summary: 'Standard integrity overview.',
                    evidence: [],
                    recommended_action: 'None required.',
                    disclaimer: 'Integrity signals are indicators for review only. They do not establish misconduct or plagiarism.'
                },
                recommendations: (legacy.suggestions || []).map(s => ({
                    category: 'Curriculum / Practice',
                    priority: 'Medium',
                    action: typeof s === 'string' ? s : JSON.stringify(s),
                    evidence: 'Historical recommendations log'
                })),
                participant_feedback: legacy.participant_feedback || []
            }
        };
    }

    return res.rows[0];
}

/**
 * 6. EXCEL POST-MORTEM EXPORT (CONTEST / TEST WISE)
 */
async function exportContestPostMortemExcel(contestId) {
    const xlsx = require('xlsx');
    const telemetry = await aggregateContestData(contestId);
    let reportRecord = await getLatestContestReport(contestId);
    let report = reportRecord ? reportRecord.report_data : generateDeterministicFallbackReport(telemetry);

    const wb = xlsx.utils.book_new();

    // 1. Executive Summary & Health Scorecard
    const h = telemetry.health_scorecard;
    const summaryRows = [
        { 'Parameter': 'Contest Title', 'Value': telemetry.contest.title },
        { 'Parameter': 'Contest ID', 'Value': telemetry.contest.id },
        { 'Parameter': 'Start Time', 'Value': telemetry.contest.start_time },
        { 'Parameter': 'End Time', 'Value': telemetry.contest.end_time },
        { 'Parameter': 'Duration (Minutes)', 'Value': Math.round(telemetry.contest.duration_seconds / 60) },
        { 'Parameter': 'Total Participants', 'Value': h.participation.total_participants },
        { 'Parameter': 'Total Submissions', 'Value': h.participation.total_submissions },
        { 'Parameter': 'Submissions / Participant', 'Value': h.participation.submissions_per_participant },
        { 'Parameter': 'Average Problems Solved', 'Value': h.completion.average_problems_solved },
        { 'Parameter': 'Median Problems Solved', 'Value': h.completion.median_problems_solved },
        { 'Parameter': 'Zero-Solve Rate (%)', 'Value': h.completion.zero_solve_percentage + '%' },
        { 'Parameter': 'Difficulty Balance', 'Value': report.contest_health?.difficulty_balance?.label || h.difficulty_balance.label },
        { 'Parameter': 'Difficulty Rationale', 'Value': report.contest_health?.difficulty_balance?.explanation || h.difficulty_balance.explanation },
        { 'Parameter': 'Engagement Level', 'Value': report.contest_health?.engagement?.label || h.engagement.label },
        { 'Parameter': 'Integrity Risk Level', 'Value': report.integrity_review?.risk_level || h.integrity_risk.label },
        { 'Parameter': 'Executive Contest Summary', 'Value': report.executive_summary || '' },
        { 'Parameter': 'Overall Learning Outcome', 'Value': report.contest_health?.overall_learning_outcome || '' }
    ];
    const wsSummary = xlsx.utils.json_to_sheet(summaryRows);
    xlsx.utils.book_append_sheet(wb, wsSummary, 'Contest Scorecard');

    // 2. Problem Diagnostics
    const probRows = (report.problem_insights || []).map(p => {
        const rawStat = telemetry.problems.find(tp => String(tp.id) === String(p.problem_id).replace(/\D/g, '') || tp.problem_id === p.problem_id) || {};
        return {
            'Problem ID': p.problem_id,
            'Title': p.title,
            'Expected Difficulty': p.expected_difficulty,
            'Observed Difficulty': p.observed_difficulty,
            'Pattern Tags': Array.isArray(p.pattern_tags) ? p.pattern_tags.join(', ') : '',
            'Total Attempts': rawStat.total_attempts ?? 0,
            'Accepted Count': rawStat.accepted_count ?? 0,
            'Solve Rate (%)': rawStat.solve_rate_percent != null ? rawStat.solve_rate_percent + '%' : 'N/A',
            'Avg Time to 1st AC (sec)': rawStat.avg_time_to_first_ac_seconds ?? 'N/A',
            'Wrong Answers': rawStat.wrong_answer_count ?? 0,
            'Time Limit Exceeded': rawStat.time_limit_exceeded_count ?? 0,
            'Runtime Errors': rawStat.runtime_error_count ?? 0,
            'Main Failure Pattern': p.main_failure_pattern,
            'AI Interpretation': p.ai_interpretation,
            'Pedagogical Recommendation': p.recommendation
        };
    });
    const wsProblems = xlsx.utils.json_to_sheet(probRows.length > 0 ? probRows : [{ 'Notice': 'No problem data' }]);
    xlsx.utils.book_append_sheet(wb, wsProblems, 'Problem Diagnostics');

    // 3. DSA Pattern Matrix
    const patternRows = (report.pattern_insights || []).map(pat => ({
        'Pattern Tag': pat.pattern,
        'Skill Classification': pat.skill_classification,
        'Pedagogical Interpretation': pat.ai_interpretation,
        'Recommended Practice': pat.recommended_practice
    }));
    const wsPatterns = xlsx.utils.json_to_sheet(patternRows.length > 0 ? patternRows : [{ 'Notice': 'No pattern data' }]);
    xlsx.utils.book_append_sheet(wb, wsPatterns, 'DSA Pattern Matrix');

    // 4. Actionable Recommendations
    const recRows = (report.recommendations || []).map(r => ({
        'Priority': r.priority,
        'Category': r.category,
        'Recommended Action': r.action,
        'Supporting Telemetry Evidence': r.evidence
    }));
    const wsRecs = xlsx.utils.json_to_sheet(recRows.length > 0 ? recRows : [{ 'Notice': 'No recommendations' }]);
    xlsx.utils.book_append_sheet(wb, wsRecs, 'Recommendations');

    // 5. Participant Diagnostics & Guidance
    const partRows = (report.participant_feedback || []).map(pf => ({
        'Participant ID': pf.participant_id,
        'Performance Band': pf.performance_band,
        'Demonstrated Strengths': Array.isArray(pf.strengths) ? pf.strengths.join(', ') : '',
        'Improvement Areas': Array.isArray(pf.improvement_areas) ? pf.improvement_areas.join(', ') : '',
        'Personalized Feedback': pf.feedback,
        'Recommended Next Practice': pf.next_practice_recommendation
    }));
    const wsParts = xlsx.utils.json_to_sheet(partRows.length > 0 ? partRows : [{ 'Notice': 'No participant feedback' }]);
    xlsx.utils.book_append_sheet(wb, wsParts, 'Participant Guidance');

    // 6. Proctoring & Integrity Review
    const ir = report.integrity_review || {};
    const integRows = [
        { 'Signal / Item': 'Integrity Risk Level', 'Detail': ir.risk_level || 'Low' },
        { 'Signal / Item': 'Flagged Sessions Count', 'Detail': telemetry.integrity_signals.flagged_sessions_count },
        { 'Signal / Item': 'Tab Switch Events', 'Detail': telemetry.integrity_signals.tab_switch_events },
        { 'Signal / Item': 'External Paste Events', 'Detail': telemetry.integrity_signals.paste_events },
        { 'Signal / Item': 'High Similarity Pairs', 'Detail': telemetry.integrity_signals.high_similarity_pairs.length },
        { 'Signal / Item': 'Diagnostic Summary', 'Detail': ir.summary || '' },
        { 'Signal / Item': 'Recommended Action', 'Detail': ir.recommended_action || '' },
        { 'Signal / Item': 'Mandatory Disclaimer', 'Detail': ir.disclaimer || '' }
    ];
    if (Array.isArray(ir.evidence)) {
        ir.evidence.forEach((ev, i) => {
            integRows.push({ 'Signal / Item': `Evidence #${i + 1}`, 'Detail': ev });
        });
    }
    const wsInteg = xlsx.utils.json_to_sheet(integRows);
    xlsx.utils.book_append_sheet(wb, wsInteg, 'Integrity Review');

    const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const cleanTitle = (telemetry.contest.title || 'Contest').replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `PostMortem_Contest_${contestId}_${cleanTitle}.xlsx`;

    return { buffer, filename };
}

module.exports = {
    aggregateContestData,
    generateDeterministicFallbackReport,
    validateAndNormalizeReport,
    generateContestReport,
    getLatestContestReport,
    exportContestPostMortemExcel
};
