const PDFDocument = require("pdfkit");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cloudinary = require("./cloudinary");

const generateVersionReport = async (aiData, publicId) => {
    const tmpFile = path.join(os.tmpdir(), `${publicId}.pdf`);

    await new Promise((resolve, reject) => {
        const doc = new PDFDocument();
        const ws = fs.createWriteStream(tmpFile);
        doc.pipe(ws);

        doc.fontSize(20).text("Recipe Version Intelligence Report");
        doc.moveDown();
        doc.fontSize(14).text(`Best Version: ${aiData.bestVersion}`);
        doc.text(`Worst Version: ${aiData.worstVersion}`);
        doc.moveDown();
        doc.text("Version Suggestions:");
        aiData.versionInsights.forEach(v => {
            doc.moveDown();
            doc.text(`${v.version} → ${v.suggestion}`);
        });
        doc.moveDown();
        doc.text("Final AI Summary:");
        doc.text(aiData.finalSummary);

        doc.end();
        ws.on("finish", resolve);
        ws.on("error", reject);
    });

    try {
        const buffer = await fs.promises.readFile(tmpFile);
        const url = await new Promise((resolve, reject) => {
            cloudinary.uploader.upload_stream(
                {
                    resource_type: "raw",
                    folder: "pbn-cloud-kitchen/reports",
                    public_id: `${publicId}.pdf`,
                },
                (err, result) => {
                    if (err) return reject(err);
                    resolve(result.secure_url);
                }
            ).end(buffer);
        });
        return url;
    } finally {
        try { await fs.promises.unlink(tmpFile); } catch {}
    }
};

module.exports = { generateVersionReport };
