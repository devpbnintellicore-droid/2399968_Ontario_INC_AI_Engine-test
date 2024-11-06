"use strict";
const PDFDocument = require("pdfkit");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cloudinary = require("./cloudinary");
const { computeSensoryScore } = require("./analyticsHelper");

// ═══════════════════════════════════════════════════════════════
//  DESIGN TOKENS  — matched to single-recipe report screenshot
// ═══════════════════════════════════════════════════════════════
const C = {
    // Page
    pageBg: "#F0F4F8",       // light grey (matches screenshot)

    // Cards
    cardBg: "#DDEEFF",       // light blue neutral card
    cardBorder: "#2E6DA4",       // mid-blue border
    successBg: "#C8E6C9",       // light green (best)
    successBorder: "#2E7D32",       // dark green
    success: "#2E7D32",
    dangerBg: "#FFCDD2",       // light red/pink (worst)
    dangerBorder: "#C62828",       // dark red
    danger: "#C62828",
    neutral: "#2E6DA4",       // blue accent text

    // Bars
    barBest: "#2E7D32",
    barNeutral: "#C9A84C",       // gold bar
    barWorst: "#66BB6A",
    barBg: "#CFD8DC",

    // Gold accents
    gold: "#C9A84C",
    goldLight: "#E8C97A",
    goldDim: "#7A6020",

    // Typography
    textPrimary: "#1B3A5C",       // navy
    textSecondary: "#455A64",
    textMuted: "#78909C",
    textLight: "#FFFFFF",

    // Dividers
    divider: "#CFD8DC",
    dividerBright: "#B0BEC5",

    // Header  (navy + blue panel + gold line — matches screenshot)
    headerBg: "#1B3A5C",
    headerAccent: "#2E6DA4",
    headerLine: "#C9A84C",
    headerTextSub: "#C9A84C",

    // Footer
    footerBg: "#1B3A5C",
    footerGold: "#C9A84C",
    footerMuted: "#90A4AE",
};

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const ML = 44;
const MR = 44;
const CONTENT_W = PAGE_W - ML - MR;
const CARD_H = 72;
const HEADER_SAFE_Y = 112;
const CONTENT_TOP_Y = 60;
const FOOTER_H = 30;
const BOTTOM_SAFE_Y = PAGE_H - FOOTER_H - 20; // 791.89
// ═══════════════════════════════════════════════════════════════
//  PRIMITIVES  (unchanged)
// ═══════════════════════════════════════════════════════════════

const fmtV = (v) => (v != null ? `v${v}` : "—");

const fillRR = (doc, x, y, w, h, r, color) =>
    doc.save().roundedRect(x, y, w, h, r).fill(color).restore();

const fmtReportV = (v) => {
    if (v == null || v === "") return "N/A";
    const value = String(v).trim();
    return value.toLowerCase().startsWith("v") ? value : `v${value}`;
};

const normalizeVersion = (v) => String(v || "").trim().replace(/^v+/i, "");

const sameVersion = (a, b) => normalizeVersion(a) === normalizeVersion(b);

const toFiniteNumber = (value) => {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
};

const getReportScore = (version) => {
    const overallScore = toFiniteNumber(version.overallScore);
    if (overallScore !== null) return overallScore;

    const confidenceScore = toFiniteNumber(version.confidenceScore);
    if (confidenceScore !== null) return confidenceScore;

    return computeSensoryScore(version);
};

const formatScore = (value) => {
    const number = toFiniteNumber(value);
    return number !== null ? number.toFixed(2) : "N/A";
};

const borderedRR = (doc, x, y, w, h, r, fillColor, strokeColor) => {
    doc.save()
        .roundedRect(x, y, w, h, r)
        .fillAndStroke(fillColor, strokeColor);
    doc.lineWidth(0.8).restore();
};

const hRule = (doc, y, color = C.divider, x = ML, w = CONTENT_W) =>
    doc.save().moveTo(x, y).lineTo(x + w, y)
        .strokeColor(color).lineWidth(0.5).stroke().restore();

const paintPageBg = (doc) =>
    doc.save().rect(0, 0, PAGE_W, PAGE_H).fill(C.pageBg).restore();

