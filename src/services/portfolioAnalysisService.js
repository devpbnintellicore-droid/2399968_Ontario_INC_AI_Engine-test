const Groq = require("groq-sdk");
const { computeSensoryScore } = require("../utils/analyticsHelper");

const groq = new Groq({
    apiKey: process.env.GROQ_API_KEY
});

const analyzePortfolio = async (recipes) => {

    const recipesWithScore = recipes.map(r => {

        const versions = r.versions.map(v => ({
            ...v,
            _score: computeSensoryScore(v)
        }));

        const rankedVersions = [...versions]
            .sort((a, b) => b._score - a._score);

        const recipeScore =
            versions.length
                ? versions.reduce((a, b) => a + b._score, 0) / versions.length
                : 0;

        return {
            recipeName: r.recipeName,
            recipeScore,
            bestVersion: rankedVersions[0]?.version || null,
            worstVersion: rankedVersions[rankedVersions.length - 1]?.version || null
        };
    });

    const rankedRecipes = [...recipesWithScore]
        .sort((a, b) => b.recipeScore - a.recipeScore);

    const bestRecipe = rankedRecipes[0]?.recipeName || null;
    const worstRecipe = rankedRecipes[rankedRecipes.length - 1]?.recipeName || null;

    // ⭐ AI reasoning
    let aiInsights = {};

    try {

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
                    content: `You are a cloud-kitchen performance analytics AI.

You will receive a list of ranked recipes with their scores.
Generate strategic suggestions ONLY for the recipes in the list — do NOT invent or add any recipes that are not provided.

The total number of strategicSuggestions must exactly match the number of recipes given.

Return JSON in this exact format:
{
  "strategicSuggestions": [
    {
      "recipeName": "<exact recipe name from input>",
      "version": "<best version from input>",
      "score": <number>,
      "strength": "<one key strength>",
      "concern": "<one key concern>",
      "action": "<one actionable improvement>"
    }
  ],
  "portfolioInsights": {
    "marketTrend": "...",
    "growthOpportunity": "..."
  }
}`
                },
                {
                    role: "user",
                    content: `Here are the ${rankedRecipes.length} ranked recipe(s). Generate exactly ${rankedRecipes.length} strategic suggestion(s), one per recipe: ${JSON.stringify(rankedRecipes)}`
                }
            ]
        });

        const parsed = JSON.parse(completion.choices[0].message.content);
        aiInsights = parsed.portfolioInsights || {};
        var strategicSuggestions = parsed.strategicSuggestions || [];

    } catch (e) {
        console.log("Portfolio AI failed");
    }

    return {
        rankedRecipes,
        bestRecipe,
        worstRecipe,
        aiInsights,
        strategicSuggestions: strategicSuggestions || []
    };
};

module.exports = {
    analyzePortfolio
};
