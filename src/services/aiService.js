const Groq = require("groq-sdk");
const { computeSensoryScore } = require("../utils/analyticsHelper");
const { ensureAiEvidence } = require("../utils/auditReadiness");

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const normalizeVersion = (version) => String(version || "").trim().replace(/^v+/i, "");

const sameVersion = (left, right) => normalizeVersion(left) === normalizeVersion(right);

const getAiProviderErrorMessage = (err) => {
  const status = err?.status || err?.statusCode || err?.response?.status;
  const rawMessage = [
    err?.message,
    err?.error?.message,
    err?.response?.data?.error?.message,
    err?.response?.data?.message,
    err?.code,
    err?.error?.code,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    status === 429 ||
    rawMessage.includes("rate_limit") ||
    rawMessage.includes("rate limit") ||
    rawMessage.includes("quota") ||
    rawMessage.includes("limit exceeded") ||
    rawMessage.includes("insufficient_quota")
  ) {
    return "Groq AI quota limit reached. Please renew or upgrade your Groq API plan, then try again.";
  }

  if (
    status === 401 ||
    status === 403 ||
    rawMessage.includes("invalid api key") ||
    rawMessage.includes("api key") ||
    rawMessage.includes("unauthorized")
  ) {
    return "Groq AI authentication failed. Please check the GROQ_API_KEY configuration.";
  }

  if (status === 400 || status === 404 || rawMessage.includes("model_not_found")) {
    const detail = String(
      err?.error?.error?.message ||
      err?.error?.message ||
      err?.message ||
      "Invalid Groq request",
    ).replace(/\s+/g, " ").trim();
    return `Groq AI request failed: ${detail}`;
  }

  return "AI analysis could not be completed at this time. Please try again later.";
};

/**
 * ANALYZE SINGLE EXPERIMENT FEEDBACK
 * ⭐ Analyzes sensory evaluations + compliance answers for a single experiment
 */
const analyzeReviewAI = async (sensoryData = [], complianceAnswers = []) => {
  const hasSensory = sensoryData && sensoryData.length > 0;
  const hasAnswers = complianceAnswers && complianceAnswers.length > 0;

  if (!hasSensory && !hasAnswers) {
    return ensureAiEvidence({
      summary: "No reviewer feedback available for this experiment yet.",
      sentiment: "NEUTRAL",
      keyTakeaways: [],
      improvementAreas: [],
      recommendationStatus: "Pending",
    });
  }

  // Build compact sensory summary
  const sensoryLines = hasSensory
    ? sensoryData.map(
        (s) =>
          `Reviewer: ${s.reviewer} | Taste:${s.tasteConsistency} Aroma:${s.aromaticVolatility} Sodium:${s.sodiumProjection} Color:${s.chromaticAppeal} Texture:${s.structuralIntegrity} Spice:${s.scovillePerception} Oil:${s.lipidSaturation} Freshness:${s.cellularFreshness} Aftertaste:${s.palatePersistence}${s.expertNote ? ` | Note: "${s.expertNote}"` : ""}`,
      )
    : [];

  const complianceLines = hasAnswers
    ? complianceAnswers.map(
        (a) => `Q: ${a.questionText} → A: ${JSON.stringify(a.answerValue)}`,
      )
    : [];

  const fullContext = [
    ...(sensoryLines.length
      ? ["=== SENSORY SCORES (out of 10) ===", ...sensoryLines]
      : []),
    ...(complianceLines.length
      ? ["=== COMPLIANCE Q&A ===", ...complianceLines]
      : []),
  ].join("\n");

  try {
    const completion = await groq.chat.completions.create({
      model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
      temperature: 0.2,
      response_format: { type: "json_object" },
      reasoning_effort: "low",
      reasoning_format: "hidden",
      messages: [
        {
          role: "system",
          content:
            "You are a culinary quality control AI. Analyze reviewer sensory scores (scale 1-10) and compliance feedback. Return ONLY valid JSON.",
        },
        {
          role: "user",
          content: `Analyze this reviewer feedback for a cooking experiment:\n\n${fullContext}\n\nReturn JSON:\n{\n  "summary": "2-3 sentence summary of reviewer feedback",\n  "sentiment": "POSITIVE/NEGATIVE/NEUTRAL",\n  "keyTakeaways": ["point 1", "point 2", "point 3"],\n  "improvementAreas": ["area 1", "area 2"],\n  "recommendationStatus": "Required/Not Required/Pending"\n}`,
        },
      ],
    });

    return ensureAiEvidence(JSON.parse(completion.choices[0].message.content));
  } catch (err) {
    console.error("AI Review Analysis Error:", {
      status: err?.status,
      code: err?.code || err?.error?.error?.code,
      message: err?.message,
      providerMessage: err?.error?.error?.message,
    });
    const providerMessage = getAiProviderErrorMessage(err);
    return ensureAiEvidence({
      summary: `Failed to analyze feedback. ${providerMessage}`,
      sentiment: "NEUTRAL",
      keyTakeaways: [],
      improvementAreas: [],
      recommendationStatus: "Failed",
    });
  }
};