// ═══════════════════════════════════════════════════════════════
//  HEADER  — changed to match single-recipe report
//  Navy base + blue accent panel top-right + gold bottom line
//  + diamond logo + RECIPE/INTELLIGENCE wordmark + BEST/IMPROVE badges
// ═══════════════════════════════════════════════════════════════
const drawHeader = (doc, title, bestRecipe, worstRecipe) => {
    const H = 100;

    // Navy base bar
    doc.save().rect(0, 0, PAGE_W, H).fill(C.headerBg).restore();

    // Blue accent panel — top-right triangle panel (matches screenshot)
    doc.save()
        .moveTo(PAGE_W * 0.60, 0).lineTo(PAGE_W, 0)
        .lineTo(PAGE_W, H).lineTo(PAGE_W * 0.72, H)
        .fill(C.headerAccent).restore();

    // Gold bottom border line (3px, matches screenshot)
    doc.save().rect(0, H - 3, PAGE_W, 3).fill(C.headerLine).restore();

    // Diamond logo mark
    const lx = ML, ly = 30;
    doc.save()
        .polygon([lx + 10, ly], [lx + 20, ly + 10], [lx + 10, ly + 20], [lx, ly + 10])
        .fill(C.headerLine).restore();
    doc.save()
        .polygon([lx + 10, ly + 4], [lx + 16, ly + 10], [lx + 10, ly + 16], [lx + 4, ly + 10])
        .fill(C.headerBg).restore();

    // RECIPE (white) + INTELLIGENCE (gold) wordmark
    const recipeW = doc.font("Helvetica-Bold").fontSize(20).widthOfString("RECIPE");
    doc.save()
        .font("Helvetica-Bold").fontSize(20).fillColor(C.textLight)
        .text("RECIPE", ML + 28, 26, { lineBreak: false })
        .restore();
    doc.save()
        .font("Helvetica-Bold").fontSize(20).fillColor(C.headerLine)
        .text("INTELLIGENCE", ML + 28 + recipeW + 4, 26, { lineBreak: false })
        .restore();

    // Report title (recipe/portfolio name)
    doc.save()
        .font("Helvetica-Bold").fontSize(13).fillColor(C.textLight)
        .text(title, ML + 28, 54, { lineBreak: false })
        .restore();

    // Subtitle + date
    const ds = new Date().toLocaleDateString("en-GB",
        { day: "2-digit", month: "short", year: "numeric" });
    doc.save()
        .font("Helvetica").fontSize(7.5).fillColor(C.headerLine)
        .text(`PORTFOLIO REPORT  •  Generated ${ds}`, ML + 28, 72, { lineBreak: false })
        .restore();

    // BEST badge (top-right, gold — matches screenshot)
    const bx = PAGE_W - MR - 155, by = 14;
    fillRR(doc, bx, by, 145, 26, 4, C.gold);
    doc.save()
        .font("Helvetica-Bold").fontSize(9).fillColor(C.headerBg)
        .text(`BEST  ${bestRecipe || "—"}`, bx, by + 8,
            { width: 145, align: "center", lineBreak: false })
        .restore();

    // IMPROVE badge (red — matches screenshot)
    const iy = by + 32;
    fillRR(doc, bx, iy, 145, 26, 4, C.danger);
    doc.save()
        .font("Helvetica-Bold").fontSize(9).fillColor(C.textLight)
        .text(`IMPROVE  ${worstRecipe || "—"}`, bx, iy + 8,
            { width: 145, align: "center", lineBreak: false })
        .restore();
};

// ═══════════════════════════════════════════════════════════════
//  FOOTER  — changed to navy + gold (matches screenshot)
// ═══════════════════════════════════════════════════════════════
const drawFooter = (doc, pageNum, totalPages) => {
    const fy = PAGE_H - 30;
    doc.save().rect(0, fy, PAGE_W, 30).fill(C.footerBg).restore();
    doc.save().rect(0, fy, PAGE_W, 2).fill(C.footerGold).restore();

    doc.save()
        .font("Helvetica-Bold").fontSize(6.5).fillColor(C.footerGold)
        .text("RECIPE INTELLIGENCE  •  Confidential", ML, fy + 10,
            { lineBreak: false, characterSpacing: 0.5 })
        .restore();
    doc.save()
        .font("Helvetica").fontSize(6.5).fillColor(C.footerMuted)
        .text(`Page ${pageNum} / ${totalPages}`, PAGE_W - MR - 60, fy + 10,
            { width: 60, align: "right", lineBreak: false })
        .restore();
};

