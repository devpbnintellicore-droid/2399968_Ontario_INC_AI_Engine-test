const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../utils/cloudinary");

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: (req, file) => {
    // Build a safe, URL-friendly folder name from recipe name and version
    const recipeName = (req.body.recipeName || "unknown")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase();
    const version = (req.body.recipeVersion || "v1")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase();

    const folder = `pbn-cloud-kitchen/experiments/${recipeName}-${version}`;

    return {
      folder,
      allowed_formats: ["jpg", "png", "jpeg"],
      public_id: `${Date.now()}-${file.originalname.replace(/\.[^.]+$/, "")}`,
    };
  },
});

const upload = multer({ storage: storage });

module.exports = upload;

