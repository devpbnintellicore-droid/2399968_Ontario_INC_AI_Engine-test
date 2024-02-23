const Groq = require("groq-sdk");

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

// ─────────────────────────────────────────────────────────────
//  HELPER — compute a composite score from sensory data
//  Used as fallback when overallScore is null/undefined
// ─────────────────────────────────────────────────────────────
const computeSensoryScore = (v) => {
    // 1. Use overallScore directly if it exists
    if (v.overallScore !== null && v.overallScore !== undefined) {
        return Number(v.overallScore);
    }

    // 2. Average the four sensory dimensions
    const s = v.avgSensoryScores || {};
    const fields = [
        s.tasteConsistency,
        s.structuralIntegrity,
        s.chromaticAppeal,
        s.aromaticVolatility,
    ].filter(f => f !== null && f !== undefined);

    if (fields.length > 0) {
        return fields.reduce((a, b) => a + Number(b), 0) / fields.length;
    }

    // 3. Fall back to star rating * 2 (converts 1–5 → 2–10 scale)
    if (v.avgStarRating !== null && v.avgStarRating !== undefined) {
        return Number(v.avgStarRating) * 2;
    }

    return 0; // no data at all
};

/**
 * FULL RECIPE AI ANALYSIS
 * ⭐ Deterministic ranking (with sensory fallback) + AI reasoning
 */
const analyzeFullRecipeAI = async (recipeData) => {

    // ⭐ Deterministic scientific ranking — never empty
    // Attach a computed score to every version so nothing gets filtered out
    const versionsWithScore = recipeData.versions.map(v => ({
        ...v,
        _computedScore: computeSensoryScore(v),
    }));

    const ranked = [...versionsWithScore].sort(
        (a, b) => b._computedScore - a._computedScore
    );

    const bestVersion = ranked[0]?.version || null;
    const worstVersion = ranked[ranked.length - 1]?.version || null;

    // ⭐ Compact AI payload — include computed score so AI has context
    const compactData = {
        recipeName: recipeData.recipeName,
        bestVersion,
        worstVersion,
        versions: versionsWithScore.map(v => ({
            version: v.version,
            score: v._computedScore,          // always a number now
            overallScore: v.overallScore,             // raw original (may be null)
            sensory: v.avgSensoryScores,
            avgStars: v.avgStarRating,
            reviewCount: v.reviewCount,
            feedbackSample: (v.sampleFeedback || []).slice(0, 15),
        })),
    };

    const completion = await groq.chat.completions.create({
        model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
        temperature: 0,
        response_format: { type: "json_object" },
        max_completion_tokens: 2500,
        reasoning_effort: "low",
        reasoning_format: "hidden",
        messages: [
            {
                role: "system",
                content: `
You are a senior food R&D analytics AI.

IMPORTANT:
- Best version is already decided as ${bestVersion}
- Worst version is already decided as ${worstVersion}
- You MUST NOT change version ranking.
- You only explain reasoning and strategic insights.

Return ONLY valid JSON.
`,
            },
            {
                role: "user",
                content: `
Analyze recipe performance data.

${JSON.stringify(compactData)}

Return JSON:

{
  "versions":[
    {
      "version":"v1.1",
      "strengths":["balanced flavor"],
      "weaknesses":["slightly oily"],
      "recommendations":["reduce oil by 5%"],
      "textureCategory":"Creamy",
      "marketReadiness":"READY"
    }
  ],
  "bestVersionReason":"string",
  "worstVersionReason":"string",
  "overallInsights":{
    "tasteTrend":"improving",
    "keyImprovementAreas":["salt balance"]
  },
  "finalRecommendation":"string",
  "nextSteps":["string"]
}
`,
            },
        ],
    });

    const content = completion.choices?.[0]?.message?.content;

    try {
        const parsed = JSON.parse(content);

        // Merge computed scores back into parsed versions so PDF has scores
        const versionsOut = (parsed.versions || []).map(pv => {
            const original = versionsWithScore.find(v => v.version === pv.version);
            return {
                ...pv,
                overallScore: original?._computedScore ?? null,
                avgSensoryScores: original?.avgSensoryScores || {},
                experimentCount: original?.experimentCount || 0,
            };
        });

        return {
            success: true,
            recipeName: recipeData.recipeName,

            versions: versionsOut,

            // ⭐ deterministic ranking — always populated
            bestVersion,
            worstVersion,

            bestVersionReason: parsed.bestVersionReason || "",
            worstVersionReason: parsed.worstVersionReason || "",

            overallInsights: parsed.overallInsights || {},
            finalRecommendation: parsed.finalRecommendation || "",
            nextSteps: parsed.nextSteps || [],
        };

    } catch (err) {
        console.log("AI parse error:", content);
        return {
            success: false,
            error: "AI response parse failed",
            raw: content,
        };
    }
};


/**
 * VERSION COMPARISON AI (ranking explanation only)
 */
const compareVersionsAI = async (recipeData) => {

    const versionsWithScore = recipeData.versions.map(v => ({
        ...v,
        _computedScore: computeSensoryScore(v),
    }));

    const ranked = [...versionsWithScore].sort(
        (a, b) => b._computedScore - a._computedScore
    );

    const compactVersions = ranked.map((v, i) => ({
        rank: i + 1,
        version: v.version,
        score: v._computedScore,
        sensory: v.avgSensoryScores,
        reviews: v.reviewCount,
    }));

    const completion = await groq.chat.completions.create({
        model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
        temperature: 0,
        response_format: { type: "json_object" },
        max_completion_tokens: 2000,
        reasoning_effort: "low",
        reasoning_format: "hidden",
        messages: [
            {
                role: "system",
                content: `
You are food product benchmarking AI.
Ranking is already calculated.
Explain insights only.
Return ONLY JSON.
`,
            },
            {
                role: "user",
                content: `
Explain version ranking insights.

${JSON.stringify(compactVersions)}

Return JSON:

{
  "rankingInsights":[
    {"version":"v1.2","reason":"highest sensory consistency"},
    {"version":"v1.1","reason":"stable texture"},
    {"version":"v1.0","reason":"low aroma performance"}
  ],
  "finalVerdict":"string"
}
`,
            },
        ],
    });

    try {
        return JSON.parse(completion.choices[0].message.content);
    } catch (err) {
        console.log("AI comparison parse error");
        return { error: "AI comparison failed" };
    }
};

module.exports = {
    analyzeFullRecipeAI,
    compareVersionsAI,
};
