const createAuditLog = async (
    db,
    { action, entity, entityId, entityLabel, description, userId, oldValue, newValue, ipAddress },
) => {
    try {
        await db.auditLog.create({
            data: {
                action,
                entity,
                entityId:    entityId    ?? null,
                entityLabel: entityLabel ?? null,
                description,
                oldValue:    oldValue    ?? null,
                newValue:    newValue    ?? null,
                ipAddress:   ipAddress   ?? null,
                userId:      userId      ?? null,
            },
        });
    } catch (err) {
        console.error("[AuditLog] Write failed:", err.message);
    }
};

module.exports = { createAuditLog };
