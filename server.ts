import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: "10mb" }));

// Lazy initialization of Gemini client
let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!geminiClient && process.env.GEMINI_API_KEY) {
    geminiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return geminiClient;
}

// 1. Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", service: "Kaushal Setu API" });
});

// Helper to call Gemini with automatic fallback between 3.8-flash and 3.1-flash-lite
async function callGeminiText(prompt: string, systemInstruction?: string, responseMimeType?: string) {
  const ai = getGeminiClient();
  if (!ai) return null;

  const models = ["gemini-3.8-flash", "gemini-3.1-flash-lite"];
  for (const model of models) {
    try {
      const config: any = {};
      if (systemInstruction) config.systemInstruction = systemInstruction;
      if (responseMimeType) config.responseMimeType = responseMimeType;

      const response = await ai.models.generateContent({
        model,
        contents: prompt,
        config: Object.keys(config).length > 0 ? config : undefined,
      });

      if (response && response.text) {
        return response.text;
      }
    } catch (err: any) {
      console.warn(`Gemini model ${model} attempt failed:`, err?.status || err?.message || err);
      // Continue to next model on 503 or transient failure
    }
  }
  return null;
}

// 2. AI Socratic Tutor Endpoint
app.post("/api/ai-tutor", async (req, res) => {
  try {
    const { topic, officerName, ministry, gapTopics, mode = "socratic", messages } = req.body;

    const userLastMessage = Array.isArray(messages) && messages.length > 0
      ? messages[messages.length - 1].content
      : "Hello, I am ready to start my lesson on " + (topic || "Survey Design") + ".";

    const historyContext = Array.isArray(messages) && messages.length > 1
      ? messages.slice(0, -1).map((m: any) => `${m.role === "user" ? "Officer" : "Tutor"}: ${m.content}`).join("\n")
      : "";

    const modeDirective = mode === "concept"
      ? "Mode: CONCEPT MASTERCLASS. Deliver a crisp, structured breakdown of the core official statistical concepts, exact mathematical formulas (e.g. inverse probability weights, stratification variance reduction), regulatory frameworks (Collection of Statistics Act / DPDP Act), and MoSPI implementation rules. Finish with a key takeaway bullet."
      : mode === "scenario"
      ? "Mode: FIELD SCENARIO DRILL. Provide a realistic, challenging field enumeration scenario or data compilation dilemma from actual Indian statistical operations (e.g. NSS 80th round, PLFS, HCES, ASI, CPI). Present 2-3 plausible operational courses of action and ask the officer to evaluate the correct protocol."
      : mode === "quiz"
      ? "Mode: INTERACTIVE KNOWLEDGE CHECK. Formulate a calibrated multiple-choice or short-answer checkpoint question testing practical application. After the officer answers, provide diagnostic feedback and score their response against FRAC standards."
      : "Mode: SOCRATIC DIALOGUE. Do not lecture in lengthy monolithic blocks. Guide the officer step-by-step with practical scenarios from Indian official surveys. Present concise insight, then ask an engaging follow-up checkpoint question to test their operational understanding.";

    const systemInstruction = `You are Shikshak Setu (शिक्षक सेतु), an elite AI Socratic Mentor and pedagogical tutor for the Indian Official Statistical System, operating under the Ministry of Statistics and Programme Implementation (MoSPI) and the National Statistical Systems Training Academy (NSSTA), aligned with Mission Karmayogi and the FRAC framework.
You are mentoring Officer ${officerName || "Cadre Officer"} (${ministry || "MoSPI"}).
The active training topic is "${topic || "Survey Design"}".
Identified priority gap topics for this officer: ${Array.isArray(gapTopics) && gapTopics.length > 0 ? gapTopics.join(", ") : "Survey Design, Sampling Multipliers"}.

Pedagogical Directives:
1. ${modeDirective}
2. Ground all discussions in authentic Indian official statistical realities:
   - Primary and secondary sampling units (Census FSUs, UFS blocks, hamlet-groups, SSUs)
   - Sampling weights and multipliers (inverse selection probability adjusted for non-response)
   - Survey instruments: PLFS (Periodic Labour Force Survey), HCES (Household Consumption Expenditure Survey), ASI (Annual Survey of Industries), CPI, WPI, NAS (National Accounts Statistics)
   - Legal frameworks: Collection of Statistics Act 2008, National Quality Assurance Framework (NQAF), DPDP Act 2023
3. Tone: Rigorous, encouraging, respectful of civil service protocol, and pedagogically sharp. Format cleanly using markdown bullet points and bold highlights. Keep responses concise (under 250 words) so the conversation remains energetic.`;

    const prompt = historyContext
      ? `Conversation History:\n${historyContext}\n\nOfficer's latest response/query:\n${userLastMessage}`
      : userLastMessage;

    const geminiReply = await callGeminiText(prompt, systemInstruction);
    if (geminiReply) {
      return res.json({ reply: geminiReply });
    }

    // Dynamic fallback responses if offline or API unreachable
    const lowerMsg = userLastMessage.toLowerCase();
    let fallbackReply = "";

    if (lowerMsg.includes("multiplier") || lowerMsg.includes("weight") || topic.includes("Multipliers") || topic.includes("ST-02")) {
      fallbackReply = `Welcome Officer ${officerName || ""}. Let us analyze **Sampling Multipliers** in Indian official surveys:\n\n• **Core Principle:** The multiplier $W_i$ represents the inverse probability of selection: $W_i = 1 / P_i$.\n• **In Two-Stage Stratified Sampling (PLFS/HCES):** $P_i = P_{fsu} \\times P_{ssu|fsu}$. If an FSU has selection probability $1/K$ and 8 households are drawn out of $H$ listed households, the household base multiplier is $K \\times (H / 8)$.\n• **Non-Response Adjustment:** If only $m$ of the 8 households are successfully canvassed, the adjusted multiplier scales by $(8 / m)$.\n\n**Socratic Drill:** In a rural stratum, if a large village was divided into 3 equal hamlet-groups and 1 hamlet-group was selected at random, how does this intermediate stage affect the final inflation factor for household consumption totals?`;
    } else if (lowerMsg.includes("frame") || lowerMsg.includes("hamlet") || topic.includes("Survey Design") || topic.includes("ST-01")) {
      fallbackReply = `Welcome Officer ${officerName || ""}. In NSS & PLFS field operations, maintaining **Frame Integrity** is paramount:\n\n• **Rural Frame:** 2011 Population Census village directory.\n• **Urban Frame:** Urban Frame Survey (UFS) blocks, updated quinquennially.\n• **Hamlet-Group Formation:** Mandatory when an FSU's population exceeds 1,200 (or ~300 households). The FSU is partitioned into equal segments with unambiguous physical boundaries.\n\n**Operational Drill:** Suppose an urban UFS block in your jurisdiction has grown rapidly to 4,000 residents due to new high-rise apartments. What is the standard MoSPI FOD protocol for carving sub-blocks while preserving equal selection probabilities?`;
    } else if (lowerMsg.includes("cpi") || lowerMsg.includes("index") || topic.includes("Index") || topic.includes("ST-03")) {
      fallbackReply = `Welcome Officer ${officerName || ""}. Let us examine **Index Number Compilation (CPI / IIP)**:\n\n• **Elementary Aggregates:** MoSPI compiles price relatives at the item/market level using the **Jevons Index** (geometric mean) to avoid arithmetic substitution bias.\n• **Higher-Level Aggregation:** Upper-level indices use the **Modified Laspeyres** formulation based on base-year weighting diagrams from HCES.\n• **Weight Disparity:** Food & Beverages carries a ~45.86% weight in All-India CPI-Combined, making headline inflation highly sensitive to seasonal agricultural price volatility.\n\n**Checkpoint Question:** If price quotations for a specific manufactured item are missing for 3 consecutive months in a sample market, what is the NQAF imputation guideline before declaring the item permanently unavailable?`;
    } else if (lowerMsg.includes("national account") || lowerMsg.includes("gdp") || lowerMsg.includes("gva") || topic.includes("National Accounts") || topic.includes("ST-04")) {
      fallbackReply = `Welcome Officer ${officerName || ""}. In **National Accounts Statistics (NAS 2011-12 Series)**:\n\n• **Identity:** $\\text{GDP at Market Prices} = \\text{GVA at Basic Prices} + \\text{Product Taxes} - \\text{Product Subsidies}$.\n• **Basic Prices:** Output value evaluated at the production boundary, including production taxes (e.g. land revenues, stamp duties) less production subsidies, but excluding product taxes (e.g. GST, excise duties).\n• **MCA-21 Database:** Used for the organized corporate sector, replacing traditional RBI sample extrapolations.\n\n**Scenario Drill:** During a year of significant GST rate rationalization, how would you verify whether observed quarterly GDP divergence from GVA reflects real economic expansion or fiscal net product tax changes?`;
    } else if (lowerMsg.includes("dpdp") || lowerMsg.includes("act") || lowerMsg.includes("confidential") || topic.includes("DPDP") || topic.includes("DG-01") || topic.includes("DG-02")) {
      fallbackReply = `Welcome Officer. In official data governance under the **Collection of Statistics Act, 2008** and **DPDP Act, 2023**:\n\n• **Statutory Privilege:** Survey informant data collected under the Collection of Statistics Act is strictly confidential and cannot be disclosed in court or shared with taxation/enforcement agencies.\n• **Anonymization Mandate:** Micro-data released for academic research must undergo statistical disclosure control (SDC) — recoding geographic codes below district level, top-coding high incomes, and swapping sensitive identifiers.\n\n**Socratic Question:** Under Section 9 of the Collection of Statistics Act, if a commercial auditing body demands raw enterprise tax records collected during the Annual Survey of Industries (ASI), what is your statutory obligation as an officer?`;
    } else {
      fallbackReply = `Welcome Officer ${officerName || ""}. Let us explore **${topic}** within the Indian Official Statistical System.\n\n• **Methodological Foundation:** Official statistics compiled under MoSPI adhere to the UN Fundamental Principles of Official Statistics and India's National Quality Assurance Framework (NQAF).\n• **Operational Focus:** Whether dealing with field enumeration, sampling multipliers, or macro aggregation, every statistical output must balance timeliness, precision, and respondent burden.\n\n**Pedagogical Drill:** In your current posting at ${ministry || "MoSPI"}, what is the primary data source or field challenge you encounter relating to **${topic}**? Let us dissect it step-by-step!`;
    }

    return res.json({ reply: fallbackReply });
  } catch (error: any) {
    console.error("Error in /api/ai-tutor:", error);
    res.status(200).json({
      reply: "Let us continue our Socratic inquiry into this competency area. Could you elaborate on the specific survey or estimation challenge you are encountering in your division?",
    });
  }
});