// ═══════════════════════════════════════════════════════════════
//  SECTION LABEL  — navy text + gold underline (matches screenshot)
// ═══════════════════════════════════════════════════════════════
const sectionLabel = (doc, text, y) => {
    doc.save()
        .font("Helvetica-Bold").fontSize(10).fillColor(C.textPrimary)
        .text(text.toUpperCase(), ML, y + 2,
            { lineBreak: false, characterSpacing: 1.1 })
        .restore();

    hRule(doc, y + 18, C.gold, ML, 70);
    hRule(doc, y + 18, C.divider, ML + 70, CONTENT_W - 70);

    return y + 32;
};

// ═══════════════════════════════════════════════════════════════
//  SUMMARY BADGES  — same layout, new colors
// ═══════════════════════════════════════════════════════════════
const drawHeaderBadges = (doc, bestRecipe, worstRecipe) => {
    const y = 112;
    const bw = (CONTENT_W / 2) - 8;

    borderedRR(doc, ML, y, bw, 52, 7, C.successBg, C.successBorder);
    doc.save().rect(ML, y, 3, 52).fill(C.success).restore();
    doc.save()
        .font("Helvetica-Bold").fontSize(6.5).fillColor(C.success)
        .text("TOP PERFORMER", ML + 12, y + 9,
            { lineBreak: false, characterSpacing: 0.9 })
        .restore();
    doc.save()
        .font("Helvetica-Bold").fontSize(12).fillColor(C.textPrimary)
        .text(bestRecipe || "—", ML + 12, y + 25, { width: bw - 20, lineBreak: false })
        .restore();

    const wx = ML + bw + 16;
    borderedRR(doc, wx, y, bw, 52, 7, C.dangerBg, C.dangerBorder);
    doc.save().rect(wx, y, 3, 52).fill(C.danger).restore();
    doc.save()
        .font("Helvetica-Bold").fontSize(6.5).fillColor(C.danger)
        .text("NEEDS ATTENTION", wx + 12, y + 9,
            { lineBreak: false, characterSpacing: 0.9 })
        .restore();
    doc.save()
        .font("Helvetica-Bold").fontSize(12).fillColor(C.textPrimary)
        .text(worstRecipe || "—", wx + 12, y + 25, { width: bw - 20, lineBreak: false })
        .restore();
};

// ═══════════════════════════════════════════════════════════════
//  STATS STRIP  — same layout, new colors
// ═══════════════════════════════════════════════════════════════
const drawStatsStrip = (doc, recipes, y) => {
  const scores = recipes.map((r) => Number(r.recipeScore) || 0);
  const avg = scores.length
    ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)
    : "—";
  const highest = scores.length ? Number(Math.max(...scores)).toFixed(2) : "—";
  const lowest = scores.length ? Number(Math.min(...scores)).toFixed(2) : "—";

  const stats = [
    { label: "VERSIONS RANKED", value: recipes.length, color: C.gold },
    { label: "AVG SCORE", value: avg, color: C.neutral },
    { label: "HIGHEST SCORE", value: highest, color: C.success },
    { label: "LOWEST SCORE", value: lowest, color: C.danger },
  ];

  const H = 52;
  const cellW = CONTENT_W / stats.length;

  borderedRR(doc, ML, y, CONTENT_W, H, 6, "#FFFFFF", C.dividerBright);

  stats.forEach((s, i) => {
    const cx = ML + i * cellW;

    if (i > 0) {
      doc
        .save()
        .moveTo(cx, y + 8)
        .lineTo(cx, y + H - 8)
        .strokeColor(C.divider)
        .lineWidth(0.5)
        .stroke()
        .restore();
    }

    doc
      .save()
      .font("Helvetica")
      .fontSize(6.5)
      .fillColor(C.textMuted)
      .text(s.label, cx, y + 9, {
        width: cellW,
        align: "center",
        characterSpacing: 0.7,
      })
      .restore();

    doc
      .save()
      .font("Helvetica-Bold")
      .fontSize(18)
      .fillColor(s.color)
      .text(String(s.value), cx, y + 22, {
        width: cellW,
        align: "center",
      })
      .restore();
  });

  return y + H + 12;
};

