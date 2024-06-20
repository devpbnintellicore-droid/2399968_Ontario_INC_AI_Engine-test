require("dotenv").config();

const { PrismaClient } = require("@prisma/client");
const { parseExperimentsFromCsv, resolveCsvPath } = require("./seed/csvParser");
const { seedExperiments } = require("./seed/experiments");
const { seedReviewQuestions } = require("./seed/reviewQuestions");
const { seedStaff } = require("./seed/staff");

const prisma = new PrismaClient();

async function main() {
  const csvPath = resolveCsvPath();
  const experiments = parseExperimentsFromCsv();
  const csvQuestions = experiments.flatMap(
    (experiment) => experiment.reviewAnswers,
  );

  console.log(`Seeding from ${csvPath}`);
  console.log(`Parsed ${experiments.length} grouped cooking experiments`);

  const staff = await seedStaff(prisma, experiments);
  const questions = await seedReviewQuestions(
    prisma,
    staff.manager.id,
    csvQuestions,
  );
  const { saved: savedExperiments, staleCount } = await seedExperiments(
    prisma,
    experiments,
    staff,
    questions,
  );

  console.log(
    `Seed completed: ${savedExperiments.length} experiments upserted`,
  );
  if (staleCount) {
    console.log(`Removed ${staleCount} stale CSV-seeded experiments`);
  }
  console.log("Login users:");
  console.log(
    "  Gurpreet Kaur  manager.pbnintellicore@gmail.com / Manager@123",
  );
  console.log("  Daman Walia     chef.pbnintellicore@gmail.com / Chef@123");
  console.log("  Manvir Kaur reviewer.pbnintellicore@gmail.com / Reviewer@123");
  console.log("  CRA      cra.pbnintellicore@gmail.com / Cra@123");
}

main()
  .catch((error) => {
    console.error("Prisma seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