/**
 * FULL RECIPE AI ANALYSIS
 * ⭐ Deterministic ranking + AI reasoning across all versions
 */
const analyzeFullRecipeAI = async (recipeData) => {
  // ⭐ Deterministic scientific ranking
  const versionsWithScore = recipeData.versions.map((v) => ({
    ...v,
    _computedScore: computeSensoryScore(v),
  }));

  const ranked = [...versionsWithScore].sort(
    (a, b) => b._computedScore - a._computedScore,
  );

  const bestVersion = ranked[0]?.version || null;
  const worstVersion = ranked[ranked.length - 1]?.version || null;

  const compactData = {
    recipeName: recipeData.recipeName,
    bestVersion,
    worstVersion,
    versions: versionsWithScore.map((v) => ({
      version: v.version,
      score: v._computedScore,
      sensory: v.avgSensoryScores,
      avgStars: v.avgStarRating,
      reviewCount: v.reviewCount,
      feedbackSample: (v.sampleFeedback || []).slice(0, 15),
    })),
  };

  try {
    const completion = await groq.chat.completions.create({
      model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
      temperature: 0,
      response_format: { type: "json_object" },
      max_completion_tokens: 3500,
      reasoning_effort: "low",
      reasoning_format: "hidden",
      messages: [
        {
          role: "system",
          content: `You are a senior food R&D analytics AI. 
                    IMPORTANT: Best version is ${bestVersion}, Worst is ${worstVersion}. 
                    DO NOT change this ranking. Explain reasoning and strategic insights only. 
                    Return ONLY valid JSON.`,
        },
        {
          role: "user",
          content: `Analyze this recipe performance data: ${JSON.stringify(compactData)}
                    
                    Return ONLY this JSON structure:
                    {
                      "versions": [
                        {
                          "version": "string",
                          "strengths": ["string"],
                          "weaknesses": ["string"],
                          "recommendations": ["string"],
                          "textureCategory": "string",
                          "marketReadiness": "READY/NEEDS WORK/NOT READY",
                          "riskLevel": "LOW/MEDIUM/HIGH",
                          "confidenceScore": 0-100,
                          "shelfReadiness": "string",
                          "consumerSentiment": {
                            "positive": 0-100,
                            "neutral": 0-100,
                            "negative": 0-100,
                            "summary": "string",
                            "mostPositiveReview": "string",
                            "mostNegativeReview": "string"
                          }
                        }
                      ],
                      "versionComparison": [
                        {
                          "metric": "string",
                          "values": { "v1.1": 0.0 }
                        }
                      ],
                      "overallConfidenceScore": 0-100,
                      "bestVersionReason": "string",
                      "worstVersionReason": "string",
                     "overallInsights": {
  "tasteTrend": "string",
  "keyImprovementAreas": ["string"]
},
"finalRecommendation": "string",
"generalRecommendations": [
  {
    "version": "string",
    "recommendation": "short practical improvement recommendation, example: v1.1 needs more texture and better crispness"
  }
],
"nextSteps": ["string"]
                    }`,
        },
      ],
    });

    const parsed = JSON.parse(completion.choices[0].message.content);

    // Merge back metadata
    const aiVersions = parsed.versions || [];
    const versionsOut = versionsWithScore.map((original) => {
      const pv = aiVersions.find((v) => sameVersion(v.version, original.version)) || {};
      return {
        ...pv,
        version: original.version,
        overallScore: original._computedScore,
        avgSensoryScores: original.avgSensoryScores || {},
        experimentCount: original.experimentCount || 0,
        avgStarRating: original.avgStarRating || null,
        reviewCount: original.reviewCount || 0,
      };
    });

    const generalRecommendations = parsed.generalRecommendations || [];
    const nextSteps = parsed.nextSteps || [];
    return {
      success: true,
      recipeName: recipeData.recipeName,
      versions: versionsOut,
      bestVersion,
      worstVersion,
      bestVersionReason: parsed.bestVersionReason || "",
      worstVersionReason: parsed.worstVersionReason || "",
      overallInsights: parsed.overallInsights || {},
      finalRecommendation: parsed.finalRecommendation || "",
      generalRecommendations: generalRecommendations.length
        ? generalRecommendations
        : [{ version: bestVersion || "N/A", recommendation: "Fallback recommendation: continue controlled review before production release." }],
      nextSteps: nextSteps.length ? nextSteps : ["Fallback next step: review sensory evidence and repeat analysis when additional data is available."],
      recommendationStatus: generalRecommendations.length || nextSteps.length ? "Required" : "Not Required",
      overallConfidenceScore: parsed.overallConfidenceScore ?? null,
      versionComparison: parsed.versionComparison || [],
    };
  } catch (err) {
    console.error("AI Recipe Analysis Error:", {
      status: err?.status,
      code: err?.code || err?.error?.error?.code,
      message: err?.message,
      providerMessage: err?.error?.error?.message,
    });
    return { success: false, error: getAiProviderErrorMessage(err) };
  }
};