// ═══════════════════════════════════════════════════════════════
//  RECIPE CARD  — same layout, new colors
// ═══════════════════════════════════════════════════════════════
const drawRecipeCard = (doc, r, i, y, isBest, isWorst) => {
  const hasTag = isBest || isWorst;
  const cardH = hasTag ? 72 : 58;

  const bg = isBest ? C.successBg : isWorst ? C.dangerBg : C.cardBg;
  const accent = isBest ? C.success : isWorst ? C.danger : C.neutral;
  const border = isBest
    ? C.successBorder
    : isWorst
      ? C.dangerBorder
      : C.cardBorder;

  borderedRR(doc, ML, y, CONTENT_W, cardH, 7, bg, border);

  doc.save().roundedRect(ML, y, 4, cardH, 3).fill(accent).restore();

  // Index circle - top aligned and centered
  const rkx = ML + 22;
  const rky = y + 20;

  doc.save().circle(rkx, rky, 14).fill(accent).restore();

  doc
    .save()
    .font("Helvetica-Bold")
    .fontSize(i + 1 < 10 ? 12 : 10)
    .fillColor(C.textLight)
    .text(`${i + 1}`, rkx - 14, rky - 6.2, {
      width: 28,
      align: "center",
      lineBreak: false,
    })
    .restore();

  // Title position
  doc
    .save()
    .font("Helvetica-Bold")
    .fontSize(13)
    .fillColor(C.textPrimary)
    .text(r.recipeName, ML + 46, y + 11, {
      width: CONTENT_W - 190,
      lineBreak: false,
    })
    .restore();

  // Show tag only when best/worst
  if (hasTag) {
    const tag = isBest ? "BEST VERSION" : "NEEDS IMPROVEMENT";
    const tagC = isBest ? C.success : C.danger;
    const tagBg = isBest ? C.successBg : C.dangerBg;
    const tagW =
      doc.font("Helvetica-Bold").fontSize(6.5).widthOfString(tag) + 18;

    borderedRR(doc, ML + 46, y + 31, tagW, 15, 3, tagBg, tagC);

    doc
      .save()
      .font("Helvetica-Bold")
      .fontSize(6.5)
      .fillColor(tagC)
      .text(tag, ML + 55, y + 35, {
        lineBreak: false,
        characterSpacing: 0.5,
      })
      .restore();
  }

  const scoreStr =
    r.recipeScore != null ? Number(r.recipeScore).toFixed(2) : "—";
  const sx = PAGE_W - MR - 115;

  doc
    .save()
    .font("Helvetica")
    .fontSize(6.5)
    .fillColor(C.textMuted)
    .text("VERSION SCORE", sx, y + 10, {
      width: 100,
      align: "right",
      characterSpacing: 0.5,
      lineBreak: false,
    })
    .restore();

  doc
    .save()
    .font("Helvetica-Bold")
    .fontSize(hasTag ? 22 : 20)
    .fillColor(accent)
    .text(formatScore(r.recipeScore), sx, y + 22, {
      width: 100,
      align: "right",
      lineBreak: false,
    })
    .restore();

  // Bottom metadata line
  hRule(doc, y + cardH - 20, C.divider, ML + 4, CONTENT_W - 8);

  const rowY = y + cardH - 14;

  doc
    .save()
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor(C.textMuted)
    .text("Version:", ML + 46, rowY, { lineBreak: false })
    .restore();

  doc
    .save()
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .fillColor(C.textPrimary)
    .text(fmtReportV(r.version), ML + 88, rowY, { lineBreak: false })
    .restore();

  doc
    .save()
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor(C.textMuted)
    .text("Experiments:", ML + 165, rowY, { lineBreak: false })
    .restore();

  doc
    .save()
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .fillColor(C.textPrimary)
    .text(String(r.experimentCount || 0), ML + 222, rowY, { lineBreak: false })
    .restore();

  doc
    .save()
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor(C.textMuted)
    .text("Reviews:", ML + 270, rowY, { lineBreak: false })
    .restore();

  doc
    .save()
    .font("Helvetica-Bold")
    .fontSize(7.5)
    .fillColor(C.textPrimary)
    .text(String(r.reviewCount || 0), ML + 310, rowY, { lineBreak: false })
    .restore();

  return y + cardH + 10;
};

