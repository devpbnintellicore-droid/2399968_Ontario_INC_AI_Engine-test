require("dotenv").config();

const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcrypt");

const prisma = new PrismaClient();

const managerSeed = {
  name: process.env.MANAGER_NAME || "Manager",
  email: (process.env.MANAGER_EMAIL || "manager.pbnintellicore@gmail.com")
    .trim()
    .toLowerCase(),
  password: process.env.MANAGER_PASSWORD || "Manager@123",
};

async function main() {
  const passwordHash = await bcrypt.hash(managerSeed.password, 10);
  const existing = await prisma.staff.findUnique({
    where: { email: managerSeed.email },
  });

  if (existing) {
    const needsRoleHistory =
      existing.role !== "MANAGER" ||
      existing.status !== "ACTIVE" ||
      existing.deletedAt;

    const manager = await prisma.staff.update({
      where: { id: existing.id },
      data: {
        name: managerSeed.name,
        password: passwordHash,
        role: "MANAGER",
        status: "ACTIVE",
        deletedAt: null,
        deactivatedAt: null,
        deactivatedBy: null,
        deactivationReason: null,
        ...(needsRoleHistory
          ? {
              RoleHistory: {
                create: {
                  oldRole: existing.role,
                  newRole: "MANAGER",
                  changedAt: new Date(),
                },
              },
            }
          : {}),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
      },
    });

    console.log("Manager seed updated:", manager);
    return;
  }

  const manager = await prisma.staff.create({
    data: {
      name: managerSeed.name,
      email: managerSeed.email,
      password: passwordHash,
      role: "MANAGER",
      status: "ACTIVE",
      RoleHistory: {
        create: {
          newRole: "MANAGER",
          changedAt: new Date(),
        },
      },
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      status: true,
    },
  });

  console.log("Manager seed created:", manager);
}

main()
  .catch((error) => {
    console.error("Manager seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
