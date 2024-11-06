// const jwt = require("jsonwebtoken");
// const { prisma } = require("../config/db");

// const verifyToken = async (req, res, next) => {
//   try {
//     const header = req.headers.authorization;

//     if (!header) {
//       return res.status(401).json({
//         success: false,
//         message: "No token provided",
//       });
//     }

//     const token = header.split(" ")[1];

//     const decoded = jwt.verify(token, process.env.JWT_SECRET);

//     // Check if user is still active in database
//     const user = await prisma.staff.findUnique({
//       where: { id: decoded.id },
//       select: { status: true },
//     });

//     if (!user || user.status !== "ACTIVE") {
//       return res.status(403).json({
//         success: false,
//         message: "Account is inactive or does not exist.",
//       });
//     }

//     req.user = decoded;
//     next();
//   } catch (err) {
//     return res.status(401).json({
//       success: false,
//       message: "Invalid or expired token",
//     });
//   }
// };

// module.exports = verifyToken;

const jwt = require("jsonwebtoken");
const { prisma } = require("../config/db");

const verifyToken = async (req, res, next) => {
  try {
    const header = req.headers.authorization;

    // Check authorization header
    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "No token provided",
      });
    }

    // Extract token
    const token = header.split(" ")[1];

    // Verify JWT
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    // console.log("decoded.role", decoded);

    // Fetch latest user data from database
    const user = await prisma.staff.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        status: true,
        deletedAt: true,
      },
    });
    // console.log("user.role", user.role);

    // User not found or soft deleted
    if (!user || user.deletedAt !== null) {
      return res.status(401).json({
        success: false,
        message: "Account does not exist",
      });
    }

    // User inactive
    if (user.status !== "ACTIVE") {
      return res.status(403).json({
        success: false,
        message: "Account is inactive",
      });
    }

    if (decoded.role !== user.role) {
      return res.status(401).json({
        success: false,
        message: "Invalid role",
      });
    }

    req.user = user;

    next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token",
    });
  }
};

module.exports = verifyToken;
