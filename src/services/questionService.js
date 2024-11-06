const { prisma } = require("../config/db.js");
const { createAuditLog } = require("../utils/auditLogger.js");

const isBlankAnswer = (value) => {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
};

const getActiveQuestionnaireVersion = async () => {
  let qv = await prisma.questionnaireVersion.findFirst({
    where: { status: "Published" },
    orderBy: { versionNumber: "desc" },
    include: { questions: true },
  });
  if (!qv) {
    // Create default if none exists
    let q = await prisma.questionnaire.findFirst();
    if (!q) {
      q = await prisma.questionnaire.create({
        data: { name: "Default Questionnaire" },
      });
    }
    qv = await prisma.questionnaireVersion.create({
      data: {
        questionnaireId: q.id,
        versionNumber: 1,
        status: "Published",
      },
      include: { questions: true },
    });
  }
  return qv;
};

const createQuestionService = async (data, userId = null, ipAddress = null) => {
  const qv = await getActiveQuestionnaireVersion();

  const question = await prisma.reviewQuestion.create({
    data: {
      question: data.question,
      type: data.type,
      config: data.config || null,
    },
  });

  const questionVersion = await prisma.questionVersion.create({
    data: {
      questionId: question.id,
      version: 1,
      questionText: data.question,
      type: data.type,
      config: data.config || null,
      changedBy: userId,
      questionnaires: {
        connect: { id: qv.id },
      },
    },
  });

  await createAuditLog(prisma, {
    action: "CREATED",
    entity: "Question",
    entityId: question.id,
    entityLabel: `Q-${String(question.id).padStart(3, "0")}`,
    description: `Review question added (v1): "${data.question.slice(0, 60)}${data.question.length > 60 ? "…" : ""}"`,
    userId,
    oldValue: null,
    newValue: { question, questionVersion, reason: "Question created" },
    ipAddress,
  });

  return { ...question, versions: [questionVersion] };
};

const answerQuestionService = async (data, reviewerId, ipAddress = null) => {
  const qv = await getActiveQuestionnaireVersion();
  const question = await prisma.reviewQuestion.findFirst({
    where: { id: Number(data.questionId), deletedAt: null },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });

  if (!question) {
    const error = new Error("Question not found");
    error.statusCode = 404;
    throw error;
  }

  const activeQvId =
    qv.questions.find((q) => q.questionId === data.questionId)?.id ||
    question.versions[0]?.id;
  const optional = question.config?.optional === true;
  const blank = isBlankAnswer(data.answerValue);

  if (blank && !optional) {
    const expLabel = `EXP-${String(data.experimentId).padStart(3, "0")}`;
    await createAuditLog(prisma, {
      action: "MISSING_ANSWER_DETECTED",
      entity: "Review",
      entityId: data.experimentId,
      entityLabel: expLabel,
      description: `Single review answer blocked because mandatory question Q-${data.questionId} was blank`,
      userId: reviewerId,
      oldValue: null,
      newValue: {
        questionId: data.questionId,
        experimentId: data.experimentId,
        questionStatus: "Missing",
        reason: "Mandatory answer cannot be blank",
      },
      ipAddress,
    });
    const error = new Error("Mandatory review question cannot be blank");
    error.statusCode = 400;
    throw error;
  }

  const answer = await prisma.reviewAnswer.create({
    data: {
      questionId: data.questionId,
      questionVersionId: activeQvId,
      experimentId: data.experimentId,
      reviewerId: reviewerId,
      answerValue: blank ? null : data.answerValue,
      questionStatus: blank && optional ? "Optional" : "Answered",
    },
  });

  const expLabel = `EXP-${String(data.experimentId).padStart(3, "0")}`;
  await createAuditLog(prisma, {
    action: "ANSWERED",
    entity: "Review",
    entityId: data.experimentId,
    entityLabel: expLabel,
    description: `Compliance question answered for ${expLabel}`,
    userId: reviewerId,
    oldValue: null,
    newValue: answer,
    ipAddress,
  });

  return answer;
};