// ═══════════════════════════════════════════════════════════════
//  AI INSIGHTS PAGE  — same layout, new colors
// ═══════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════
//  AI INSIGHTS SECTION  — same layout, new colors
// ═══════════════════════════════════════════════════════════════
const drawInsightsSection = (doc, insights, y) => {
    if (y > PAGE_H - 120) {
        doc.addPage();
        paintPageBg(doc);
        y = 60;
    } else {
        y += 10;
    }

    y = sectionLabel(doc, "AI Portfolio Strategic Insights", y);
    y += 10;

    const entries = Object.entries(insights || {}).filter(([, v]) =>
        v != null && v !== "" &&
        !(Array.isArray(v) && v.length === 0) &&
        !(typeof v === "object" && !Array.isArray(v) && v !== null && Object.keys(v).length === 0)
    );

    if (!entries.length) {
        borderedRR(doc, ML, y, CONTENT_W, 56, 6, "#FFFFFF", C.dividerBright);
        doc.save()
            .font("Helvetica").fontSize(10).fillColor(C.textMuted)
            .text("No AI insights available for this portfolio.", ML + 20, y + 20)
            .restore();
        return y + 70;
    }

    entries.forEach(([key, value]) => {
        const body = Array.isArray(value)
            ? value.map((item, i) => `${i + 1}. ${item}`).join("\n")
            : typeof value === "object" && value !== null
                ? JSON.stringify(value, null, 2)
                : String(value);
        const textH = doc.font("Helvetica").fontSize(9)
            .heightOfString(body, { width: CONTENT_W - 28 });
        const blockH = textH + 32;

        if (y + 24 + blockH > PAGE_H - 40) {
            doc.addPage();
            paintPageBg(doc);
            y = 60;
        }

        // Key chip — gold
        const label = key.replace(/([A-Z])/g, " $1").trim().toUpperCase();
        // Fixed: wider chip and centered text for longer labels like GROWTH OPPORTUNITY
        const chipW = Math.max(80, doc.font("Helvetica-Bold").fontSize(7).widthOfString(label) + 24);
        fillRR(doc, ML, y, chipW, 18, 4, C.gold);
        doc.save()
            .font("Helvetica-Bold").fontSize(7).fillColor(C.headerBg)
            .text(label, ML, y + 5, { width: chipW, align: "center", lineBreak: false, characterSpacing: 0.5 })
            .restore();

        y += 22;

        // Value card — light blue with gold left bar
        borderedRR(doc, ML, y, CONTENT_W, blockH, 6, C.cardBg, C.cardBorder);
        doc.save().rect(ML, y, 3, blockH).fill(C.gold).restore();
        doc.save()
            .font("Helvetica").fontSize(9).fillColor(C.textSecondary)
            .text(body, ML + 14, y + 11, { width: CONTENT_W - 28 })
            .restore();

        y += blockH + 14;
    });

    return y;
};

// ═══════════════════════════════════════════════════════════════
//  STRATEGIC SUGGESTIONS — matched to screenshot
// ═══════════════════════════════════════════════════════════════

const drawSuggestionCard = (doc, s, y) => {
    const CARD_H = 120;
    const bg = "#E3F2FD"; // light blue background
    const accent = "#1B3A5C"; // navy/dark blue
    const border = "#90CAF9"; // light blue border

    borderedRR(doc, ML, y, CONTENT_W, CARD_H, 8, bg, border);

    // Left accent bar (navy)
    doc.save().roundedRect(ML, y, 6, CARD_H, 4).fill(accent).restore();

    // Version Chip (navy)
    const vLabel = `${s.recipeName || ""}  ${s.version || ""}`.trim() || "v1.1";
    const vW = doc.font("Helvetica-Bold").fontSize(9).widthOfString(vLabel) + 30;
    fillRR(doc, ML + 22, y + 14, vW, 20, 10, accent);
    doc.save()
        .font("Helvetica-Bold").fontSize(9).fillColor(C.textLight)
        .text(vLabel, ML + 22, y + 20, { width: vW, align: "center", lineBreak: false })
        .restore();

    // Score Chip (Gold/Brown)
    const scoreStr = s.score != null ? Number(s.score).toFixed(1) : "0.0";
    const scoreText = `${scoreStr}  /10`;
    const scW = doc.font("Helvetica-Bold").fontSize(12).widthOfString(scoreText) + 24;
    fillRR(doc, PAGE_W - MR - scW - 10, y + 14, scW, 30, 4, "#7A6020");
    doc.save()
        .font("Helvetica-Bold").fontSize(12).fillColor(C.textLight)
        .text(scoreStr, PAGE_W - MR - scW - 10, y + 23, { width: scW - 30, align: "right", lineBreak: false })
        .restore();
    doc.save()
        .font("Helvetica").fontSize(8).fillColor(C.textLight)
        .text("/10", PAGE_W - MR - 40, y + 25, { lineBreak: false })
        .restore();

    // Points
    const drawPoint = (py, label, text, color) => {
        const labelW = 75;
        // Chip
        fillRR(doc, ML + 22, py, labelW, 18, 9, color);
        doc.save()
            .font("Helvetica-Bold").fontSize(8).fillColor(C.textLight)
            .text(label.toUpperCase(), ML + 22, py + 5, { width: labelW, align: "center", lineBreak: false })
            .restore();

        // Dot
        doc.save().circle(ML + 22 + labelW + 15, py + 9, 3).fill(color).restore();

        // Text
        const tx = ML + 22 + labelW + 28;
        doc.save()
            .font("Helvetica").fontSize(9).fillColor(C.textPrimary)
            .text(text, tx, py + 4, { width: PAGE_W - MR - tx, lineBreak: false })
            .restore();
    };

    drawPoint(y + 44, "STRENGTH", s.strength || "—", "#2E7D32");
    drawPoint(y + 68, "CONCERN", s.concern || "—", "#C62828");
    drawPoint(y + 92, "ACTION", s.action || "—", "#2E6DA4");

    return y + CARD_H + 15;
};

