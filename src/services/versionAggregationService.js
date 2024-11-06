const { prisma } = require("../config/db.js");

const getVersionPerformance = async () => {

    const answers = await prisma.reviewAnswer.findMany({
        where: { starValue: { not: null } }
    });

    const experiments = await prisma.cookingExperiment.findMany({
        select: { id: true, recipeName: true, recipeVersion: true }
    });

    const expMap = {};
    experiments.forEach(e => {
        expMap[e.id] = e;
    });

    const scoreMap = {};

    for (const a of answers) {

        const exp = expMap[a.experimentId];
        if (!exp) continue;

        const key = `${exp.recipeName}__${exp.recipeVersion}`;

        if (!scoreMap[key]) scoreMap[key] = { total: 0, count: 0 };

        scoreMap[key].total += a.starValue;
        scoreMap[key].count++;
    }

    const result = [];

    for (const key in scoreMap) {

        const avg = scoreMap[key].total / scoreMap[key].count;

        result.push({
            versionKey: key,
            avgScore: Number(avg.toFixed(2))
        });
    }

    return result;
};

module.exports = { getVersionPerformance };