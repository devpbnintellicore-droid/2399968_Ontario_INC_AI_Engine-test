const { prisma } = require("../config/db.js");

/**
 * Get complete data for a recipe including all versions
 */
const getRecipeFullData = async (recipeName) => {
    const experiments = await prisma.cookingExperiment.findMany({
        where: { 
            recipeName,
            sensoryEvaluations: { some: {} }
        },
        orderBy: [
            { recipeVersion: "asc" },
            { createdAt: "asc" }
        ],
        include: {
            ingredients: true,
            images: true,
            reviewAnswers: {
                orderBy: { id: "asc" },
                include: { question: true }
            },
            sensoryEvaluations: {
                orderBy: { id: "asc" }
            }
        }
    });

    if (!experiments.length) return null;

    const versionMap = {};

    for (const exp of experiments) {
        const version = exp.recipeVersion;

        if (!versionMap[version]) {
            versionMap[version] = {
                version,
                experiments: [],
                reviews: [],
                sensory: [],
                ingredients: []
            };
        }

        versionMap[version].experiments.push(exp);
        versionMap[version].reviews.push(...exp.reviewAnswers);
        versionMap[version].sensory.push(...exp.sensoryEvaluations);
        versionMap[version].ingredients.push(...exp.ingredients);
    }

    const versions = Object.values(versionMap).map(v => {
        const avgSensory = calculateAvgSensory(v.sensory);
        const avgReviews = calculateAvgReviews(v.reviews);

        return {
            version: v.version,
            experimentCount: v.experiments.length,
            avgSensoryScores: avgSensory,
            avgReviewScores: avgReviews,
            overallScore: calculateOverallScore(avgSensory, avgReviews)
        };
    });

    return {
        recipeName,
        totalExperiments: experiments.length,
        totalVersions: versions.length,
        versions
    };
};

/**
 * Get concise AI summary (STABLE VERSION)
 */
const getRecipeSummary = async (recipeName) => {
    const experiments = await prisma.cookingExperiment.findMany({
        where: { 
            recipeName,
            sensoryEvaluations: { some: {} }
        },
        orderBy: [
            { recipeVersion: "asc" },
            { createdAt: "asc" }
        ],
        include: {
            ingredients: true,
            reviewAnswers: {
                orderBy: { id: "asc" }
            },
            sensoryEvaluations: {
                orderBy: { id: "asc" }
            }
        }
    });

    if (!experiments.length) return null;

    const versionMap = {};

    for (const exp of experiments) {
        const version = exp.recipeVersion;

        if (!versionMap[version]) {
            versionMap[version] = {
                version,
                experimentCount: 0,
                ingredients: new Set(),
                sensoryScores: [],
                starRatings: [],
                textFeedback: []
            };
        }

        versionMap[version].experimentCount++;

        exp.ingredients.forEach(i =>
            versionMap[version].ingredients.add(`${i.quantity} ${i.unit} ${i.name}`)
        );

        exp.sensoryEvaluations.forEach(s =>
            versionMap[version].sensoryScores.push(s)
        );

        exp.reviewAnswers.forEach(r => {
            if (r.starValue !== null) versionMap[version].starRatings.push(r.starValue);
            if (r.answerText) versionMap[version].textFeedback.push(r.answerText);
        });
    }

    const versions = Object.values(versionMap).map(v => {
        const avgSensory = calculateAvgSensory(v.sensoryScores);

        const avgStarRating =
            v.starRatings.length > 0
                ? Number(
                    (
                        v.starRatings.reduce((a, b) => a + b, 0) /
                        v.starRatings.length
                    ).toFixed(2)
                )
                : null;

        return {
            version: v.version,
            experimentCount: v.experimentCount,
            ingredients: Array.from(v.ingredients).sort(),
            avgSensoryScores: avgSensory,
            avgStarRating,
            reviewCount: v.starRatings.length + v.textFeedback.length,
            sampleFeedback: v.textFeedback.sort()
        };
    });

    return {
        recipeName,
        totalExperiments: experiments.length,
        totalVersions: versions.length,
        versions
    };
};

/**
 * Stable sensory average
 */
const calculateAvgSensory = (list) => {
    if (!list.length) return null;

    const fields = [
        "tasteConsistency",
        "aromaticVolatility",
        "sodiumProjection",
        "chromaticAppeal",
        "structuralIntegrity",
        "scovillePerception",
        "lipidSaturation",
        "cellularFreshness",
        "palatePersistence"
    ];

    const avg = {};

    fields.forEach(f => {
        const values = list
            .map(s => s[f])
            .filter(v => v !== null)
            .sort((a, b) => a - b);

        avg[f] =
            values.length > 0
                ? Number(
                    (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2)
                )
                : null;
    });

    return avg;
};

/**
 * Stable review avg
 */
const calculateAvgReviews = (reviews) => {
    if (!reviews.length) return null;

    const stars = reviews
        .filter(r => r.starValue !== null)
        .map(r => r.starValue)
        .sort((a, b) => a - b);

    const avg =
        stars.length > 0
            ? Number((stars.reduce((a, b) => a + b, 0) / stars.length).toFixed(2))
            : null;

    return {
        totalReviews: reviews.length,
        avgStarRating: avg
    };
};

/**
 * Overall score
 */
const calculateOverallScore = (sensory, reviews) => {
    if (!sensory && !reviews) return null;

    let sensoryScore = null;
    if (sensory) {
        const vals = Object.values(sensory).filter(v => v !== null);
        sensoryScore =
            vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    }

    let reviewScore =
        reviews?.avgStarRating != null
            ? (reviews.avgStarRating / 5) * 10
            : null;

    const arr = [sensoryScore, reviewScore].filter(v => v !== null);
    if (!arr.length) return null;

    return Number((arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2));
};

// ⭐ GLOBAL RECIPE SUMMARY (for portfolio analytics)
// ⭐ GLOBAL RECIPE SUMMARY (CLEAN + STABLE)
const getAllRecipeSummary = async () => {

    // 1️⃣ get all unique recipe names
    const recipes = await prisma.cookingExperiment.findMany({
        distinct: ["recipeName"],
        select: { recipeName: true }
    });

    const result = [];

    // 2️⃣ reuse existing stable summary builder
    for (const r of recipes) {

        const summary = await getRecipeSummary(r.recipeName);

        if (summary && summary.versions?.length) {

            result.push({
                recipeName: summary.recipeName,
                versions: summary.versions
            });

        }
    }

    return result;
};

module.exports = {
    getRecipeFullData,
    getRecipeSummary,
    getAllRecipeSummary
};