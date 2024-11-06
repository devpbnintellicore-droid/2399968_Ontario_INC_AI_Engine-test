const { prisma } = require("../config/db");
const aiService = require("../services/aiService");
const recipeDataService = require("../services/recipeDataService");
const { generatePortfolioProfessionalReport } = require("../utils/portfolioReportService");
const { analyzePortfolio } = require("../services/portfolioAnalysisService");
const crypto = require("crypto");

const createDataSignature = (data) => {
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
};

const analyzeExperimentAI = async (req, res) => {
    try {
        const { experimentId } = req.body;
        const id = Number(experimentId);
        const { createAuditLog } = require("../utils/auditLogger");

        // Start AI Analysis
        await prisma.cookingExperiment.update({
            where: { id },
            data: { aiStatus: "ANALYSIS_RUNNING", aiGeneratedAt: new Date() }
        });

        await createAuditLog(prisma, {
            action: "AI_ANALYSIS_STARTED",
            entity: "Experiment",
            entityId: id,
            description: `AI analysis started for experiment ${id}`,
            userId: req.user?.id || null,
            oldValue: { aiStatus: "PENDING_ANALYSIS" },
            newValue: { aiStatus: "ANALYSIS_RUNNING" },
            ipAddress: req.ip
        });

        // Fetch sensory evaluations (primary reviewer feedback)
        const sensoryEvals = await prisma.sensoryEvaluation.findMany({
            where: { cookingExperimentId: id },
            include: { reviewer: { select: { name: true } } }
        });

        // Fetch review answers (compliance Q&A)
        const answers = await prisma.reviewAnswer.findMany({
            where: { experimentId: id },
            include: { question: true }
        });

        // Map sensory scores for AI
        const sensoryData = sensoryEvals.map(s => ({
            reviewer: s.reviewer?.name || "Reviewer",
            tasteConsistency: s.tasteConsistency,
            aromaticVolatility: s.aromaticVolatility,
            sodiumProjection: s.sodiumProjection,
            chromaticAppeal: s.chromaticAppeal,
            structuralIntegrity: s.structuralIntegrity,
            scovillePerception: s.scovillePerception,
            lipidSaturation: s.lipidSaturation,
            cellularFreshness: s.cellularFreshness,
            palatePersistence: s.palatePersistence,
            expertNote: s.finalExpertNote || null
        }));

        // Map compliance Q&A using correct field names
        const mappedAnswers = answers.map(a => ({
            questionText: a.question?.question || "General Feedback",
            answerValue: a.answerValue
        }));

        let aiResult = null;
        let isFailed = true;
        let finalErrorMsg = "";
        
        let aiAnalysis = await prisma.aIAnalysis.upsert({
            where: { experimentId: id },
            update: { status: "Running", retryCount: 0, failureReason: null, failureTime: null },
            create: { experimentId: id, status: "Running", retryCount: 0 }
        });

        // Clear previous failure and retry records so they don't accumulate
        await prisma.aIAnalysisFailure.deleteMany({ where: { aiAnalysisId: aiAnalysis.id } });
        await prisma.aIAnalysisRetry.deleteMany({ where: { aiAnalysisId: aiAnalysis.id } });

        // Retry loop
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                aiResult = await aiService.analyzeReviewAI(sensoryData, mappedAnswers);
                isFailed = aiResult.summary.includes("Failed to analyze");
                
                await prisma.aIAnalysisRetry.create({
                    data: {
                        aiAnalysisId: aiAnalysis.id,
                        retryNumber: attempt,
                        status: isFailed ? "Failed" : "Success",
                        retryResult: isFailed ? aiResult.summary : "Analysis successful"
                    }
                });

                if (!isFailed) {
                    break;
                }
            } catch (err) {
                isFailed = true;
                finalErrorMsg = err.message;
                await prisma.aIAnalysisRetry.create({
                    data: {
                        aiAnalysisId: aiAnalysis.id,
                        retryNumber: attempt,
                        status: "Failed",
                        retryResult: err.message
                    }
                });
            }

            if (isFailed && attempt < 3) {
                await prisma.aIAnalysis.update({
                    where: { id: aiAnalysis.id },
                    data: { retryCount: attempt, lastRetry: new Date() }
                });
                await new Promise(res => setTimeout(res, 1000)); // wait before retry
            }
        }

        // Final result handling
        if (isFailed) {
            const failureMessage = finalErrorMsg || (aiResult && aiResult.summary) || "Multiple retries failed";
            const userMessage = failureMessage.includes("Groq AI quota limit reached")
                || failureMessage.includes("Groq AI authentication failed")
                ? failureMessage.replace(/^Failed to analyze feedback\.\s*/, "")
                : "AI Analysis failed after retries. Fallback to manual review triggered.";

            await prisma.aIAnalysis.update({
                where: { id: aiAnalysis.id },
                data: {
                    status: "Manual Review Required",
                    failureReason: failureMessage,
                    failureTime: new Date(),
                    fallbackMethod: "Human Review",
                    fallbackDate: new Date()
                }
            });
            await prisma.aIAnalysisFailure.create({
                data: {
                    aiAnalysisId: aiAnalysis.id,
                    reason: failureMessage || "Exhausted all retries"
                }
            });

            await prisma.cookingExperiment.update({
                where: { id },
                data: { aiStatus: "ANALYSIS_FAILED" }
            });

            await createAuditLog(prisma, {
            action: "AI_ANALYSIS_FAILED",
            entity: "Experiment",
            entityId: id,
            description: `AI analysis failed after 3 retries. Fallback to manual review triggered.`,
            userId: req.user?.id || null,
            oldValue: { aiStatus: "ANALYSIS_RUNNING" },
            newValue: { aiStatus: "ANALYSIS_FAILED" },
            ipAddress: req.ip
            });

            return res.json({
                success: false,
                message: userMessage,
                data: { status: "Manual Review Required" }
            });
        }

        const aiResultStatus = aiResult.sentiment === "POSITIVE" ? "POSITIVE" : (aiResult.sentiment === "NEGATIVE" ? "NEGATIVE" : "NEUTRAL");

        await prisma.aIAnalysis.update({
            where: { id: aiAnalysis.id },
            data: {
                status: "Completed",
                modelVersion: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
                generatedBy: "Groq AI Engine",
                generatedAt: new Date(),
                dataSource: "Sensory & Compliance",
                keyTakeaways: aiResult.keyTakeaways,
                improvementAreas: aiResult.improvementAreas,
                recommendationStatus: aiResult.recommendationStatus,
                confidenceScore: 87
            }
        });

        await prisma.cookingExperiment.update({
            where: { id },
            data: {
                aiStatus: "ANALYSIS_COMPLETED",
                aiAnalysisId: `AI-${new Date().getFullYear()}-${String(id).padStart(4, "0")}`,
                aiModelVersion: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
                aiDataSource: "Sensory & Compliance",
                aiGeneratedBy: "Groq AI Engine",
                aiGeneratedAt: new Date(),
                aiConfidenceScore: 87,
                aiResult: aiResultStatus,
                aiReason: aiResult.summary,
                aiKeyTakeaways: aiResult.keyTakeaways,
                aiImprovementAreas: aiResult.improvementAreas,
                aiRecommendationStatus: aiResult.recommendationStatus
            }
        });

        await prisma.reviewConclusion.upsert({
            where: { experimentId: id },
            update: {
                source: "AI Generated",
                writtenBy: "Groq AI Engine",
                writtenAt: new Date(),
                updatedAt: new Date()
            },
            create: {
                experimentId: id,
                source: "AI Generated",
                writtenBy: "Groq AI Engine",
                writtenAt: new Date(),
                updatedAt: new Date()
            }
        });

        await createAuditLog(prisma, {
            action: "AI_ANALYSIS_COMPLETED",
            entity: "Experiment",
            entityId: id,
            description: `AI analysis completed successfully for experiment ${id}`,
            userId: req.user?.id || null,
            oldValue: { aiStatus: "ANALYSIS_RUNNING" },
            newValue: {
                aiStatus: "ANALYSIS_COMPLETED",
                aiResult: aiResultStatus,
                keyTakeaways: aiResult.keyTakeaways,
                improvementAreas: aiResult.improvementAreas
            },
            ipAddress: req.ip
        });

        res.json({
            success: true,
            message: "AI analysis done",
            data: aiResult
        });
    } catch (err) {
        console.error("Analyze Experiment AI Error:", err);
        const id = Number(req.body.experimentId);
        if (id) {
            await prisma.cookingExperiment.update({
                where: { id },
                data: { aiStatus: "ANALYSIS_FAILED" }
            }).catch(() => {});
            
            try {
                let aiAnalysis = await prisma.aIAnalysis.findUnique({ where: { experimentId: id } });
                if (aiAnalysis) {
                    await prisma.aIAnalysis.update({
                        where: { id: aiAnalysis.id },
                        data: {
                            status: "Manual Review Required",
                            failureReason: err.message,
                            failureTime: new Date()
                        }
                    });
                }
            } catch(e) {}

            const { createAuditLog } = require("../utils/auditLogger");
            await createAuditLog(prisma, {
                action: "AI_ANALYSIS_FAILED",
                entity: "Experiment",
                entityId: id,
                description: `AI analysis failed due to error: ${err.message}`,
                userId: req.user?.id || null,
                oldValue: { aiStatus: "ANALYSIS_RUNNING" },
                newValue: { aiStatus: "ANALYSIS_FAILED", error: err.message },
                ipAddress: req.ip
            }).catch(() => {});
        }
        res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

// Analyze complete recipe with all versions
const analyzeRecipeAI = async (req, res) => {
    try {
        const { recipeName } = req.body;

        if (!recipeName) {
            return res.status(400).json({
                success: false,
                message: "recipeName is required"
            });
        }

        // Get summarized data for the recipe (reduced tokens)
        const recipeData = await recipeDataService.getRecipeSummary(recipeName);

        if (!recipeData) {
            return res.status(404).json({
                success: false,
                message: `No experiments found for recipe: ${recipeName}`
            });
        }

        // Send data to AI for analysis
        const analysisResult = await aiService.analyzeFullRecipeAI(recipeData);

        if (!analysisResult.success) {
            return res.status(500).json({
                success: false,
                message: analysisResult.error || "AI analysis could not be completed at this time. Please try again later.",
                error: analysisResult.error,
            });
        }

        res.json({
            success: true,
            message: "Recipe analysis completed",
            data: {
                recipeName: recipeData.recipeName,
                totalExperiments: recipeData.totalExperiments,
                totalVersions: recipeData.totalVersions,
                analysis: analysisResult
            }
        });
    } catch (err) {
        console.error("Analyze Recipe AI Error:", err);
        res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

// Get all recipes
const getAllRecipes = async (req, res) => {
    try {
        const recipes = await recipeDataService.getAllRecipes();

        res.json({
            success: true,
            data: recipes
        });
    } catch (err) {
        res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

// Generate PDF report for a recipe
// Generate PDF report for a recipe
const generateRecipeReport = async (req, res) => {
  try {
    const rawRecipeName =
      req.method === "GET" ? req.params.recipeName : req.body.recipeName;

    const recipeName = rawRecipeName ? decodeURIComponent(rawRecipeName) : null;

    if (!recipeName) {
      return res.status(400).json({
        success: false,
        message: "Recipe name is required",
      });
    }

    // 1️⃣ GET AGGREGATED DATA FROM DB
    const summary = await recipeDataService.getRecipeSummary(recipeName);

    if (!summary) {
      return res.status(404).json({
        success: false,
        message: "Recipe not found",
      });
    }

    // 2️⃣ CREATE SIGNATURE FROM CURRENT RECIPE DATA
    // Same recipe + same versions + same scores/feedback = same signature
    const dataSignature = createDataSignature({
      summary,
      reportRendererVersion: "recipe-version-report-v2",
    });

    // 3️⃣ CHECK OLD REPORT CACHE
    const cachedReport = await prisma.recipeReportCache.findUnique({
      where: {
        recipeName_dataSignature: {
          recipeName,
          dataSignature,
        },
      },
    });

    if (cachedReport?.reportUrl) {
      return res.json({
        success: true,
        cached: true,
        message: "Cached report found",
        url: cachedReport.reportUrl,
      });
    }

    // 4️⃣ CALL AI ONLY IF DATA CHANGED / NEW VERSION ADDED
    const aiResult = await aiService.analyzeFullRecipeAI(summary);

    if (!aiResult.success) {
      return res.status(500).json({
        success: false,
        message: aiResult.error || "AI analysis could not be completed at this time. Please try again later.",
        error: aiResult.error,
      });
    }

    // 5️⃣ MERGE NUMERIC DATA + AI INSIGHTS
    const mergedData = {
      ...aiResult,
      recipeName: summary.recipeName,
      totalExperiments: summary.totalExperiments,
      totalVersions: summary.totalVersions,
      versions: summary.versions.map((v) => {
        const aiV = aiResult.versions?.find((a) => a.version === v.version) || {};
        return {
          ...v,
          ...aiV,
        };
      }),
    };

    // 6️⃣ GENERATE PDF
    const publicId = `${recipeName.replace(/\s+/g, "_")}_${Date.now()}`;

    const {
      generatePortfolioProfessionalReport: generateRecipePdf,
    } = require("../utils/portfolioReportService");

    const url = await generateRecipePdf(mergedData, publicId);

    // 7️⃣ SAVE REPORT URL IN DB
    await prisma.recipeReportCache.create({
      data: {
        recipeName,
        dataSignature,
        reportUrl: url,
        publicId,
      },
    });

    // 8️⃣ SEND RESPONSE
    return res.json({
      success: true,
      cached: false,
      message: "Report generated successfully",
      url,
    });
 } catch (err) {
  console.error("REPORT ERROR:", err);

  if (err.code === "NOT_ENOUGH_VERSION_DATA") {
    return res.status(400).json({
      success: false,
      code: err.code,
      message: err.message,
    });
  }

  return res.status(err.statusCode || 500).json({
    success: false,
    message: err.message || "Report generation failed",
  });
};
};
// Compare versions
const compareVersionsAI = async (req, res) => {
    try {
        const { recipeName } = req.body;

        if (!recipeName) {
            return res.status(400).json({
                success: false,
                message: "recipeName is required"
            });
        }

        // Get recipe data (summarized)
        const recipeData = await recipeDataService.getRecipeSummary(recipeName);

        if (!recipeData) {
            return res.status(404).json({
                success: false,
                message: `No experiments found for recipe: ${recipeName}`
            });
        }

        // Compare versions
        const comparisonResult = await aiService.compareVersionsAI({
            recipeName,
            versions: recipeData.versions
        });

        res.json({
            success: true,
            message: "Version comparison completed",
            data: comparisonResult
        });
    } catch (err) {
        console.error("Compare Versions AI Error:", err);
        res.status(500).json({
            success: false,
            message: err.message
        });
    }
};

const portfolioAnalytics = async (req, res) => {
    try {
        // ⭐ 1️⃣ GET ALL RECIPES SUMMARY
        const recipes = await recipeDataService.getAllRecipeSummary();

        if (!recipes || !recipes.length) {
            return res.status(404).json({
                success: false,
                message: "No recipes found for portfolio analytics"
            });
        }

        // ⭐ 2️⃣ GLOBAL AI ANALYSIS
        const portfolio = await analyzePortfolio(recipes);

        // ⭐ 3️⃣ GENERATE PDF → upload to Cloudinary
        const publicId = `portfolio_report_${Date.now()}`;
        let url = await generatePortfolioProfessionalReport(portfolio, publicId);

        return res.json({
            success: true,
            message: "Portfolio analytics generated successfully",
            url,
            data: portfolio
        });

    } catch (error) {
        console.error("Portfolio Error:", error);
        return res.status(500).json({
            success: false,
            message: "Portfolio analytics failed"
        });
    }
};

module.exports = {
    analyzeExperimentAI,
    analyzeRecipeAI,
    getAllRecipes,
    generateRecipeReport,
    compareVersionsAI,
    portfolioAnalytics
};