const drawStrategicSuggestions = (doc, suggestions, y) => {
    if (!suggestions || !suggestions.length) return y;

    if (y > PAGE_H - 180) {
        doc.addPage();
        paintPageBg(doc);
        y = 60;
    } else {
        y += 20;
    }

    y = sectionLabel(doc, "AI Strategic Suggestions", y);
    y += 10;

    suggestions.forEach(s => {
        if (y + 130 > PAGE_H - 40) {
            doc.addPage();
            paintPageBg(doc);
            y = 60;
        }
        y = drawSuggestionCard(doc, s, y);
    });

    return y;
};

const drawGeneralRecommendations = (doc, recommendations, y) => {
  if (!recommendations || !recommendations.length) return y;

  if (y > BOTTOM_SAFE_Y - 120) {
    doc.addPage();
    paintPageBg(doc);
    y = CONTENT_TOP_Y;
  } else {
    y += 20;
  }

  y = sectionLabel(doc, "General Recommendations", y);
  y += 8;

  recommendations.slice(0, 5).forEach((item) => {
    const version = item.version
      ? fmtReportV(item.version)
      : "Version";
    const text =
      item.recommendation ||
      item.action ||
      item.text ||
      "Continue improving this version.";

    const body = `${version}: ${text}`;
    const textH = doc
      .font("Helvetica")
      .fontSize(9)
      .heightOfString(body, { width: CONTENT_W - 32 });

    const blockH = Math.max(42, textH + 24);

    if (y + blockH > BOTTOM_SAFE_Y) {
      doc.addPage();
      paintPageBg(doc);
      y = CONTENT_TOP_Y;
    }

    borderedRR(doc, ML, y, CONTENT_W, blockH, 6, "#FFFFFF", C.dividerBright);
    doc.save().rect(ML, y, 4, blockH).fill(C.gold).restore();

    doc
      .save()
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor(C.textPrimary)
      .text(version, ML + 16, y + 12, {
        width: 55,
        lineBreak: false,
      })
      .restore();

    doc
      .save()
      .font("Helvetica")
      .fontSize(9)
      .fillColor(C.textSecondary)
      .text(text, ML + 78, y + 12, {
        width: CONTENT_W - 100,
      })
      .restore();

    y += blockH + 10;
  });

  return y;
};

