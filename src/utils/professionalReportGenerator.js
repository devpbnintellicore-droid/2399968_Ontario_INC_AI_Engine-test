"use strict";
const PDFDocument = require("pdfkit");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cloudinary = require("./cloudinary");

// ═══════════════════════════════════════════════════════════════
//  DESIGN TOKENS
// ═══════════════════════════════════════════════════════════════
const C = {
    pageBg: "#0D1117",
    cardBg: "#161B22",
    cardBorder: "#21262D",
    gold: "#F0A500",
    goldLight: "#FFD166",
    goldDim: "#3D2800",
    success: "#3FB950",
    successBg: "#0D2B16",
    successBorder: "#1E4620",
    danger: "#F85149",
    dangerBg: "#2B0D0D",
    dangerBorder: "#4A1010",
    neutral: "#58A6FF",
    neutralBg: "#0D1F3C",
    neutralBorder: "#1A3A6E",
    textPrimary: "#E6EDF3",
    textSecondary: "#8B949E",
    textMuted: "#484F58",
    divider: "#21262D",
    dividerBright: "#30363D",
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const ML = 44;
const MR = 44;
const CONTENT_W = PAGE_W - ML - MR;
const CARD_H = 72;

// ═══════════════════════════════════════════════════════════════
//  PRIMITIVE HELPERS
// ═══════════════════════════════════════════════════════════════

const fmtV = (v) => (v != null ? `v${v}` : "—");

/** Filled rounded rect — always wrapped in save/restore */
const fillRR = (doc, x, y, w, h, r, color) => {
    doc.save().roundedRect(x, y, w, h, r).fill(color).restore();
};

/** Filled + stroked rounded rect */
const borderedRR = (doc, x, y, w, h, r, fillColor, strokeColor) => {
    doc.save()
        .roundedRect(x, y, w, h, r)
        .fillAndStroke(fillColor, strokeColor);
    doc.lineWidth(0.5).restore();
};

/** Horizontal rule */
const hRule = (doc, y, color = C.divider, x = ML, w = CONTENT_W) => {
    doc.save()
        .moveTo(x, y).lineTo(x + w, y)
        .strokeColor(color).lineWidth(0.5).stroke()
        .restore();
};

/**
 * FIX #1 — Paint dark background on every page.
 * Must be called immediately after doc.addPage().
 * In bufferPages mode, PDFKit does NOT auto-fill background,
 * so every page must call this before drawing anything.
 */
const paintPageBg = (doc) => {
    doc.save().rect(0, 0, PAGE_W, PAGE_H).fill(C.pageBg).restore();
};

// ═══════════════════════════════════════════════════════════════
//  HEADER
// ═══════════════════════════════════════════════════════════════
const drawHeader = (doc, title) => {
    // FIX #2 — Every draw call wrapped in save/restore so
    // fillColor / font never bleeds into the next element.
    doc.save().rect(0, 0, PAGE_W, 90).fill(C.cardBg).restore();
    doc.save().rect(0, 0, 4, 90).fill(C.gold).restore();
    hRule(doc, 89.5, C.dividerBright, 0, PAGE_W);

    // Logo squares
    const lx = 20, ly = 26, sq = 8, g = 2;
    [[0, 0, C.gold], [sq + g, 0, C.goldDim], [0, sq + g, C.goldDim], [sq + g, sq + g, C.gold]]
        .forEach(([dx, dy, col]) => {
            doc.save().rect(lx + dx, ly + dy, sq, sq).fill(col).restore();
        });

    const ds = new Date().toLocaleDateString("en-GB",
        { day: "2-digit", month: "short", year: "numeric" });

    doc.save()
        .font("Helvetica-Bold").fontSize(17).fillColor(C.textPrimary)
        .text(title, 58, 27, { lineBreak: false })
        .restore();

    doc.save()
        .font("Helvetica").fontSize(8).fillColor(C.textSecondary)
        .text(`Generated ${ds}  ·  Confidential`, 58, 50, { lineBreak: false })
        .restore();

    doc.save()
        .font("Helvetica-Bold").fontSize(6.5).fillColor(C.textMuted)
        .text("PORTFOLIO REPORT", PAGE_W - MR - 110, 22,
            { width: 110, align: "right", characterSpacing: 1, lineBreak: false })
        .restore();

    doc.save()
        .font("Helvetica-Bold").fontSize(6.5).fillColor(C.gold)
        .text("INTELLIGENCE SUITE", PAGE_W - MR - 110, 35,
            { width: 110, align: "right", characterSpacing: 0.8, lineBreak: false })
        .restore();
};

// ═══════════════════════════════════════════════════════════════
//  FOOTER
// ═══════════════════════════════════════════════════════════════
const drawFooter = (doc, pageNum, totalPages) => {
    const fy = PAGE_H - 34;
    doc.save().rect(0, fy, PAGE_W, 34).fill(C.cardBg).restore();
    hRule(doc, fy, C.dividerBright, 0, PAGE_W);
    doc.save().rect(0, fy, 4, 34).fill(C.gold).restore();

    doc.save()
        .font("Helvetica-Bold").fontSize(6.5).fillColor(C.gold)
        .text("RECIPE INTELLIGENCE", ML, fy + 12,
            { lineBreak: false, characterSpacing: 0.8 })
        .restore();

    doc.save()
        .font("Helvetica").fontSize(6.5).fillColor(C.textMuted)
        .text(`Page ${pageNum} / ${totalPages}`, PAGE_W - MR - 60, fy + 12,
            { width: 60, align: "right", lineBreak: false })
        .restore();
};

// ═══════════════════════════════════════════════════════════════
//  SECTION LABEL
// ═══════════════════════════════════════════════════════════════
const sectionLabel = (doc, text, y) => {
    doc.save()
        .polygon([ML, y + 6], [ML + 6, y], [ML + 12, y + 6], [ML + 6, y + 12])
        .fill(C.gold).restore();

    doc.save()
        .font("Helvetica-Bold").fontSize(10).fillColor(C.textPrimary)
        .text(text.toUpperCase(), ML + 20, y + 2,
            { lineBreak: false, characterSpacing: 1.1 })
        .restore();

    hRule(doc, y + 18, C.gold, ML, 70);
    hRule(doc, y + 18, C.divider, ML + 70, CONTENT_W - 70);

    return y + 32;
};

// ═══════════════════════════════════════════════════════════════
//  SUMMARY BADGES  (best / worst)
// ═══════════════════════════════════════════════════════════════
const drawHeaderBadges = (doc, bestRecipe, worstRecipe) => {
    const y = 100;
    const bw = (CONTENT_W / 2) - 8;

    // Best
    borderedRR(doc, ML, y, bw, 52, 7, C.successBg, C.successBorder);
    doc.save().rect(ML, y, 3, 52).fill(C.success).restore();
    doc.save()
        .font("Helvetica-Bold").fontSize(6.5).fillColor(C.success)
        .text("★  TOP PERFORMER", ML + 12, y + 9,
            { lineBreak: false, characterSpacing: 0.9 })
        .restore();
    doc.save()
        .font("Helvetica-Bold").fontSize(12).fillColor(C.textPrimary)
        .text(bestRecipe || "—", ML + 12, y + 25,
            { width: bw - 20, lineBreak: false })
        .restore();

    // Worst
    const wx = ML + bw + 16;
    borderedRR(doc, wx, y, bw, 52, 7, C.dangerBg, C.dangerBorder);
    doc.save().rect(wx, y, 3, 52).fill(C.danger).restore();
    doc.save()
        .font("Helvetica-Bold").fontSize(6.5).fillColor(C.danger)
        .text("▼  NEEDS ATTENTION", wx + 12, y + 9,
            { lineBreak: false, characterSpacing: 0.9 })
        .restore();
    doc.save()
        .font("Helvetica-Bold").fontSize(12).fillColor(C.textPrimary)
        .text(worstRecipe || "—", wx + 12, y + 25,
            { width: bw - 20, lineBreak: false })
        .restore();
};

// ═══════════════════════════════════════════════════════════════
//  STATS STRIP
// ═══════════════════════════════════════════════════════════════
const drawStatsStrip = (doc, recipes, y) => {
    const scores = recipes.map(r => Number(r.recipeScore) || 0);
    const avg = scores.length
        ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2) : "—";
    const highest = scores.length ? Math.max(...scores).toFixed(2) : "—";
    const lowest = scores.length ? Math.min(...scores).toFixed(2) : "—";

    const stats = [
        { label: "RECIPES RANKED", value: recipes.length, color: C.gold },
        { label: "AVG SCORE", value: avg, color: C.neutral },
        { label: "HIGHEST SCORE", value: highest, color: C.success },
        { label: "LOWEST SCORE", value: lowest, color: C.danger },
    ];

    const H = 52, cellW = CONTENT_W / stats.length;
    borderedRR(doc, ML, y, CONTENT_W, H, 6, C.cardBg, C.cardBorder);

    stats.forEach((s, i) => {
        const cx = ML + i * cellW;
        if (i > 0) {
            doc.save()
                .moveTo(cx, y + 8).lineTo(cx, y + H - 8)
                .strokeColor(C.divider).lineWidth(0.5).stroke()
                .restore();
        }
        doc.save()
            .font("Helvetica").fontSize(6.5).fillColor(C.textMuted)
            .text(s.label, cx, y + 9,
                { width: cellW, align: "center", characterSpacing: 0.7 })
            .restore();
        doc.save()
            .font("Helvetica-Bold").fontSize(18).fillColor(s.color)
            .text(String(s.value), cx, y + 22,
                { width: cellW, align: "center" })
            .restore();
    });

    return y + H + 12;
};