// 3. Prashna Question Generation Endpoint
app.post("/api/generate-questions", async (req, res) => {
  try {
    const { material, count = 5 } = req.body;
    if (material) {
      const prompt = `You are the Prashna Item Foundry engine for NSSTA and MoSPI.
Analyze the following official training material / ministerial guideline:
"""
${material.slice(0, 6000)}
"""

Generate ${count} calibrated, multiple-choice diagnostic assessment questions aligned with Bloom's Taxonomy (Analysis / Evaluation / Application).
Each question must test practical application of Indian official statistical standards (Survey Design, Statistical Methods, Data Interpretation, Data Visualization, or Official Statistics Awareness).

You MUST respond strictly with a valid JSON object matching this schema:
{
  "questions": [
    {
      "question": "Question stem here",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctIndex": 0,
      "topic": "Survey Design",
      "explanation": "Detailed pedagogical explanation referencing the material."
    }
  ]
}`;

      const text = await callGeminiText(prompt, undefined, "application/json");
      if (text) {
        try {
          const parsed = JSON.parse(text);
          if (parsed && Array.isArray(parsed.questions)) {
            return res.json({ questions: parsed.questions });
          }
        } catch (e) {
          console.error("Failed to parse Gemini JSON output:", e);
        }
      }
    }

    // Default vetted questions fallback
    const fallbackQuestions = [
      {
        question: "In NSS stratified two-stage sampling, what is the primary objective of creating hamlet-groups/sub-blocks in large First Stage Units (FSUs)?",
        options: [
          "To reduce the field listing workload while maintaining unbiased selection probability",
          "To convert the survey into a non-probability convenience sample",
          "To artificially inflate the sample size of urban enterprises",
          "To eliminate the need for survey sampling weights"
        ],
        correctIndex: 0,
        topic: "Survey Design",
        explanation: "In large FSUs (population exceeding designated thresholds), hamlet-group formation controls listing costs while preserving known non-zero selection probabilities for all households."
      },
      {
        question: "Under the Collection of Statistics Act, 2008, how must unit-level data collected from establishments be handled regarding external administrative agencies?",
        options: [
          "Establishment identifiers cannot be shared for punitive or taxation purposes without express legislative authorization",
          "All unit records must be immediately transferred to tax collection agencies",
          "Names and PAN numbers must be published open-source on government websites",
          "Data cannot be used for any statistical aggregation"
        ],
        correctIndex: 0,
        topic: "Official Statistics Awareness",
        explanation: "The Collection of Statistics Act guarantees statutory confidentiality: survey data collected strictly for statistical purposes cannot be used as legal evidence against an informant or shared with revenue/tax departments."
      },
      {
        question: "When computing headline Consumer Price Index (CPI-C) inflation, which formula is used for elementary aggregate index compilation at the item level across states?",
        options: [
          "Jevons Index (geometric mean of price relatives) or Dutot Index depending on market homogeneity",
          "Simple sum of maximum prices recorded across all districts",
          "Weighted median of international import tariff values",
          "Unweighted arithmetic mean of producer ex-factory prices"
        ],
        correctIndex: 0,
        topic: "Statistical Methods",
        explanation: "International statistical standards (ILO/UN) and MoSPI CPI methodology prescribe the Jevons index (geometric mean) to mitigate substitution bias at the elementary aggregate level."
      },
      {
        question: "Which data visualization principle is mandated under the National Quality Assurance Framework (NQAF) for reporting survey estimates with high sampling errors?",
        options: [
          "Estimates with Relative Standard Error (RSE) > 30% must be flagged with an asterisk or suppressed to prevent misleading policy inference",
          "Sampling error must be hidden to present decisive administrative reports",
          "Bar charts must always start at the sample mean rather than zero",
          "3D pie charts must be used to highlight significant percentage shares"
        ],
        correctIndex: 0,
        topic: "Data Visualization",
        explanation: "NQAF guidelines mandate that estimates with high coefficient of variation (RSE exceeding 20-30%) must be flagged as unreliable or suppressed from formal publication."
      },
      {
        question: "In National Accounts Statistics (NAS), what is the key conceptual difference between Gross Value Added (GVA) at basic prices and Gross Domestic Product (GDP) at market prices?",
        options: [
          "GDP at market prices includes Net Product Taxes (Product Taxes minus Product Subsidies) added to GVA at basic prices",
          "GDP only counts agricultural output whereas GVA counts factory output",
          "GVA excludes capital depreciation while GDP includes foreign loans",
          "GVA is measured in US dollars while GDP is measured in Indian Rupees"
        ],
        correctIndex: 0,
        topic: "Data Interpretation",
        explanation: "By national accounting identity: GDP at market prices = GVA at basic prices + (Product Taxes - Product Subsidies)."
      }
    ];

    return res.json({ questions: fallbackQuestions });
  } catch (error: any) {
    console.error("Error in /api/generate-questions:", error);
    return res.status(500).json({ error: "Failed to generate questions" });
  }
});

