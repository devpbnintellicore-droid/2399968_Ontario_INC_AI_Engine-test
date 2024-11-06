const formatPublicId = (prefix, id, createdAt = new Date()) => {
  const year = new Date(createdAt).getFullYear();
  return `${prefix}-${year}-${String(id).padStart(4, "0")}`;
};

const formatBatchId = (id, createdAt = new Date()) => formatPublicId("BT", id, createdAt);

const WORKFLOW_ORDER = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED", "COMPLETED"];

const assertWorkflowTransition = (fromStatus, toStatus) => {
  const from = fromStatus || "DRAFT";
  const to = toStatus || "DRAFT";
  const allowed = {
    DRAFT: ["SUBMITTED"],
    SUBMITTED: ["UNDER_REVIEW", "REJECTED"],
    UNDER_REVIEW: ["APPROVED", "REJECTED"],
    APPROVED: ["COMPLETED"],
    REJECTED: [],
    COMPLETED: [],
  };

  if (from === to) return true;
  if (!WORKFLOW_ORDER.includes(from) || !WORKFLOW_ORDER.includes(to) || !allowed[from]?.includes(to)) {
    const error = new Error(`Invalid workflow transition from ${from} to ${to}`);
    error.statusCode = 400;
    throw error;
  }
  return true;
};

const AI_STATUS_LABELS = {
  PENDING: "Pending Analysis",
  PENDING_ANALYSIS: "Pending Analysis",
  RUNNING: "Analysis Running",
  ANALYSIS_RUNNING: "Analysis Running",
  COMPLETED: "Analysis Completed",
  ANALYSIS_COMPLETED: "Analysis Completed",
  FAILED: "Analysis Failed",
  ANALYSIS_FAILED: "Analysis Failed",
  NOT_AVAILABLE: "Not Available",
};

const getAiScoreState = ({ score, aiStatus, error } = {}) => {
  if (error) return { state: "Analysis Failed", value: null };
  const normalized = String(aiStatus || "").trim().toUpperCase();
  if (AI_STATUS_LABELS[normalized]) {
    return {
      state: AI_STATUS_LABELS[normalized],
      value: normalized === "COMPLETED" || normalized === "ANALYSIS_COMPLETED" ? score : null,
    };
  }
  
  // Fallback for old data without aiStatus
  if (score === null || score === undefined) {
    return { state: "Pending Analysis", value: null };
  }
  return { state: "Analysis Completed", value: score };
};

const ensureAiEvidence = (result = {}, context = {}) => {
  const recipeName = context.recipeName || "this experiment";
  const summary = String(result.summary || "").trim();
  const isFailed = summary.toLowerCase().startsWith("failed") || summary.toLowerCase().startsWith("no reviewer");
  const keyTakeaways = Array.isArray(result.keyTakeaways)
    ? result.keyTakeaways.filter((item) => String(item || "").trim())
    : [];
  const improvementAreas = Array.isArray(result.improvementAreas)
    ? result.improvementAreas.filter((item) => String(item || "").trim())
    : [];

  return {
    ...result,
    summary: summary || `AI evidence generated from reviewer sensory scores and compliance answers for ${recipeName}.`,
    sentiment: result.sentiment || "NEUTRAL",
    keyTakeaways: keyTakeaways.length
      ? keyTakeaways
      : [isFailed
          ? "Fallback takeaway: no specific AI takeaway was returned; reviewer evidence remains the primary audit source."
          : "Evidence takeaway: reviewer sensory scores and compliance answers were retained for audit review."],
    improvementAreas: improvementAreas.length
      ? improvementAreas
      : [isFailed
          ? "Fallback recommendation: no specific improvement area was returned; continue manual reviewer assessment."
          : "No immediate corrective action required; continue routine quality monitoring."],
    recommendationStatus: result.recommendationStatus || (improvementAreas.length ? "Required" : "Not Required"),
  };
};

const evaluateTextureAcceptance = (expected, actual, threshold = 0) => {
  const normalize = (value) => String(value || "").trim().toLowerCase();
  const expectedText = normalize(expected);
  const actualText = normalize(actual);
  if (!expectedText || !actualText) {
    return { result: "Not Available", threshold };
  }
  const matched =
    expectedText === actualText ||
    actualText.includes(expectedText) ||
    expectedText.includes(actualText);
  return { result: matched ? "PASS" : "FAIL", threshold };
};

const buildYieldDeviationEvidence = (predictedYield, actualYield) => {
  const predicted =
    predictedYield === null || predictedYield === undefined || predictedYield === ""
      ? null
      : Number(predictedYield);
  const actual =
    actualYield === null || actualYield === undefined || actualYield === ""
      ? null
      : Number(actualYield);
  const formula = "((Actual Yield - Predicted Yield) / Predicted Yield) * 100";
  const hasValidInputs =
    Number.isFinite(predicted) &&
    Number.isFinite(actual) &&
    predicted !== 0;

  return {
    predictedYield: Number.isFinite(predicted) ? predicted : null,
    actualYield: Number.isFinite(actual) ? actual : null,
    formula,
    resultPercent: hasValidInputs
      ? Number((((actual - predicted) / predicted) * 100).toFixed(2))
      : null,
    calculationSource: "CookingExperiment.expectedOutput and CookingExperiment.actualOutput",
  };
};

const normalizeVersion = (version) => String(version || "").replace(/^v/i, "");