// ═══════════════════════════════════════════════════════════════
//  RECIPE CARD
// ═══════════════════════════════════════════════════════════════
const drawRecipeCard = (doc, r, i, y, isBest, isWorst) => {
    const bg = isBest ? C.successBg : isWorst ? C.dangerBg : C.cardBg;
    const accent = isBest ? C.success : isWorst ? C.danger : C.neutral;
    const border = isBest ? C.successBorder : isWorst ? C.dangerBorder : C.cardBorder;

    borderedRR(doc, ML, y, CONTENT_W, CARD_H, 7, bg, border);

    // Left accent bar
    doc.save().roundedRect(ML, y, 4, CARD_H, 3).fill(accent).restore();

    // Rank circle
    const rkx = ML + 22, rky = y + CARD_H / 2;
    doc.save().circle(rkx, rky, 14).fill(accent).restore();
    doc.save()
        .font("Helvetica-Bold").fontSize(i + 1 < 10 ? 12 : 10)
        .fillColor(C.pageBg)
        .text(`${i + 1}`, rkx - 14, rky - 8, { width: 28, align: "center" })
        .restore();

    // Recipe name
    doc.save()
        .font("Helvetica-Bold").fontSize(13).fillColor(C.textPrimary)
        .text(r.recipeName, ML + 46, y + 10,
            { width: CONTENT_W - 190, lineBreak: false })
        .restore();

    // Status tag
    if (isBest || isWorst) {
        const tag = isBest ? "★  BEST RECIPE" : "▼  WORST RECIPE";
        const tagC = isBest ? C.success : C.danger;
        const tagBg = isBest ? C.successBg : C.dangerBg;
        const tagW = doc.font("Helvetica-Bold").fontSize(6.5)
            .widthOfString(tag) + 18;
        borderedRR(doc, ML + 46, y + 30, tagW, 15, 3, tagBg, tagC);
        doc.save()
            .font("Helvetica-Bold").fontSize(6.5).fillColor(tagC)
            .text(tag, ML + 55, y + 34, { lineBreak: false, characterSpacing: 0.5 })
            .restore();
    }

    // Score — right column
    const scoreStr = r.recipeScore != null
        ? Number(r.recipeScore).toFixed(2) : "—";
    const sx = PAGE_W - MR - 115;

    doc.save()
        .font("Helvetica").fontSize(6.5).fillColor(C.textMuted)
        .text("PERFORMANCE SCORE", sx, y + 10,
            { width: 100, align: "right", characterSpacing: 0.5 })
        .restore();
    doc.save()
        .font("Helvetica-Bold").fontSize(22).fillColor(accent)
        .text(scoreStr, sx, y + 22, { width: 100, align: "right" })
        .restore();

    // Inner divider
    hRule(doc, y + CARD_H - 20, C.divider, ML + 4, CONTENT_W - 8);

    // Version row
    const rowY = y + CARD_H - 14;
    doc.save()
        .font("Helvetica").fontSize(7.5).fillColor(C.textSecondary)
        .text("Best:", ML + 46, rowY, { lineBreak: false })
        .restore();
    doc.save()
        .font("Helvetica-Bold").fontSize(7.5).fillColor(C.textPrimary)
        .text(fmtV(r.bestVersion), ML + 72, rowY, { lineBreak: false })
        .restore();
    doc.save()
        .font("Helvetica").fontSize(7.5).fillColor(C.textSecondary)
        .text("Worst:", ML + 165, rowY, { lineBreak: false })
        .restore();
    doc.save()
        .font("Helvetica-Bold").fontSize(7.5).fillColor(C.textPrimary)
        .text(fmtV(r.worstVersion), ML + 196, rowY, { lineBreak: false })
        .restore();

    return y + CARD_H + 10;
};

