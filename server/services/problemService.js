const fs = require('fs').promises;
const path = require('path');

let problems = [];

async function loadProblems() {
    try {
        const data = await fs.readFile(path.join(__dirname, '..', '..', 'problems', 'problems.json'), 'utf-8');
        problems = JSON.parse(data);
        console.log(`Loaded ${problems.length} problems`);
    } catch (error) {
        console.error('Error loading problems:', error);
    }
}

function getProblems() {
    return problems;
}

function getProblem(id) {
    return problems.find(p => p.id === id) || problems[id]; // Support finding by ID or index
}

module.exports = {
    loadProblems,
    getProblems,
    getProblem
};