const generatePortfolioProfessionalReport = async (portfolioData, publicId) => {
    const tmpFile = path.join(os.tmpdir(), `${publicId}.pdf`);

    await new Promise((resolve, reject) => {
        const doc = new PDFDocument({
            size: "A4",
            margins: { top: 40, bottom: 5, left: ML, right: MR },
            bufferPages: true,
            autoFirstPage: false,
        });

        const ws = fs.createWriteStream(tmpFile);
        doc.pipe(ws);

        doc.addPage();

        const isRecipeVersionReport =
            portfolioData.recipeName && Array.isArray(portfolioData.versions);

        const reportTitle = isRecipeVersionReport
            ? `${portfolioData.recipeName} Version Intelligence`
            : portfolioData.portfolioName || "Recipe Portfolio Intelligence";

        const bestLabel = isRecipeVersionReport
            ? fmtReportV(portfolioData.bestVersion)
            : portfolioData.bestRecipe;

        const worstLabel = isRecipeVersionReport
            ? fmtReportV(portfolioData.worstVersion)
            : portfolioData.worstRecipe;

        const recipes = isRecipeVersionReport
            ? (portfolioData.versions || []).map((v) => ({
                recipeName: `${portfolioData.recipeName} ${fmtReportV(v.version)}`,
                recipeScore: getReportScore(v),
                version: v.version,
                experimentCount: v.experimentCount || 0,
                avgStarRating: v.avgStarRating,
                reviewCount: v.reviewCount || 0,
                strengths: v.strengths || [],
                weaknesses: v.weaknesses || [],
                recommendations: v.recommendations || [],
                marketReadiness: v.marketReadiness || "—",
                riskLevel: v.riskLevel || "—",
                consumerSentiment: v.consumerSentiment || {},
            }))
            : portfolioData.rankedRecipes || [];

           if (isRecipeVersionReport && recipes.length < 2) {
             const err = new Error(
               "Not enough data to generate report. At least 2 recipe versions are required.",
             );
             err.statusCode = 400;
             err.code = "NOT_ENOUGH_VERSION_DATA";
             throw err;
           }

        drawHeader(doc, reportTitle, bestLabel, worstLabel);
        drawHeaderBadges(doc, bestLabel, worstLabel);

        let y = 176;

        y = sectionLabel(
            doc,
            isRecipeVersionReport
                ? "Recipe Version Performance Ranking"
                : "Portfolio Performance Ranking",
            y
        );

        y += 8;

        y = drawStatsStrip(doc, recipes, y);

        recipes.forEach((r, i) => {
            if (y + CARD_H + 12 > BOTTOM_SAFE_Y) {
              doc.addPage();
              paintPageBg(doc);
              y = 60;
            }

            y = drawRecipeCard(
                doc,
                r,
                i,
                y,
                isRecipeVersionReport
                    ? sameVersion(r.version, portfolioData.bestVersion)
                    : r.recipeName === portfolioData.bestRecipe,
                isRecipeVersionReport
                    ? sameVersion(r.version, portfolioData.worstVersion)
                    : r.recipeName === portfolioData.worstRecipe
            );
        });

        if (isRecipeVersionReport) {
            const versionSuggestions = recipes.map((r) => ({
                recipeName: portfolioData.recipeName,
                version: fmtReportV(r.version),
                score: r.recipeScore,
                strength: r.strengths?.[0] || "No key strength available.",
                concern: r.weaknesses?.[0] || "No major concern available.",
                action: r.recommendations?.[0] || "Continue monitoring this version.",
            }));

          y = drawStrategicSuggestions(doc, versionSuggestions, y);

          const generalRecommendations = portfolioData.generalRecommendations
            ?.length
            ? portfolioData.generalRecommendations
            : recipes.map((r) => ({
                
                version: r.version,
                recommendation:
                  r.recommendations?.[0] ||
                  r.weaknesses?.[0] ||
                  "Improve texture, taste balance, and overall product consistency.",
              }));

          y = drawGeneralRecommendations(doc, generalRecommendations, y);

          y = drawInsightsSection(
            doc,
            {
              bestVersionReason: portfolioData.bestVersionReason,
              worstVersionReason: portfolioData.worstVersionReason,
              finalRecommendation: portfolioData.finalRecommendation,
              overallConfidenceScore: portfolioData.overallConfidenceScore,
              tasteTrend: portfolioData.overallInsights?.tasteTrend,
              keyImprovementAreas:
                portfolioData.overallInsights?.keyImprovementAreas,
              nextSteps: portfolioData.nextSteps,
            },
            y,
          );
        } else {
            y = drawStrategicSuggestions(doc, portfolioData.strategicSuggestions, y);
            y = drawInsightsSection(doc, portfolioData.aiInsights, y);
        }

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
        try {
            await fs.promises.unlink(tmpFile);
        } catch {}
    }
};
module.exports = { generatePortfolioProfessionalReport };
