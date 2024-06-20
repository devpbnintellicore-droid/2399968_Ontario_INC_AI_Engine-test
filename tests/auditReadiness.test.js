const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  assertWorkflowTransition,
  buildMonthlyExperimentChart,
  buildYearlyMonthlyExperimentChart,
  buildRecipeSnapshot,
  buildYieldDeviationEvidence,
  diffRecipeSnapshots,
  ensureAiEvidence,
  evaluateTextureAcceptance,
  formatBatchId,
  formatPublicId,
  getAiScoreState,
  getNextRecipeVersion,
} = require("../src/utils/auditReadiness.js");
const { createAuditLog } = require("../src/utils/auditLogger.js");

test("monthly experiment calculation groups by createdAt month with completed and pending counts", () => {
  const rows = buildMonthlyExperimentChart(
    [
      { createdAt: "2026-06-01T10:00:00.000Z", sensoryEvaluations: [{}], reviewAnswers: [] },
      { createdAt: "2026-06-10T10:00:00.000Z", sensoryEvaluations: [], reviewAnswers: [{}] },
      { createdAt: "2026-06-15T10:00:00.000Z", sensoryEvaluations: [], reviewAnswers: [] },
      { createdAt: "2026-05-15T10:00:00.000Z", sensoryEvaluations: [], reviewAnswers: [] },
    ],
    new Date("2026-06-22T00:00:00.000Z"),
  );

  const june = rows.find((row) => row.key === "2026-06");
  assert.equal(june.total, 3);
  assert.equal(june.completed, 2);
  assert.equal(june.pendingReview, 1);
  assert.equal(june.source, "Experiment.createdAt");
});

test("yearly monthly experiment calculation returns all months for selected year", () => {
  const rows = buildYearlyMonthlyExperimentChart(
    [
      { createdAt: "2025-01-10T10:00:00.000Z", sensoryEvaluations: [{}], reviewAnswers: [] },
      { createdAt: "2025-12-15T10:00:00.000Z", sensoryEvaluations: [], reviewAnswers: [] },
      { createdAt: "2026-01-10T10:00:00.000Z", sensoryEvaluations: [{}], reviewAnswers: [] },
    ],
    2025,
  );

  assert.equal(rows.length, 12);
  assert.equal(rows[0].key, "2025-01");
  assert.equal(rows[11].key, "2025-12");
  assert.equal(rows[0].completed, 1);
  assert.equal(rows[11].pendingReview, 1);
  assert.equal(rows.reduce((sum, row) => sum + row.total, 0), 2);
});

test("inactive user retention audit payload can capture old and new status", async () => {
  const calls = [];
  const db = {
    auditLog: {
      create: async (payload) => calls.push(payload),
    },
  };

  await createAuditLog(db, {
    action: "DEACTIVATED",
    entity: "Staff",
    entityId: 7,
    entityLabel: "Chef Test",
    description: "Staff member Chef Test deactivated and retained",
    userId: 1,
    oldValue: { status: "ACTIVE" },
    newValue: { status: "INACTIVE", deactivationReason: "Audit retention" },
    ipAddress: "127.0.0.1",
  });

  assert.equal(calls[0].data.action, "DEACTIVATED");
  assert.equal(calls[0].data.oldValue.status, "ACTIVE");
  assert.equal(calls[0].data.newValue.status, "INACTIVE");
  assert.equal(calls[0].data.ipAddress, "127.0.0.1");
});

test("recipe version history increments automatically and records changed fields", () => {
  assert.equal(getNextRecipeVersion(null), "1.0");
  assert.equal(getNextRecipeVersion("1.0"), "1.1");
  assert.equal(getNextRecipeVersion("v1.9", true), "2.0");

  const oldSnapshot = buildRecipeSnapshot({
    recipeName: "Audit Curry",
    recipeVersion: "1.0",
    temperature: 100,
    ingredients: [{ name: "Salt", quantity: 1, unit: "g" }],
  });
  const newSnapshot = buildRecipeSnapshot({
    recipeName: "Audit Curry",
    recipeVersion: "1.1",
    temperature: 109,
    ingredients: [{ name: "Salt", quantity: 2, unit: "g" }],
  });

  assert.deepEqual(diffRecipeSnapshots(oldSnapshot, newSnapshot), [
    "Version changed from 1.0 to 1.1",
    "Temperature changed from 100°C to 109°C",
    "Ingredients changed from 1 ingredient to 1 ingredient",
  ]);
});

test("auto-generated experiment IDs use EXP-year-sequence format", () => {
  assert.equal(formatPublicId("EXP", 1, "2026-06-10T00:00:00.000Z"), "EXP-2026-0001");
});

