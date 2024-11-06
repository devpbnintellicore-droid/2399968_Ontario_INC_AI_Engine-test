const { prisma } = require("../config/db.js");

const ROLE_DISPLAY = { CHEF: "Chef", MANAGER: "Manager", REVIEWER: "Reviewer", CRA: "CRA" };

const getAuditLogsService = async ({ role, entity, search, page = 1, limit = 50 } = {}) => {
    const skip = (page - 1) * limit;

    const where = {
        ...(entity && entity !== "All" ? { entity } : {}),
        ...(role && role !== "All"
            ? { user: { role: role.toUpperCase() } }
            : {}),
        ...(search
            ? {
                OR: [
                    { description:  { contains: search, mode: "insensitive" } },
                    { entityLabel:  { contains: search, mode: "insensitive" } },
                    { action:       { contains: search, mode: "insensitive" } },
                    { entity:       { contains: search, mode: "insensitive" } },
                    { user: { name: { contains: search, mode: "insensitive" } } },
                ],
            }
            : {}),
    };

    const [rows, total] = await Promise.all([
        prisma.auditLog.findMany({
            where,
            orderBy: { createdAt: "desc" },
            skip,
            take: limit,
            include: {
                user: { select: { id: true, name: true, role: true } },
            },
        }),
        prisma.auditLog.count({ where }),
    ]);

    const data = rows.map((log) => ({
        id:          log.id,
        action:      log.action,
        entity:      log.entity,
        entityId:    log.entityId,
        entityLabel: log.entityLabel,
        description: log.description,
        oldValue: log.oldValue,
        newValue: log.newValue,
        ipAddress: log.ipAddress,
        user: log.user
            ? {
                id:   log.user.id,
                name: log.user.name,
                role: ROLE_DISPLAY[log.user.role] ?? log.user.role,
            }
            : { id: null, name: "System", role: "System" },
        createdAt: log.createdAt,
    }));

    return {
        data,
        meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
};

module.exports = { getAuditLogsService };