// ==========================================
// iGOT KARMAYOGI DATABASE & TELEMETRY ENGINE
// ==========================================
interface IgotCourse {
  id: string;
  doId?: string;
  title: string;
  titleHi: string;
  provider: string;
  modality: string;
  minutes: number;
  karmaPoints: number;
  rating: number;
  enrolledCount: number;
  summary: string;
  competencies: string[];
}

interface IgotEnrolment {
  id: string;
  officerId: string;
  courseId: string;
  enrolledAt: string;
  status: "in-progress" | "completed";
  progress: number;
  completedAt?: string;
  score?: number;
  certificateId?: string;
}

interface XapiStatement {
  id: string;
  timestamp: string;
  actor: { name: string; mbox?: string; officerId: string };
  verb: { id: string; display: string };
  object: { id: string; name: string; type: string };
  result?: { score?: number; success?: boolean; completion?: boolean };
}

// In-memory iGOT Karmayogi persistent store for active session
const igotDb = {
  courses: [
    {
      id: "C-101",
      doId: "do_3138812901",
      title: "Multistage Stratified Sampling in Practice (NSS 80th Round)",
      titleHi: "बहु-स्तरीय स्तरीकृत प्रतिचयन कार्यप्रणाली",
      provider: "NSSTA",
      modality: "Blended",
      minutes: 360,
      karmaPoints: 45,
      rating: 4.8,
      enrolledCount: 1420,
      competencies: ["ST-01", "ST-06", "BE-03"],
      summary: "Comprehensive training on rural/urban FSU selection, multiplier calculation, and circular systematic sampling protocols."
    },
    {
      id: "C-102",
      doId: "do_3138812902",
      title: "National Accounts Statistics: SUT & GVA Compilation",
      titleHi: "राष्ट्रीय लेखा सांख्यिकी एवं आपूर्ति-उपयोग तालिकाएं",
      provider: "NSSTA",
      modality: "Blended",
      minutes: 480,
      karmaPoints: 60,
      rating: 4.7,
      enrolledCount: 980,
      competencies: ["ST-02", "ST-06"],
      summary: "SNA 2008 framework, sequence of accounts, FISIM allocation, and supply-use tables balancing."
    },
    {
      id: "C-103",
      doId: "do_3138812903",
      title: "Consumer Price Index (CPI) Methodology & Hedonic Quality Adjustments",
      titleHi: "उपभोक्ता मूल्य सूचकांक (सीपीआई) कार्यप्रणाली",
      provider: "NSSTA",
      modality: "Self-paced",
      minutes: 180,
      karmaPoints: 25,
      rating: 4.6,
      enrolledCount: 2150,
      competencies: ["ST-03"],
      summary: "Laspeyres price index formula, elementary aggregate formulas (Jevons/Dutot), and missing quote imputation."
    },
    {
      id: "C-104",
      doId: "do_3138812904",
      title: "ASI Web Scrutiny and Financial Statement Reconciliation",
      titleHi: "उद्योगों के वार्षिक सर्वेक्षण की संवीक्षा",
      provider: "FOD Training Wing",
      modality: "Blended",
      minutes: 300,
      karmaPoints: 40,
      rating: 4.5,
      enrolledCount: 1670,
      competencies: ["ST-04", "TE-05"],
      summary: "Auditing balance sheet entries against Schedule A/B/C/D of the Annual Survey of Industries return."
    },
    {
      id: "C-105",
      doId: "do_3138812905",
      title: "CAPI Device Data Validation & Field Edit Rules",
      titleHi: "सीएपीआई डेटा सत्यापन एवं क्षेत्रीय संपादन नियम",
      provider: "Kaushal Setu",
      modality: "Micro-learning",
      minutes: 120,
      karmaPoints: 20,
      rating: 4.9,
      enrolledCount: 3840,
      competencies: ["ST-05", "TE-01", "DG-04"],
      summary: "Live range checks, soft vs hard constraints, and casualty household substitution protocol."
    },
    {
      id: "C-201",
      doId: "do_3138812906",
      title: "R for Official Statistics: Survey Data Weighting & Complex Variances",
      titleHi: "आर प्रोग्रामिंग: सांख्यिकी भार एवं प्रसरण",
      provider: "Wadhwani Centre",
      modality: "Self-paced",
      minutes: 420,
      karmaPoints: 50,
      rating: 4.8,
      enrolledCount: 2310,
      competencies: ["TE-02", "ST-06"],
      summary: "Using the survey library in R for Taylor-series linearization, replicate weights, and calibrate()."
    },
    {
      id: "C-301",
      doId: "do_3138812907",
      title: "DPDP Act 2023: Statistical Processing & Data De-identification",
      titleHi: "डीपीडीपी अधिनियम 2023: सांख्यिकी डेटा संरक्षण",
      provider: "LBSNAA / Karmayogi",
      modality: "Self-paced",
      minutes: 150,
      karmaPoints: 25,
      rating: 4.7,
      enrolledCount: 4120,
      competencies: ["DG-01", "DG-03"],
      summary: "Section 17 statistical exemption, k-anonymity, l-diversity, and secure multi-party research dissemination."
    }
  ] as IgotCourse[],
  enrolments: [
    {
      id: "ENR-901",
      officerId: "OFF-0001",
      courseId: "C-101",
      enrolledAt: "2026-08-15T09:30:00Z",
      status: "completed",
      progress: 100,
      completedAt: "2026-08-28T14:15:00Z",
      score: 92,
      certificateId: "CERT-IGOT-2026-ST01-9482"
    },
    {
      id: "ENR-902",
      officerId: "OFF-0001",
      courseId: "C-301",
      enrolledAt: "2026-09-01T11:00:00Z",
      status: "in-progress",
      progress: 65
    }
  ] as IgotEnrolment[],
  xapiStatements: [
    {
      id: "stmt-001",
      timestamp: new Date().toISOString(),
      actor: { name: "Dr. Rajesh Sharma, ISS", officerId: "OFF-0001" },
      verb: { id: "http://adlnet.gov/expapi/verbs/completed", display: "completed_assessment" },
      object: { id: "PARIKSHAN-CAT-DIAGNOSTIC", name: "Parikshan Adaptive Diagnostic Check", type: "assessment" },
      result: { score: 84, success: true }
    },
    {
      id: "stmt-002",
      timestamp: new Date(Date.now() - 3600000).toISOString(),
      actor: { name: "Dr. Rajesh Sharma, ISS", officerId: "OFF-0001" },
      verb: { id: "http://adlnet.gov/expapi/verbs/enrolled", display: "enrolled_course" },
      object: { id: "C-301", name: "DPDP Act 2023: Statistical Processing", type: "course" }
    }
  ] as XapiStatement[],
  officerKarmaBalances: {
    "OFF-0001": 345,
    "OFF-0002": 280,
    "OFF-0003": 195,
    "OFF-0004": 150
  } as Record<string, number>
};

