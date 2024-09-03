/**
 * Compute a composite score from sensory data.
 * Used as fallback when overallScore is null/undefined.
 */
const computeSensoryScore = (v) => {
    // 1. Use overallScore directly if it exists
    if (v.overallScore !== null && v.overallScore !== undefined) {
        return Number(v.overallScore);
    }

    // 2. Average the sensory dimensions
    const s = v.avgSensoryScores || {};
    const fields = [
        s.tasteConsistency,
        s.structuralIntegrity,
        s.chromaticAppeal,
        s.aromaticVolatility,
        s.sodiumProjection,
        s.scovillePerception,
        s.lipidSaturation,
        s.cellularFreshness,
        s.palatePersistence
    ].filter(f => f !== null && f !== undefined);

    if (fields.length > 0) {
        return Number((fields.reduce((a, b) => a + Number(b), 0) / fields.length).toFixed(2));
    }

    // 3. Fall back to star rating * 2 (converts 1–5 → 2–10 scale)
    if (v.avgStarRating !== null && v.avgStarRating !== undefined) {
        return Number((v.avgStarRating * 2).toFixed(2));
    }

    return 0; // no data at all
};

module.exports = {
    computeSensoryScore
};