// ═══════════════════════════════════════════════════════════════
//  AI INSIGHTS PAGE
// ═══════════════════════════════════════════════════════════════
const drawInsightsPage = (doc, insights) => {
    // FIX #3 — addPage() then immediately paintPageBg()
    doc.addPage();
    paintPageBg(doc);

    let y = 60;
    y = sectionLabel(doc, "AI Portfolio Strategic Insights", y);
    y += 10;

    const entries = Object.entries(insights || {});

    if (!entries.length) {
        borderedRR(doc, ML, y, CONTENT_W, 56, 6, C.cardBg, C.cardBorder);
        doc.save()
            .font("Helvetica").fontSize(10).fillColor(C.textMuted)
            .text("No AI insights available for this portfolio.", ML + 20, y + 20)
            .restore();
        return;
    }

    entries.forEach(([key, value]) => {
        const body = typeof value === "object"
            ? JSON.stringify(value, null, 2) : String(value);
        const textH = doc.font("Helvetica").fontSize(9)
            .heightOfString(body, { width: CONTENT_W - 32 });
        const blockH = textH + 22;

        if (y + 24 + blockH > PAGE_H - 50) {
            doc.addPage();
            paintPageBg(doc);   // ← dark bg on every overflow page too
            y = 60;
        }

        // Key chip
        const label = key.replace(/([A-Z])/g, " $1").trim().toUpperCase();
        const chipW = doc.font("Helvetica-Bold").fontSize(6.5)
            .widthOfString(label) + 22;
        fillRR(doc, ML, y, chipW, 18, 4, C.goldDim);
        doc.save()
            .font("Helvetica-Bold").fontSize(6.5).fillColor(C.goldLight)
            .text(label, ML + 11, y + 5, { lineBreak: false, characterSpacing: 0.8 })
            .restore();

        y += 22;

        // Value card
        borderedRR(doc, ML, y, CONTENT_W, blockH, 6, C.cardBg, C.cardBorder);
        doc.save().rect(ML, y, 3, blockH).fill(C.gold).restore();
        doc.save()
            .font("Helvetica").fontSize(9).fillColor(C.textSecondary)
            .text(body, ML + 14, y + 11, { width: CONTENT_W - 28 })
            .restore();

        y += blockH + 14;
    });
};