// 1. Get all iGOT courses
app.get("/api/igot/courses", (req, res) => {
  res.json({
    status: "ok",
    source: "iGOT Karmayogi National Registry v2.4",
    courses: igotDb.courses
  });
});

// 2. Enrol officer in iGOT course
app.post("/api/igot/enrol", (req, res) => {
  try {
    const { officerId, courseId, officerName } = req.body;
    if (!officerId || !courseId) {
      return res.status(400).json({ error: "officerId and courseId are required" });
    }

    const course = igotDb.courses.find(c => c.id === courseId);
    if (!course) {
      return res.status(404).json({ error: `Course ${courseId} not found in iGOT repository` });
    }

    // Check if already enrolled
    const existing = igotDb.enrolments.find(e => e.officerId === officerId && e.courseId === courseId);
    if (existing) {
      return res.json({
        status: "already_enrolled",
        message: `Officer already enrolled in ${course.title}`,
        enrolment: existing,
        course
      });
    }

    const newEnrolment: IgotEnrolment = {
      id: `ENR-${Date.now().toString().slice(-6)}`,
      officerId,
      courseId,
      enrolledAt: new Date().toISOString(),
      status: "in-progress",
      progress: 5
    };

    igotDb.enrolments.push(newEnrolment);
    course.enrolledCount += 1;

    // Credit initial Karma Points for enrolling
    const kpAward = Math.round(course.karmaPoints * 0.2) || 10;
    igotDb.officerKarmaBalances[officerId] = (igotDb.officerKarmaBalances[officerId] || 100) + kpAward;

    // Record xAPI telemetry statement
    const xapiStmt: XapiStatement = {
      id: `xapi-${Date.now().toString().slice(-6)}`,
      timestamp: new Date().toISOString(),
      actor: {
        name: officerName || `Officer ${officerId}`,
        officerId
      },
      verb: {
        id: "http://adlnet.gov/expapi/verbs/enrolled",
        display: "enrolled_on_igot"
      },
      object: {
        id: course.id,
        name: course.title,
        type: "course"
      },
      result: {
        success: true
      }
    };
    igotDb.xapiStatements.unshift(xapiStmt);

    res.json({
      status: "success",
      message: `Enrolled successfully in "${course.title}" on iGOT Karmayogi`,
      enrolment: newEnrolment,
      course,
      karmaPointsAwarded: kpAward,
      newKarmaBalance: igotDb.officerKarmaBalances[officerId]
    });
  } catch (error: any) {
    console.error("Error in /api/igot/enrol:", error);
    res.status(500).json({ error: "Failed to enrol in iGOT course" });
  }
});