test("approval workflow allows only audited lifecycle transitions", () => {
  assert.equal(assertWorkflowTransition("DRAFT", "SUBMITTED"), true);
  assert.equal(assertWorkflowTransition("SUBMITTED", "UNDER_REVIEW"), true);
  assert.equal(assertWorkflowTransition("UNDER_REVIEW", "APPROVED"), true);
  assert.equal(assertWorkflowTransition("APPROVED", "COMPLETED"), true);
  assert.throws(() => assertWorkflowTransition("DRAFT", "APPROVED"), /Invalid workflow transition/);
});

test("batch numbering uses a distinct BT-year-sequence format", () => {
  assert.equal(formatBatchId(12, "2026-06-10T00:00:00.000Z"), "BT-2026-0012");
  assert.notEqual(
    formatBatchId(12, "2026-06-10T00:00:00.000Z"),
    formatPublicId("EXP", 12, "2026-06-10T00:00:00.000Z"),
  );
});

test("AI score states distinguish pending failed completed and not available", () => {
  assert.deepEqual(getAiScoreState({ score: null, aiStatus: "PENDING_ANALYSIS" }), {
    state: "Pending Analysis",
    value: null,
  });
  assert.deepEqual(getAiScoreState({ error: true }), {
    state: "Analysis Failed",
    value: null,
  });
  assert.deepEqual(getAiScoreState({ score: 88, aiStatus: "ANALYSIS_COMPLETED" }), {
    state: "Analysis Completed",
    value: 88,
  });
  assert.deepEqual(getAiScoreState({ score: null, aiStatus: "NOT_AVAILABLE" }), {
    state: "Not Available",
    value: null,
  });
});

test("AI evidence never returns blank takeaways or recommendations", () => {
  const evidence = ensureAiEvidence({
    summary: "",
    sentiment: "NEUTRAL",
    keyTakeaways: [],
    improvementAreas: [],
  }, { recipeName: "Audit Curry" });

  assert.ok(evidence.summary.includes("Audit Curry"));
  assert.ok(evidence.keyTakeaways.length > 0);
  assert.ok(evidence.improvementAreas.length > 0);
  assert.equal(evidence.recommendationStatus, "Not Required");
});

test("texture acceptance criteria returns PASS FAIL and Not Available", () => {
  assert.deepEqual(evaluateTextureAcceptance("Crunchy", "Very crunchy", 0), {
    result: "PASS",
    threshold: 0,
  });
  assert.deepEqual(evaluateTextureAcceptance("Crunchy", "Soft", 0), {
    result: "FAIL",
    threshold: 0,
  });
  assert.deepEqual(evaluateTextureAcceptance("", "Soft", 0), {
    result: "Not Available",
    threshold: 0,
  });
});

test("backend yield deviation evidence is reproducible from expected and actual output", () => {
  assert.deepEqual(buildYieldDeviationEvidence(100, 109), {
    predictedYield: 100,
    actualYield: 109,
    formula: "((Actual Yield - Predicted Yield) / Predicted Yield) * 100",
    resultPercent: 9,
    calculationSource: "CookingExperiment.expectedOutput and CookingExperiment.actualOutput",
  });

  assert.equal(buildYieldDeviationEvidence(0, 109).resultPercent, null);
});

test("lifecycle timestamp payload records submit review approve and completion", async () => {
  const calls = [];
  const db = {
    auditLog: {
      create: async (payload) => calls.push(payload),
    },
  };

  await createAuditLog(db, {
    action: "APPROVED",
    entity: "Experiment",
    entityId: 4,
    entityLabel: "EXP-2026-0004",
    description: "Experiment approved",
    userId: 2,
    oldValue: { status: "UNDER_REVIEW", reviewedAt: "2026-06-22T10:00:00.000Z" },
    newValue: { status: "APPROVED", approvedAt: "2026-06-22T10:05:00.000Z", approvedById: 2 },
    ipAddress: "127.0.0.1",
  });

  assert.equal(calls[0].data.action, "APPROVED");
  assert.equal(calls[0].data.newValue.status, "APPROVED");
  assert.equal(calls[0].data.newValue.approvedById, 2);
});

test("AI analytics UI exposes manual trigger, evidence, formula, texture and lifecycle timeline", () => {
  const aiPage = fs.readFileSync(
    path.join(__dirname, "../../2399968_Ontario_INC_Dashboard/src/pages/ai/AIPage.jsx"),
    "utf8",
  );

  assert.match(aiPage, /Run AI/);
  assert.match(aiPage, /AI Evidence Details/);
  assert.match(aiPage, /AI Lifecycle Timeline/);
  assert.match(aiPage, /Yield Variance Formula/);
  assert.match(aiPage, /Texture Result/);
});

