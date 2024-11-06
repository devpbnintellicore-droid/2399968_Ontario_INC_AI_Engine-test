const Groq = require("groq-sdk");

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const analyzeVersionsAI = async (versionData) => {
  const completion = await groq.chat.completions.create({
    model: process.env.GROQ_MODEL || "openai/gpt-oss-20b",
    temperature: 0.3,
    response_format: { type: "json_object" },
    reasoning_effort: "low",
    reasoning_format: "hidden",
    messages: [
      {
        role: "system",
        content: "You are a professional food R&D AI. Return only valid JSON.",
      },
      {
        role: "user",
        content: `
Analyze recipe version performance data.

Return JSON format:

{
  "bestVersion": string,
  "worstVersion": string,
  "versionInsights": [
    {
      "version": string,
      "suggestion": string
    }
  ],
  "finalSummary": string
}

Version Performance Data:
${JSON.stringify(versionData)}
`,
      },
    ],
  });

  return JSON.parse(completion.choices[0].message.content);
};

module.exports = { analyzeVersionsAI };