// 3. Update course progress & award completion
app.post("/api/igot/courses/:id/progress", (req, res) => {
  try {
    const courseId = req.params.id;
    const { officerId, progress, officerName } = req.body;
    const course = igotDb.courses.find(c => c.id === courseId);
    if (!course) return res.status(404).json({ error: "Course not found" });

    let enrolment = igotDb.enrolments.find(e => e.officerId === officerId && e.courseId === courseId);
    if (!enrolment) {
      enrolment = {
        id: `ENR-${Date.now().toString().slice(-6)}`,
        officerId,
        courseId,
        enrolledAt: new Date().toISOString(),
        status: "in-progress",
        progress: 0
      };
      igotDb.enrolments.push(enrolment);
    }

    enrolment.progress = Math.min(100, Math.max(enrolment.progress, progress));

    let certificateIssued: string | null = null;
    let karmaPointsAwarded = 0;

    if (enrolment.progress >= 100 && enrolment.status !== "completed") {
      enrolment.status = "completed";
      enrolment.completedAt = new Date().toISOString();
      certificateIssued = `CERT-MOSPI-${courseId}-${Date.now().toString().slice(-5)}`;
      enrolment.certificateId = certificateIssued;
      karmaPointsAwarded = course.karmaPoints;
      igotDb.officerKarmaBalances[officerId] = (igotDb.officerKarmaBalances[officerId] || 100) + karmaPointsAwarded;

      // xAPI statement for completion
      igotDb.xapiStatements.unshift({
        id: `xapi-${Date.now().toString().slice(-6)}`,
        timestamp: new Date().toISOString(),
        actor: { name: officerName || `Officer ${officerId}`, officerId },
        verb: { id: "http://adlnet.gov/expapi/verbs/completed", display: "completed_course" },
        object: { id: course.id, name: course.title, type: "course" },
        result: { completion: true, success: true }
      });
    }

    res.json({
      status: "success",
      enrolment,
      certificateIssued,
      karmaPointsAwarded,
      newKarmaBalance: igotDb.officerKarmaBalances[officerId]
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to update progress" });
  }
});

// 4. Get officer enrolments & digital passport
app.get("/api/igot/officer/:id", (req, res) => {
  const officerId = req.params.id;
  const officerEnrolments = igotDb.enrolments
    .filter(e => e.officerId === officerId)
    .map(e => {
      const course = igotDb.courses.find(c => c.id === e.courseId);
      return {
        ...e,
        course
      };
    });

  const officerStatements = igotDb.xapiStatements.filter(s => s.actor.officerId === officerId);

  res.json({
    officerId,
    karmaBalance: igotDb.officerKarmaBalances[officerId] || 120,
    enrolments: officerEnrolments,
    recentXapiStatements: officerStatements,
    syncStatus: {
      lrsOnline: true,
      handshakeActive: true,
      lastSyncTime: new Date().toISOString()
    }
  });
});

// 5. Two-way sync trigger
app.post("/api/igot/sync", (req, res) => {
  const { officerId, officerName, scores } = req.body;
  const syncId = `SYNC-MOSPI-IGOT-${Date.now().toString().slice(-6)}`;
  
  // Record two-way sync event
  igotDb.xapiStatements.unshift({
    id: `xapi-${Date.now().toString().slice(-6)}`,
    timestamp: new Date().toISOString(),
    actor: { name: officerName || `Officer ${officerId}`, officerId },
    verb: { id: "http://adlnet.gov/expapi/verbs/interacted", display: "synced_two_way_frac" },
    object: { id: "FRAC-2.4-GATEWAY", name: "MoSPI Kaushal Setu Competency Matrix", type: "system" },
    result: { success: true }
  });

  res.json({
    status: "ok",
    syncId,
    timestamp: new Date().toISOString(),
    message: "Two-way synchronisation confirmed between MoSPI and iGOT Karmayogi hub",
    recordsSynced: {
      competencies: scores ? Object.keys(scores).length : 24,
      telemetryBatchSize: igotDb.xapiStatements.length,
      handshakeLatencyMs: 38
    }
  });
});

// 6. Cadre Intervention Policy Simulator API
app.post("/api/cadre/simulate", (req, res) => {
  try {
    const {
      strategy = "nssta_blended",
      trainingHours = 15,
      targetZone = "all",
      targetCadre = "all",
      cohortCoveragePct = 50,
      budgetLakhs = 25
    } = req.body;

    // Mathematical simulation of cadre readiness uplift based on training hours & coverage
    const baseReadiness = 80.4;
    const hourFactor = Math.min(1.0, trainingHours / 30);
    const coverageFactor = cohortCoveragePct / 100;
    
    let strategyMultiplier = 1.0;
    if (strategy === "nssta_blended") strategyMultiplier = 1.25;
    else if (strategy === "digital_sprint") strategyMultiplier = 0.95;
    else if (strategy === "field_mentorship") strategyMultiplier = 1.35;
    else if (strategy === "pre_survey_bootcamp") strategyMultiplier = 1.45;

    const uplift = Math.round((7.8 * hourFactor * coverageFactor * strategyMultiplier + 2.5) * 10) / 10;
    const projectedReadiness = Math.min(96.5, Math.round((baseReadiness + uplift) * 10) / 10);

    const initialAtRiskOfficers = 82;
    const remediatedOfficers = Math.round(initialAtRiskOfficers * coverageFactor * (0.6 + 0.35 * hourFactor));
    const finalAtRiskOfficers = Math.max(4, initialAtRiskOfficers - remediatedOfficers);

    const costPerOfficer = budgetLakhs > 0 && remediatedOfficers > 0 
      ? Math.round((budgetLakhs * 100000) / remediatedOfficers)
      : 3200;

    const surveyRisksBefore = [
      { id: "SR-PLFS", name: "Periodic Labour Force Survey (PLFS)", risk: "High", atRiskOfficers: 28, projectedRisk: uplift > 8 ? "Safe" : "Moderate" },
      { id: "SR-HCES", name: "Household Consumption Expenditure Survey (HCES)", risk: "High", atRiskOfficers: 34, projectedRisk: uplift > 7 ? "Safe" : "Moderate" },
      { id: "SR-ASI", name: "Annual Survey of Industries (ASI)", risk: "Moderate", atRiskOfficers: 12, projectedRisk: "Safe" },
      { id: "SR-CPI", name: "Consumer Price Index (CPI Market Price Audits)", risk: "Moderate", atRiskOfficers: 8, projectedRisk: "Safe" }
    ];

    res.json({
      status: "success",
      strategy,
      inputs: { trainingHours, targetZone, targetCadre, cohortCoveragePct, budgetLakhs },
      projections: {
        baseReadiness,
        projectedReadiness,
        upliftPercentage: uplift,
        initialAtRiskOfficers,
        finalAtRiskOfficers,
        remediatedOfficers,
        costPerOfficerRupees: costPerOfficer,
        estimatedFieldResurveySavingsLakhs: Math.round(remediatedOfficers * 0.85 * 10) / 10,
        surveyRisks: surveyRisksBefore
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to simulate cadre intervention" });
  }
});

// Vite middleware & SPA fallback
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Kaushal Setu server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