const formatVersionLabel = (version) => `v${normalizeVersion(version) || "1.0"}`;

const getNextRecipeVersion = (lastVersion, isBump = false) => {
  if (!lastVersion) return "1.0";
  const clean = normalizeVersion(lastVersion);
  let [major, minor] = clean.split(".").map(Number);
  if (Number.isNaN(major)) major = 1;
  if (Number.isNaN(minor)) minor = 0;
  return isBump ? `${major + 1}.0` : `${major}.${minor + 1}`;
};

const buildRecipeSnapshot = (experiment) => ({
  recipeName: experiment.recipeName,
  recipeVersion: experiment.recipeVersion,
  temperature: experiment.temperature,
  duration: experiment.duration,
  expectedTexture: experiment.expectedTexture,
  achievedTexture: experiment.achievedTexture,
  expectedOutput: experiment.expectedOutput,
  actualOutput: experiment.actualOutput,
  remarks: experiment.remarks,
  ingredients: (experiment.ingredients || []).map((ing) => ({
    name: ing.name,
    quantity: ing.quantity,
    unit: ing.unit,
  })),
});

const FIELD_LABELS = {
  recipeName: "Recipe name",
  recipeVersion: "Version",
  temperature: "Temperature",
  duration: "Cooking duration",
  expectedTexture: "Expected texture",
  achievedTexture: "Achieved texture",
  expectedOutput: "Expected output",
  actualOutput: "Actual output",
  remarks: "Chef remarks",
  ingredients: "Ingredients",
};

const formatFieldValue = (field, value) => {
  if (value === null || value === undefined || value === "") return "blank";
  if (field === "temperature") return `${value}°C`;
  if (field === "duration") return `${value} mins`;
  if (field === "expectedOutput" || field === "actualOutput") return `${value} g`;
  if (field === "ingredients") {
    if (!Array.isArray(value) || value.length === 0) return "no ingredients";
    return `${value.length} ingredient${value.length === 1 ? "" : "s"}`;
  }
  return String(value);
};

const diffRecipeSnapshots = (oldSnapshot, newSnapshot) => {
  if (!oldSnapshot) return ["Initial recipe created"];
  const changed = [];
  Object.keys(newSnapshot).forEach((key) => {
    if (JSON.stringify(oldSnapshot[key]) !== JSON.stringify(newSnapshot[key])) {
      const label = FIELD_LABELS[key] || key;
      changed.push(
        `${label} changed from ${formatFieldValue(key, oldSnapshot[key])} to ${formatFieldValue(key, newSnapshot[key])}`,
      );
    }
  });
  return changed.length ? changed : ["Recipe version logged"];
};

const buildMonthlyExperimentChart = (experiments, now = new Date()) => {
  const months = [];
  const monthMap = new Map();
  const start = new Date(now);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  start.setMonth(start.getMonth() - 5);

  for (let i = 0; i < 6; i += 1) {
    const d = new Date(start);
    d.setMonth(start.getMonth() + i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const month = d.toLocaleString("en-US", { month: "short" });
    const monthLabel = d.toLocaleString("en-US", { month: "long", year: "numeric" });
    const row = {
      key,
      month,
      monthLabel,
      total: 0,
      completed: 0,
      pendingReview: 0,
      source: "Experiment.createdAt",
      formula: "count experiments grouped by created month",
    };
    months.push(row);
    monthMap.set(key, row);
  }

  experiments.forEach((exp) => {
    const createdAt = new Date(exp.createdAt);
    const key = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, "0")}`;
    const row = monthMap.get(key);
    if (!row) return;
    row.total += 1;
    if ((exp.sensoryEvaluations || []).length > 0 || (exp.reviewAnswers || []).length > 0) {
      row.completed += 1;
    } else {
      row.pendingReview += 1;
    }
  });

  return months;
};

const buildYearlyMonthlyExperimentChart = (experiments, year) => {
  const chartYear = Number(year) || new Date().getFullYear();
  const months = [];
  const monthMap = new Map();

  for (let i = 0; i < 12; i += 1) {
    const d = new Date(chartYear, i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const row = {
      key,
      month: d.toLocaleString("en-US", { month: "short" }),
      monthLabel: d.toLocaleString("en-US", { month: "long", year: "numeric" }),
      year: chartYear,
      total: 0,
      completed: 0,
      pendingReview: 0,
      source: "Experiment.createdAt",
      formula: "count experiments grouped by created month",
    };
    months.push(row);
    monthMap.set(key, row);
  }

  experiments.forEach((exp) => {
    const createdAt = new Date(exp.createdAt);
    const key = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, "0")}`;
    const row = monthMap.get(key);
    if (!row) return;
    row.total += 1;
    if ((exp.sensoryEvaluations || []).length > 0 || (exp.reviewAnswers || []).length > 0) {
      row.completed += 1;
    } else {
      row.pendingReview += 1;
    }
  });

  return months;
};

module.exports = {
  assertWorkflowTransition,
  buildMonthlyExperimentChart,
  buildYearlyMonthlyExperimentChart,
  buildRecipeSnapshot,
  diffRecipeSnapshots,
  formatBatchId,
  formatPublicId,
  formatVersionLabel,
  ensureAiEvidence,
  evaluateTextureAcceptance,
  buildYieldDeviationEvidence,
  getAiScoreState,
  getNextRecipeVersion,
};
