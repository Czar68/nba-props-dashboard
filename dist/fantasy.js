"use strict";
// src/fantasy.ts
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeFantasyScoreNBA = computeFantasyScoreNBA;
exports.computeFantasyScoreNFL = computeFantasyScoreNFL;
function computeFantasyScoreNBA(inputs) {
    const { points, rebounds, assists, steals, blocks, turnovers } = inputs;
    return (1 * points +
        1.2 * rebounds +
        1.5 * assists +
        3 * steals +
        3 * blocks -
        1 * turnovers);
}
function computeFantasyScoreNFL(inputs) {
    const { passingYards, passingTDs, interceptions, rushingYards, rushingTDs, receptions, receivingYards, receivingTDs, fumblesLost, } = inputs;
    return (0.04 * passingYards +
        4 * passingTDs -
        1 * interceptions +
        0.1 * rushingYards +
        6 * rushingTDs +
        1 * receptions +
        0.1 * receivingYards +
        6 * receivingTDs -
        2 * fumblesLost);
}