// ═══════════════════════════════════════════════════════════════
//  MAIN EXPORT
// ═══════════════════════════════════════════════════════════════
const generatePortfolioProfessionalReport = async (portfolioData, publicId) => {
    const tmpFile = path.join(os.tmpdir(), `${publicId}.pdf`);

    await new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: "A4",
            margins: { top: 40, bottom: 50, left: ML, right: MR },
            bufferPages: true,
            autoFirstPage: false,
        });

        const ws = fs.createWriteStream(tmpFile);
        doc.pipe(ws);

        doc.addPage();
        paintPageBg(doc);

        drawHeader(doc, "Recipe Portfolio Intelligence");
        drawHeaderBadges(doc, portfolioData.bestRecipe, portfolioData.worstRecipe);

        let y = 164;
        y = sectionLabel(doc, "Portfolio Performance Ranking", y);
        y += 8;

        const recipes = portfolioData.rankedRecipes || [];
        y = drawStatsStrip(doc, recipes, y);

        recipes.forEach((r, i) => {
            if (y + CARD_H + 12 > PAGE_H - 50) {
                doc.addPage();
                paintPageBg(doc);
                y = 60;
            }
            y = drawRecipeCard(doc, r, i, y,
                r.recipeName === portfolioData.bestRecipe,
                r.recipeName === portfolioData.worstRecipe
            );
        });

        drawInsightsPage(doc, portfolioData.aiInsights);

        const totalPages = doc.bufferedPageRange().count;
        for (let i = 0; i < totalPages; i++) {
            doc.switchToPage(i);
            drawFooter(doc, i + 1, totalPages);
        }

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

module.exports = { generatePortfolioProfessionalReport };