/**
 * VERSION COMPARISON AI
 * ⭐ Ranking explanation and verdict
 */
const compareVersionsAI = async (recipeData) => {
  const versionsWithScore = recipeData.versions.map((v) => ({
    ...v,
    _computedScore: computeSensoryScore(v),
  }));

  const ranked = [...versionsWithScore].sort(
    (a, b) => b._computedScore - a._computedScore,
  );

  const compactVersions = ranked.map((v, i) => ({
    rank: i + 1,
    version: v.version,
    score: v._computedScore,
    sensory: v.avgSensoryScores,
    reviews: v.reviewCount,
  }));

  try {
    const completion = await groq.chat.completions.create({
      model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
      temperature: 0,
      response_format: { type: "json_object" },
      reasoning_effort: "low",
      reasoning_format: "hidden",
      messages: [
        {
          role: "system",
          content:
            "You are food product benchmarking AI. Ranking is pre-calculated. Explain insights only. Return ONLY JSON.",
        },
        {
          role: "user",
          content: `Explain version ranking insights: ${JSON.stringify(compactVersions)}
                    Return JSON:
                    {
                      "rankingInsights": [{"version": "string", "reason": "string"}],
                      "finalVerdict": "string"
                    }`,
        },
      ],
    });

    return JSON.parse(completion.choices[0].message.content);
  } catch (err) {
    console.error("AI Comparison Error:", err);
    return { error: "AI comparison failed" };
  }
};

module.exports = {
  analyzeReviewAI,
  analyzeFullRecipeAI,
  compareVersionsAI,
  getAiProviderErrorMessage,
};
