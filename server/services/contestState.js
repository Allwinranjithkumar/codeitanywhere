
// In-memory contest state
let isContestActive = true;

module.exports = {
    isContestActive: () => isContestActive,
    setContestActive: (status) => {
        isContestActive = status;
        console.log(`📢 Contest status changed to: ${isContestActive ? 'ACTIVE' : 'ENDED'}`);
        return isContestActive;
    }
};
