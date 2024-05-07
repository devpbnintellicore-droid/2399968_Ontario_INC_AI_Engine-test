const bcrypt = require("bcryptjs");

const SYSTEM_USERS = [
  {
    name: "Gurpreet Kaur",
    email: "manager.pbnintellicore@gmail.com",
    password: "Manager@123",
    role: "MANAGER",
  },
  {
    name: "Daman Walia ",
    email: "chef.pbnintellicore@gmail.com",
    password: "Chef@123",
    role: "CHEF",
  },
  {
    name: "Manvir Kaur",
    email: "reviewer.pbnintellicore@gmail.com",
    password: "Reviewer@123",
    role: "REVIEWER",
  },
  {
    name: "CRA Auditor",
    email: "cra.pbnintellicore@gmail.com",
    password: "Cra@123",
    role: "CRA",
  },
];

const upsertStaff = async (prisma, staff) => {
  const email = staff.email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(staff.password, 10);
  const existing = await prisma.staff.findUnique({ where: { email } });
  const roleChanged = existing && existing.role !== staff.role;

  const user = await prisma.staff.upsert({
    where: { email },
    update: {
      name: staff.name,
      password: passwordHash,
      role: staff.role,
      status: "ACTIVE",
      deletedAt: null,
      deactivatedAt: null,
      deactivatedBy: null,
      deactivationReason: null,
    },
    create: {
      name: staff.name,
      email,
      password: passwordHash,
      role: staff.role,
      status: "ACTIVE",
    },
  });

  if (!existing || roleChanged) {
    await prisma.roleHistory.create({
      data: {
        userId: user.id,
        oldRole: existing?.role ?? null,
        newRole: staff.role,
        changedBy: null,
      },
    });
  }

  return user;
};

const seedStaff = async (prisma) => {
  const usersByRole = {};

  for (const staff of SYSTEM_USERS) {
    const user = await upsertStaff(prisma, staff);
    usersByRole[staff.role] = user;
  }

  await prisma.reviewerAssignment.upsert({
    where: { reviewerId: usersByRole.REVIEWER.id },
    update: { assignedBy: usersByRole.MANAGER.id },
    create: {
      reviewerId: usersByRole.REVIEWER.id,
      assignedBy: usersByRole.MANAGER.id,
    },
  });

  return {
    manager: usersByRole.MANAGER,
    chef: usersByRole.CHEF,
    reviewer: usersByRole.REVIEWER,
    cra: usersByRole.CRA,
  };
};

const getStaffForExperiment = async (prisma, experiment, seededStaff) => {
  return {
    chef: seededStaff.chef,
    reviewer: seededStaff.reviewer,
    manager: seededStaff.manager,
    cra: seededStaff.cra,
  };
};

module.exports = {
  SYSTEM_USERS,
  getStaffForExperiment,
  seedStaff,
};