test("recipe UI exposes chef note history and reviewer conclusion source", () => {
  const recipePage = fs.readFileSync(
    path.join(__dirname, "../../2399968_Ontario_INC_Dashboard/src/pages/recipes/AllRecipesPage.jsx"),
    "utf8",
  );

  assert.match(recipePage, /Chef Notes History/);
  assert.match(recipePage, /Reviewer Conclusion Source/);
});

test("role management UI exposes reviewer ownership and role history evidence", () => {
  const rolePage = fs.readFileSync(
    path.join(__dirname, "../../2399968_Ontario_INC_Dashboard/src/pages/roles/RoleManagementPage.jsx"),
    "utf8",
  );

  assert.match(rolePage, /Assigned by/);
  assert.match(rolePage, /Last change:/);
});

test("questionnaire archive and question history routes are manager-only", () => {
  const questionRoutes = fs.readFileSync(
    path.join(__dirname, "../src/routes/questionRoutes.js"),
    "utf8",
  );

  assert.match(questionRoutes, /questionnaires\/versions", verifyToken, allowRoles\("MANAGER"\)/);
  assert.match(questionRoutes, /questionnaires\/snapshot", verifyToken, allowRoles\("MANAGER"\)/);
  assert.match(questionRoutes, /:id\/history", verifyToken, allowRoles\("MANAGER"\)/);
});

test("audit, AI and staff management routes are role guarded", () => {
  const auditRoutes = fs.readFileSync(
    path.join(__dirname, "../src/routes/auditRoutes.js"),
    "utf8",
  );
  const aiRoutes = fs.readFileSync(
    path.join(__dirname, "../src/routes/aiRoutes.js"),
    "utf8",
  );
  const authRoutes = fs.readFileSync(
    path.join(__dirname, "../src/routes/authRoutes.js"),
    "utf8",
  );

  assert.match(auditRoutes, /router\.get\("\/", verifyToken, allowRoles\("MANAGER"\), getAuditLogs\)/);
  assert.match(aiRoutes, /router\.post\("\/analyze", verifyToken, allowRoles\("MANAGER", "REVIEWER"\)/);
  assert.match(aiRoutes, /router\.get\("\/portfolio-report", verifyToken, allowRoles\("MANAGER"\)/);
  assert.match(authRoutes, /router\.get\("\/staff", verifyToken, allowRoles\("MANAGER"\)/);
  assert.match(authRoutes, /router\.get\("\/stats", verifyToken, allowRoles\("MANAGER"\)/);
});

test("question audit logs and single-answer blank validation have complete evidence paths", () => {
  const questionService = fs.readFileSync(
    path.join(__dirname, "../src/services/questionService.js"),
    "utf8",
  );

  assert.match(questionService, /Mandatory review question cannot be blank/);
  assert.match(questionService, /questionStatus: blank && optional \? "Optional" : "Answered"/);
  assert.match(questionService, /oldValue: null/);
  assert.match(questionService, /newValue: \{ question, questionVersion, reason: "Question created" \}/);
  assert.match(questionService, /newValue: \{ \.\.\.newQv, reason: "Questionnaire snapshot created" \}/);
  assert.match(questionService, /ipAddress/);
});

test("AI page renders backend yield deviation evidence instead of calculating formula silently", () => {
  const aiPage = fs.readFileSync(
    path.join(__dirname, "../../2399968_Ontario_INC_Dashboard/src/pages/ai/AIPage.jsx"),
    "utf8",
  );

  assert.match(aiPage, /yieldDeviation: e\.yieldDeviation \|\| null/);
  assert.doesNotMatch(aiPage, /e\.expectedOutput && e\.actualOutput \? Math\.abs/);
  assert.match(aiPage, /data\.yieldDeviation\?\.calculationSource/);
});

test("AI audit migration adds evidence fields, note history and batch ID backfill", () => {
  const migration = fs.readFileSync(
    path.join(__dirname, "../prisma/migrations/20260622120000_ai_audit_completion/migration.sql"),
    "utf8",
  );

  assert.match(migration, /"aiKeyTakeaways"/);
  assert.match(migration, /"aiImprovementAreas"/);
  assert.match(migration, /"ChefNoteHistory"/);
  assert.match(migration, /REPLACE\("batchPublicId", 'BATCH-', 'BT-'\)/);
});