const batchAnswerQuestionsService = async (answers, reviewerId) => {
  if (!Array.isArray(answers) || answers.length === 0) return [];

  const experimentId = answers[0].experimentId;

  const existingAnswers = await prisma.reviewAnswer.findFirst({
    where: { experimentId: Number(experimentId) },
  });

  if (existingAnswers) {
    throw new Error(`Answers already exist for experiment ID ${experimentId}`);
  }

  const qv = await getActiveQuestionnaireVersion();

  // The active questions are the ones in the current QuestionnaireVersion
  // Wait, the front end might send answers for ReviewQuestion IDs.
  // We map them to the active QuestionVersion.
  const activeQuestions = await prisma.reviewQuestion.findMany({
    where: { deletedAt: null },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });

  const finalAnswers = [];
  const missingMandatory = [];

  for (const q of activeQuestions) {
    const providedAnswer = answers.find((a) => a.questionId === q.id);
    const isOptional = q.config?.optional === true;
    const currentVersion = q.versions[0]?.id;

    if (
      !providedAnswer ||
      providedAnswer.answerValue === null ||
      providedAnswer.answerValue === ""
    ) {
      if (!isOptional) {
        missingMandatory.push(`Q-${q.id}: ${q.question}`);
      } else {
        finalAnswers.push({
          questionId: q.id,
          questionVersionId: currentVersion,
          experimentId: experimentId,
          reviewerId: reviewerId,
          answerValue: null,
          questionStatus: "Optional",
        });
      }
    } else {
      finalAnswers.push({
        questionId: q.id,
        questionVersionId: currentVersion,
        experimentId: experimentId,
        reviewerId: reviewerId,
        answerValue: providedAnswer.answerValue,
        questionStatus: "Answered",
      });
    }
  }

  const expLabel = `EXP-${String(experimentId).padStart(3, "0")}`;

  if (missingMandatory.length > 0) {
    await createAuditLog(prisma, {
      action: "MISSING_ANSWER_DETECTED",
      entity: "Review",
      entityId: experimentId,
      entityLabel: expLabel,
      description: `Review submission blocked due to missing answers: ${missingMandatory.join(", ")}`,
      userId: reviewerId,
    });

    const error = new Error(
      `Mandatory review questions are missing answers: ${missingMandatory.join(", ")}`,
    );
    error.statusCode = 400;
    throw error;
  }

  const results = await prisma.$transaction(
    finalAnswers.map((ans) =>
      prisma.reviewAnswer.create({
        data: ans,
      }),
    ),
  );

  await createAuditLog(prisma, {
    action: "ANSWERED",
    entity: "Review",
    entityId: experimentId,
    entityLabel: expLabel,
    description: `Compliance batch (${results.length} answers) submitted for ${expLabel}`,
    userId: reviewerId,
  });

  return results;
};

