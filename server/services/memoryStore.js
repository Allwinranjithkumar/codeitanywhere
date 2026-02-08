// In-memory storage for NO-DB Mode
// This allows the leaderboard and violations to work during a session even if the DB is down.
// Data is lost on server restart.

const users = new Map();
const submissions = [];
const violations = [];

module.exports = {
    // Users
    saveUser: (user) => {
        users.set(user.id, user);
        return user;
    },
    getUser: (id) => users.get(id),
    getAllUsers: () => Array.from(users.values()),

    // Submissions
    saveSubmission: (submission) => {
        submissions.push(submission);
        return submission;
    },
    getSubmissions: () => submissions,
    getUserSubmissions: (userId) => submissions.filter(s => s.user_id === userId),

    // Violations
    saveViolation: (violation) => {
        violations.push(violation);
        return violation;
    },
    getViolations: () => violations,
    getUserViolations: (userId) => violations.filter(v => v.user_id === userId)
};
