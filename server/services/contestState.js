
// In-memory contest state
let isContestActive = true;
let isAntiCheatActive = true;

module.exports = {
    isContestActive: () => isContestActive,
    setContestActive: (status) => {
        isContestActive = status;
        console.log(`📢 Contest status changed to: ${isContestActive ? 'ACTIVE' : 'ENDED'}`);
        return isContestActive;
    },
    isAntiCheatActive: () => isAntiCheatActive,
    setAntiCheatActive: (status) => {
        isAntiCheatActive = status;
        console.log(`🛡️ Anti-Cheat status changed to: ${isAntiCheatActive ? 'ENABLED' : 'DISABLED'}`);
        return isAntiCheatActive;
    }
};