const getAllQuestionsService = async () => {
  return prisma.reviewQuestion.findMany({
    where: { deletedAt: null },
    include: {
      versions: {
        orderBy: { version: "desc" },
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });
};

const updateQuestionService = async (id, data, userId, ipAddress = null) => {
  const existing = await prisma.reviewQuestion.findFirst({
    where: { id, deletedAt: null },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (!existing) throw new Error("Question not found");

  const currentVersion = existing.versions[0];
  const newVersionNumber = (currentVersion ? currentVersion.version : 0) + 1;

  // Update parent
  const updated = await prisma.reviewQuestion.update({
    where: { id },
    data: {
      ...(data.question !== undefined && { question: data.question }),
      ...(data.type !== undefined && { type: data.type }),
      ...(data.config !== undefined && { config: data.config }),
    },
  });

  // Create new version
  const qv = await getActiveQuestionnaireVersion();
  const newQv = await prisma.questionVersion.create({
    data: {
      questionId: id,
      version: newVersionNumber,
      questionText:
        data.question !== undefined ? data.question : existing.question,
      type: data.type !== undefined ? data.type : existing.type,
      config: data.config !== undefined ? data.config : existing.config,
      changedBy: userId,
      questionnaires: {
        connect: { id: qv.id },
      },
    },
  });

  // Create Change Log
  await prisma.questionChangeLog.create({
    data: {
      questionVersionId: newQv.id,
      previousValue: currentVersion
        ? {
            questionText: currentVersion.questionText,
            type: currentVersion.type,
            config: currentVersion.config,
          }
        : null,
      newValue: {
        questionText: newQv.questionText,
        type: newQv.type,
        config: newQv.config,
      },
      changedBy: userId,
    },
  });

  await createAuditLog(prisma, {
    action: "UPDATED",
    entity: "Question",
    entityId: id,
    entityLabel: `Q-${String(id).padStart(3, "0")} (v${newVersionNumber})`,
    description: `Review question Q-${String(id).padStart(3, "0")} updated to version ${newVersionNumber}`,
    userId: userId || null,
    oldValue: {
      question: existing.question,
      type: existing.type,
      config: existing.config,
      version: currentVersion,
    },
    newValue: {
      question: updated.question,
      type: updated.type,
      config: updated.config,
      version: newQv,
      reason: "Question updated",
    },
    ipAddress,
  });

  return updated;
};

const deleteQuestionService = async (id, userId = null, ipAddress = null) => {
  const existing = await prisma.reviewQuestion.findFirst({
    where: { id, deletedAt: null },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (!existing) throw new Error("Question not found");

  const updated = await prisma.reviewQuestion.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  await createAuditLog(prisma, {
    action: "DELETED",
    entity: "Question",
    entityId: id,
    entityLabel: `Q-${String(id).padStart(3, "0")}`,
    description: `Review question Q-${String(id).padStart(3, "0")} softly deleted`,
    userId,
    oldValue: existing,
    newValue: { ...updated, reason: "Question deleted" },
    ipAddress,
  });

  return updated;
};

const getAnswersByExperimentService = async (experimentId) => {
  return prisma.reviewAnswer.findMany({
    where: { experimentId: Number(experimentId) },
    include: {
      question: true,
      questionVersion: true,
      reviewer: {
        select: { id: true, name: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });
};

const snapshotQuestionnaireService = async (userId, ipAddress = null) => {
  const qv = await getActiveQuestionnaireVersion();

  // Archive current
  await prisma.questionnaireVersion.update({
    where: { id: qv.id },
    data: {
      status: "Archived",
      archivedAt: new Date(),
      archivedBy: userId,
    },
  });

  // Create new Published version
  const newQv = await prisma.questionnaireVersion.create({
    data: {
      questionnaireId: qv.questionnaireId,
      versionNumber: qv.versionNumber + 1,
      status: "Published",
      createdBy: userId,
      questions: {
        connect: qv.questions.map((q) => ({ id: q.id })),
      },
    },
  });

  await createAuditLog(prisma, {
    action: "SNAPSHOT_CREATED",
    entity: "Questionnaire",
    entityId: newQv.id,
    entityLabel: `QV-${newQv.versionNumber}`,
    description: `Created snapshot v${newQv.versionNumber} of questionnaire`,
    userId: userId || null,
    oldValue: qv,
    newValue: { ...newQv, reason: "Questionnaire snapshot created" },
    ipAddress,
  });

  return newQv;
};

const getQuestionnaireVersionsService = async () => {
  return prisma.questionnaireVersion.findMany({
    include: {
      questionnaire: true,
      _count: {
        select: { questions: true },
      },
    },
    orderBy: { versionNumber: "desc" },
  });
};

const getQuestionChangeLogsService = async (questionId) => {
  return prisma.questionChangeLog.findMany({
    where: { questionVersion: { questionId: Number(questionId) } },
    include: {
      questionVersion: true,
    },
    orderBy: { changedAt: "desc" },
  });
};

module.exports = {
  createQuestionService,
  answerQuestionService,
  getAllQuestionsService,
  updateQuestionService,
  deleteQuestionService,
  batchAnswerQuestionsService,
  getAnswersByExperimentService,
  snapshotQuestionnaireService,
  getQuestionnaireVersionsService,
  getQuestionChangeLogsService,
};
