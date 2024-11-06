const DEFAULT_QUESTIONS = [
  {
    question: "How would you rate the overall eating quality of this batch?",
    type: "rating_stars",
    config: { maxStars: 5, required: true },
  },
  {
    question: "Did the final dish match the expected appearance standard?",
    type: "yes_no",
    config: { required: true },
  },
  {
    question: "What specific improvement should the chef make before approval?",
    type: "long_text",
    config: { required: true },
  },
  {
    question: "Write a short final reviewer decision note.",
    type: "short_text",
    config: { required: true },
  },
  {
    question: "Rank the top improvement priorities for this recipe.",
    type: "ranking",
    config: {
      options: [
        "Texture consistency",
        "Aroma profile",
        "Taste balance",
        "Appearance standard",
      ],
      required: false,
    },
  },
];

const ensureQuestionnaireVersion = async (prisma, managerId) => {
  const questionnaire = await prisma.questionnaire.upsert({
    where: { id: 1 },
    update: { name: "Restaurant Recipe Review Questionnaire" },
    create: { name: "Restaurant Recipe Review Questionnaire" },
  });

  const existingVersion = await prisma.questionnaireVersion.findFirst({
    where: { questionnaireId: questionnaire.id, versionNumber: 1 },
  });

  if (existingVersion) {
    return prisma.questionnaireVersion.update({
      where: { id: existingVersion.id },
      data: { status: "Published" },
    });
  }

  return prisma.questionnaireVersion.create({
    data: {
      questionnaireId: questionnaire.id,
      versionNumber: 1,
      status: "Published",
      createdBy: managerId,
    },
  });
};

const ensureReviewQuestion = async (prisma, questionSeed, questionnaireVersion, managerId) => {
  let question = await prisma.reviewQuestion.findFirst({
    where: { question: questionSeed.question, deletedAt: null },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });

  if (!question) {
    question = await prisma.reviewQuestion.create({
      data: {
        question: questionSeed.question,
        type: questionSeed.type,
        config: questionSeed.config,
      },
      include: { versions: true },
    });
  } else {
    question = await prisma.reviewQuestion.update({
      where: { id: question.id },
      data: {
        type: questionSeed.type,
        config: questionSeed.config,
      },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
  }

  let version = question.versions[0];
  if (!version) {
    version = await prisma.questionVersion.create({
      data: {
        questionId: question.id,
        version: 1,
        questionText: questionSeed.question,
        type: questionSeed.type,
        config: questionSeed.config,
        changedBy: managerId,
      },
    });
  } else if (
    version.questionText !== questionSeed.question ||
    version.type !== questionSeed.type ||
    JSON.stringify(version.config || null) !== JSON.stringify(questionSeed.config || null)
  ) {
    version = await prisma.questionVersion.create({
      data: {
        questionId: question.id,
        version: version.version + 1,
        questionText: questionSeed.question,
        type: questionSeed.type,
        config: questionSeed.config,
        changedBy: managerId,
        changeLogs: {
          create: {
            previousValue: {
              questionText: version.questionText,
              type: version.type,
              config: version.config,
            },
            newValue: questionSeed,
            changedBy: managerId,
          },
        },
      },
    });
  }

  await prisma.questionnaireVersion.update({
    where: { id: questionnaireVersion.id },
    data: {
      questions: {
        connect: { id: version.id },
      },
    },
  });

  return { question, version };
};

const seedReviewQuestions = async (prisma, managerId, csvQuestions = []) => {
  const questionnaireVersion = await ensureQuestionnaireVersion(prisma, managerId);
  const seedsByText = new Map(DEFAULT_QUESTIONS.map((item) => [item.question, item]));

  for (const question of csvQuestions) {
    if (!seedsByText.has(question.question)) {
      seedsByText.set(question.question, {
        question: question.question,
        type: question.type || "short_text",
        config: { required: false },
      });
    }
  }

  const questionMap = new Map();
  for (const seed of seedsByText.values()) {
    const ensured = await ensureReviewQuestion(prisma, seed, questionnaireVersion, managerId);
    questionMap.set(seed.question, ensured);
  }

  return questionMap;
};

module.exports = {
  DEFAULT_QUESTIONS,
  seedReviewQuestions,
};
