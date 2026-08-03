const express = require('express');
const multer = require('multer');
const cors = require('cors');
const axios = require('axios');
const pdfParse = require('pdf-parse');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 4444;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

/* =========================
   Multer
========================= */
const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/png', 'image/jpeg', 'application/pdf'];
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error('الرجاء تحميل ملف صورة (PNG أو JPEG) أو PDF فقط.'));
    }
    cb(null, true);
  }
});

/* =========================
   Env
========================= */
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) {
  console.error('[ERROR] OPENROUTER_API_KEY غير موجود في ملف .env');
  process.exit(1);
}

const DEFAULT_TEXT_MODEL =
  process.env.OPENROUTER_TEXT_MODEL || 'google/gemini-2.5-flash';

const DEFAULT_VISION_MODEL =
  process.env.OPENROUTER_VISION_MODEL || 'google/gemini-2.5-flash-lite';

const PDF_ENGINE =
  process.env.OPENROUTER_PDF_ENGINE || 'cloudflare-ai';

const ENABLE_MODEL_FALLBACKS =
  String(process.env.ENABLE_MODEL_FALLBACKS || 'true').toLowerCase() === 'true';

/* =========================
   Keys / Prompt Rules
========================= */
const ALLOWED_KEYS = [
  'Name',
  'Religion',
  'Passportnumber',
  'ExperienceYears',
  'maritalstatus',
  'Experience',
  'dateofbirth',
  'Nationality',
  'job',
  'Education',
  'EnglishLanguageLevel',
  'ArabicLanguageLeveL',
  'SewingLevel',
  'weight',
  'height',
  'childrencount',
  'CleaningLevel',
  'CookingLevel',
  'WashingLevel',
  'IroningLevel',
  'ChildcareLevel',
  'ElderlycareLevel',
  'phone',
  'age',
  'officeName',
  'experienceType',
  'PassportStart',
  'PassportEnd',
  'Salary',
  'BabySitterLevel'
];

const PROMPT_RULES = `
⚠️ STRICT RULES:
- Return ONLY the keys listed below.
- Do NOT add extra keys.
- Do NOT change key names.
- All values must be strings.
- If a value is missing, return null.
- Dates must be ISO format YYYY-MM-DD.
- JSON only, no text, no markdown.
- Use EXACTLY the values from the allowed lists below - do NOT translate or modify them.

🧾 REQUIRED KEYS (ALL MUST EXIST):
{
  "Name": null,
  "Religion": null,
  "Passportnumber": null,
  "ExperienceYears": null,
  "maritalstatus": null,
  "Experience": null,
  "dateofbirth": null,
  "Nationality": null,
  "job": null,
  "Education": null,
  "EnglishLanguageLevel": null,
  "ArabicLanguageLeveL": null,
  "SewingLevel": null,
  "weight": null,
  "height": null,
  "childrencount": null,
  "CleaningLevel": null,
  "CookingLevel": null,
  "WashingLevel": null,
  "IroningLevel": null,
  "ChildcareLevel": null,
  "ElderlycareLevel": null,
  "phone": null,
  "age": null,
  "officeName": null,
  "experienceType": null,
  "PassportStart": null,
  "PassportEnd": null,
  "Salary": null,
  "BabySitterLevel": null
}

🎯 ALLOWED VALUES (USE EXACTLY AS SHOWN - DO NOT MODIFY):

📚 Education (Education field):
- "Diploma - دبلوم"
- "High school - ثانوي"
- "Illiterate - غير متعلم"
- "Literate - القراءة والكتابة"
- "Primary school - ابتدائي"
- "University level - جامعي"

💼 Experience (Experience field):
- "Novice | مدربة بدون خبرة"
- "Intermediate | مدربة بخبرة متوسطة"
- "Well-experienced | خبرة جيدة"
- "Expert | خبرة ممتازة"

📅 ExperienceYears (ExperienceYears field - based on Experience):
- If Experience is "Novice | مدربة بدون خبرة" → "مدربة-Training"
- If Experience is "Intermediate | مدربة بخبرة متوسطة" → "1-2 Years - سنوات"
- If Experience is "Well-experienced | خبرة جيدة" → "3-4 Years - سنوات"
- If Experience is "Expert | خبرة ممتازة" → "5 and More - وأكثر"

👤 Marital Status (maritalstatus field):
- "Single - عازبة"
- "Married - متزوجة"
- "Divorced - مطلقة"

🕌 Religion (Religion field):
- "Islam - الإسلام"
- "Non-Muslim - غير مسلم"

🌍 Language Levels (EnglishLanguageLevel, ArabicLanguageLeveL fields):
- "Expert - ممتاز"
- "Advanced - جيد جداً"
- "Intermediate - جيد"
- "Beginner - مبتدأ"
- "Non - لا تجيد"

🛠️ Skills Levels (CookingLevel, WashingLevel, IroningLevel, CleaningLevel, SewingLevel, ChildcareLevel, ElderlycareLevel, BabySitterLevel):
- "Expert - ممتاز"
- "Advanced - جيد جداً"
- "Intermediate - جيد"
- "Beginner - مبتدأ"
- "Non - لا تجيد"

🌐 Nationality (Nationality field):
- Must match exactly from database format (e.g., "Uganda - أوغندا", "Ethiopia - إثيوبيا", "Kenya - كينيا", "Bengladesh - بنغلادش", "Philippines - الفلبين")
- Keep the exact format as stored in the database
`;

/* =========================
   Tickets (tickets_details) extraction
========================= */
const TICKETS_DETAILS_KEYS = [
  'ticketFile',
  'reference_id',
  'airlines',
  'flight_number',
  'departure_date',
  'departure_time',
  'arrival_date',
  'arrival_time',
  'departure_airport',
  'arrival_airport'
];

const PROMPT_RULES_TICKETS = `
⚠️ STRICT RULES:
- Return ONLY a valid flat JSON object with EXACTLY the keys listed below.
- Do NOT add extra keys. Do NOT rename keys.
- If a value is missing on the ticket, use null.
- JSON only, no markdown, no commentary.
- departure_date and arrival_date: ISO date YYYY-MM-DD when known, else null.
- departure_time and arrival_time: string as on ticket (e.g. "14:30" or "2:30 PM"), else null.
- reference_id: PNR / booking reference / ticket number if visible.
- departure_airport and arrival_airport: IATA codes (3 letters) when possible, else full name.
- CRITICAL FOR TRANSIT/LAYOVERS: If the itinerary has multiple flights, extract the full journey. 
  - departure_airport MUST be the starting airport of the VERY FIRST flight.
  - arrival_airport MUST be the final destination of the VERY LAST flight (ignore any transit/layover airports).
  - arrival_date and arrival_time MUST be the time of arrival at the FINAL destination.

🧾 REQUIRED KEYS (ALL MUST EXIST):
{
  "ticketFile": null,
  "reference_id": null,
  "airlines": null,
  "flight_number": null,
  "departure_date": null,
  "departure_time": null,
  "arrival_date": null,
  "arrival_time": null,
  "departure_airport": null,
  "arrival_airport": null
}
`;

/* =========================
   Car Inspection extraction (Completely separated)
========================= */
const CAR_INSPECTION_KEYS = [
  'meter_reading',
  'fuel_level',
  'dashboard_warnings',
  'exterior_damages',
  'interior_status',
  'missing_items',
  'ai_summary',
  'is_clean'
];

const PROMPT_RULES_CAR_INSPECTION = `
⚠️ STRICT RULES:
- Return ONLY a valid flat JSON object with EXACTLY the keys listed below.
- Do NOT add extra keys. Do NOT rename keys.
- If a value is missing or cannot be determined from the images, use null.
- JSON only, no markdown, no commentary.

🛑 CRITICAL ANTI-HALLUCINATION RULES:
2. DASHBOARD WARNINGS: 
   - Normal Lights (IGNORE THESE): Parking brake (red P or exclamation in circle), Seatbelt (red person with belt), Door open (red car with open doors), Headlights. Do NOT report these.
   - Dangerous Warnings (REPORT THESE ONLY IF GLOWING): 
      * Tire Pressure (TPMS): Orange/Yellow horseshoe shape with an exclamation mark (!).
      * Check Engine: Yellow/Orange engine block outline.
      * Battery: Red rectangle with plus (+) and minus (-) symbols.
      * Oil pressure: Red dripping oil can.
      * Airbag (SRS): Red person with a circle/balloon in front of them.
      * Engine Temperature: Red thermometer in liquid.
   - Look EXTREMELY carefully at the shape of the glowing icon. DO NOT confuse the orange TPMS (!) horseshoe for a battery or engine.
   - ONLY report the Dangerous Warnings if you can clearly identify their shape. If no Dangerous Warnings are glowing, return null. DO NOT guess.
3. EXTERIOR DAMAGES: Look extremely carefully at all parts of the car (bumpers, grilles, fenders, doors).
   - Look for a WIDE VARIETY of issues: broken plastic (كسر), missing pieces (قطعة مفقودة), holes (ثقب), deep dents (طعجة), cracks (شعر/كسر), misaligned parts (انفصال/بروز), and scratches (خدش).
   - Pay special attention to the front lower grilles (الشبك السفلي) and bumper corners for broken or missing plastic slats.
   - Be conservative: Do NOT mistake reflections, dirt, water spots, glare, or shadows for damages. ONLY report a damage if it is clearly undeniable. If in doubt, do not list it.
3. MISSING ITEMS: Do not assume items are missing unless clearly absent from their designated visible spot.
4. If an image (like the dashboard) is blurry or unreadable, return null for its related fields.

📝 ARABIC LANGUAGE REQUIREMENT:
- ALL text fields (ai_summary, dashboard_warnings, interior_status, missing_items, part, type, severity, description) MUST be written in Arabic language ONLY.
- meter_reading: string or number of the odometer reading (write numbers clearly, e.g. "124500").
- fuel_level: string in Arabic (e.g. "ممتلئ", "النصف", "الربع", "فارغ").
- dashboard_warnings: string describing actively lit warning lights in Arabic, or null.
- "exterior_damages": [
    {
      "part": "الشبك الأمامي السفلي",
      "type": "كسر / قطعة مفقودة",
      "severity": "متوسط",
      "description": "وجود كسر واضح وفقدان لقطعة بلاستيكية من الشبك السفلي في الجهة اليمنى للسيارة."
    }
  ], or null if none.
- interior_status: string describing the interior in Arabic.
- missing_items: string describing missing items like fire extinguisher in Arabic.
- ai_summary: a brief text summary of the overall car condition in Arabic.
- is_clean: boolean (true/false).

🧾 REQUIRED KEYS (ALL MUST EXIST):
{
  "meter_reading": null,
  "fuel_level": null,
  "dashboard_warnings": null,
  "exterior_damages": null,
  "interior_status": null,
  "missing_items": null,
  "ai_summary": null,
  "is_clean": null
}
`;

/* =========================
   Model Normalization
========================= */
const MODEL_MAP = {
  'gemini-2.5-flash': 'google/gemini-2.5-flash',
  'gemini-2.5-flash-lite': 'google/gemini-2.5-flash-lite',
  'gemini-flash': 'google/gemini-1.5-flash',
  'gemini-1.5-flash': 'google/gemini-1.5-flash',
  'gemini-pro': 'google/gemini-1.5-pro',
  'gemini-1.5-pro': 'google/gemini-1.5-pro',
  'gpt-4o': 'openai/gpt-4o',
  'gpt-4o-mini': 'openai/gpt-4o-mini',
  'claude-3.5-sonnet': 'anthropic/claude-3.5-sonnet'
};

function normalizeModelName(model, fallback) {
  if (!model || typeof model !== 'string') return fallback;
  const trimmed = model.trim();
  if (!trimmed) return fallback;
  return MODEL_MAP[trimmed] || trimmed;
}

function buildFallbackModels(primaryModel) {
  const list = [primaryModel];

  if (primaryModel.startsWith('google/')) {
    if (primaryModel !== 'google/gemini-2.5-flash') {
      list.push('google/gemini-2.5-flash');
    }
    if (primaryModel !== 'google/gemini-2.5-flash-lite') {
      list.push('google/gemini-2.5-flash-lite');
    }
  } else {
    list.push('google/gemini-2.5-flash');
    list.push('google/gemini-2.5-flash-lite');
  }

  return [...new Set(list)];
}

function getPdfModelCandidates(primaryModel) {
  return [
    normalizeModelName(primaryModel, DEFAULT_VISION_MODEL),
    'google/gemini-2.5-flash',
    'google/gemini-2.5-flash-lite'
  ].filter((v, i, arr) => v && arr.indexOf(v) === i);
}

/* =========================
   Prompt Builders
========================= */
function buildTextPrompt(text) {
  return `
Extract information from the following text and return ONLY a valid flat JSON object.

${PROMPT_RULES}

Text: "${text}"
  `.trim();
}

function buildDocumentPrompt() {
  return `
Extract information from the document and return ONLY a valid flat JSON object.

${PROMPT_RULES}
  `.trim();
}

function buildTicketTextPrompt(text) {
  return `
Extract flight ticket / boarding pass information from the following text and return ONLY a valid flat JSON object.

${PROMPT_RULES_TICKETS}

Text: "${text}"
  `.trim();
}

function buildTicketDocumentPrompt() {
  return `
Extract flight ticket or boarding pass information from the image or PDF and return ONLY a valid flat JSON object.

${PROMPT_RULES_TICKETS}
  `.trim();
}

function buildCarInspectionPrompt() {
  return `
You are an expert car inspector. Analyze these images of a car check-in/check-out process.
Extract the car condition and return ONLY a valid flat JSON object.

${PROMPT_RULES_CAR_INSPECTION}
  `.trim();
}

async function extractPdfTextForFallback(pdfBuffer) {
  const parsed = await pdfParse(pdfBuffer);
  const text = String(parsed?.text || '').replace(/\s+/g, ' ').trim();
  // Keep prompt size controlled for model stability.
  return text.slice(0, 20000);
}

/* =========================
   Response Helpers
========================= */
function extractAssistantText(data) {
  const message = data?.choices?.[0]?.message;

  if (!message) {
    throw new Error('OpenRouter response did not contain a message');
  }

  if (typeof message.content === 'string') {
    return message.content;
  }

  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text') return part.text || '';
        return '';
      })
      .join('\n')
      .trim();
  }

  throw new Error('Unsupported OpenRouter response format');
}

function normalizeFlatJson(rawText) {
  const cleanedText = String(rawText || '')
    .replace(/```json\s*|\s*```/g, '')
    .trim();

  const parsed = JSON.parse(cleanedText);

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Response is not a valid flat JSON object');
  }

  const finalResponse = {};
  for (const key of ALLOWED_KEYS) {
    const value = parsed[key];
    if (value === undefined || value === null) {
      finalResponse[key] = null;
    } else if (typeof value === 'object') {
      finalResponse[key] = JSON.stringify(value);
    } else {
      finalResponse[key] = String(value);
    }
  }

  return {
    cleanedText,
    finalResponse
  };
}

function normalizeTicketsDetailsJson(rawText) {
  const cleanedText = String(rawText || '')
    .replace(/```json\s*|\s*```/g, '')
    .trim();

  const parsed = JSON.parse(cleanedText);

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Response is not a valid flat JSON object');
  }

  const extracted = {};
  for (const key of TICKETS_DETAILS_KEYS) {
    const value = parsed[key];
    if (value === undefined || value === null) {
      extracted[key] = null;
    } else if (typeof value === 'object') {
      extracted[key] = JSON.stringify(value);
    } else {
      extracted[key] = String(value);
    }
  }

  const tickets_details = {
    id: null,
    order_id: null,
    createdAt: null,
    updatedAt: null,
    ...extracted
  };

  return { cleanedText, tickets_details };
}

function normalizeCarInspectionJson(rawText) {
  const cleanedText = String(rawText || '')
    .replace(/```json\s*|\s*```/g, '')
    .trim();

  const parsed = JSON.parse(cleanedText);

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Response is not a valid flat JSON object');
  }

  const extracted = {};
  for (const key of CAR_INSPECTION_KEYS) {
    extracted[key] = parsed[key] !== undefined ? parsed[key] : null;
  }

  return { cleanedText, inspection_details: extracted };
}

function extractOpenRouterError(err) {
  const payload = err?.response?.data || {};
  const inner = payload?.error || {};

  return {
    status: err?.response?.status,
    message: inner?.message || err.message,
    code: inner?.code,
    metadata: inner?.metadata || null,
    raw: payload
  };
}

function logSafePayload(payload) {
  const safePayload = JSON.parse(JSON.stringify(payload));

  const content = safePayload?.messages?.[0]?.content;
  if (Array.isArray(content)) {
    for (const item of content) {
      if (item?.type === 'file' && item?.file?.file_data) {
        item.file.file_data =
          `[DATA_URL_PRESENT len=${item.file.file_data.length}] prefix=${item.file.file_data.slice(0, 30)}`;
      }
      if (item?.type === 'file' && item?.file?.fileData) {
        item.file.fileData =
          `[DATA_URL_PRESENT len=${item.file.fileData.length}] prefix=${item.file.fileData.slice(0, 30)}`;
      }
      if (item?.type === 'image_url' && item?.image_url?.url) {
        item.image_url.url = '[BASE64_IMAGE_OMITTED]';
      }
    }
  }

  console.log('[DEBUG] OpenRouter payload (safe):');
  console.log(JSON.stringify(safePayload, null, 2));
}

function isMissingFileDataError(error) {
  const details = extractOpenRouterError(error);
  const message = String(details.message || '').toLowerCase();
  return message.includes('file data is missing');
}

/* =========================
   OpenRouter Call
========================= */
async function callOpenRouter({
  model,
  messages,
  plugins,
  temperature = 0,
  max_tokens = 1200,
  useFallbackModels = true
}) {
  const payload = {
    model,
    messages,
    temperature,
    max_tokens,
    stream: false
  };

  if (plugins?.length) {
    payload.plugins = plugins;
  }

  if (ENABLE_MODEL_FALLBACKS && useFallbackModels) {
    payload.models = buildFallbackModels(model);
  }

  logSafePayload(payload);

  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    payload,
    {
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.APP_URL || 'http://localhost:4444',
        'X-Title': process.env.APP_NAME || 'Document Extractor'
      },
      timeout: 180000
    }
  );

  return response.data;
}

function buildPdfMessages(prompt, filename, pdfDataUrl, dataKeyStyle = 'snake') {
  const fileObject =
    dataKeyStyle === 'camel'
      ? {
        filename,
        fileData: pdfDataUrl
      }
      : {
        filename,
        file_data: pdfDataUrl
      };

  return [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        {
          type: 'file',
          file: fileObject
        }
      ]
    }
  ];
}

async function callOpenRouterForPdf({
  primaryModel,
  prompt,
  filename,
  pdfDataUrl,
  plugins,
  temperature = 0,
  max_tokens = 1200
}) {
  const models = getPdfModelCandidates(primaryModel);
  const keyStyles = ['snake', 'camel']; // نجرب الاتنين بسبب اختلافات التنفيذ
  let lastError = null;

  for (const keyStyle of keyStyles) {
    for (const model of models) {
      try {
        console.log(`[INFO] محاولة PDF بالموديل: ${model}, keyStyle: ${keyStyle}`);

        const messages = buildPdfMessages(
          prompt,
          filename,
          pdfDataUrl,
          keyStyle
        );

        return await callOpenRouter({
          model,
          messages,
          plugins,
          temperature,
          max_tokens,
          useFallbackModels: false
        });
      } catch (error) {
        const details = extractOpenRouterError(error);
        lastError = error;
        console.error(
          `[WARN] فشل PDF model=${model} keyStyle=${keyStyle}: ${details.message}`
        );

        if (!isMissingFileDataError(error) && !String(details.message || '').toLowerCase().includes('failed to parse')) {
          // لو الخطأ مختلف، نكمل نجرب موديل تاني برضه
        }
      }
    }
  }

  throw lastError || new Error('All PDF attempts failed');
}

/* =========================
   Error Middleware
========================= */
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({
      error: 'حجم الملف كبير جدًا. الحد الأقصى المسموح به هو 50 ميجابايت.',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }

  if (err?.message?.includes('الرجاء تحميل ملف صورة')) {
    return res.status(400).json({
      error: err.message,
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }

  next(err);
});

/* =========================
   Routes
========================= */
async function handleGeminiExtraction(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'لم يتم تحميل أي ملف.' });
    }

    const modelName = normalizeModelName(
      req.body.model || DEFAULT_VISION_MODEL,
      DEFAULT_VISION_MODEL
    );

    console.log(
      `[INFO] معالجة الملف: ${req.file.originalname}, الحجم: ${(req.file.size / 1024 / 1024).toFixed(2)} ميجابايت`
    );
    console.log(`[INFO] req.body.model: ${req.body.model || ''}`);
    console.log(`[INFO] normalized modelName: ${modelName}`);

    const prompt = buildDocumentPrompt();
    const base64Data = req.file.buffer.toString('base64');
    let data;

    if (req.file.mimetype === 'application/pdf') {
      const pdfDataUrl = `data:application/pdf;base64,${base64Data}`;

      console.log('[DEBUG] pdf filename:', req.file.originalname);
      console.log('[DEBUG] pdf mimetype:', req.file.mimetype);
      console.log('[DEBUG] pdf size:', req.file.size);
      console.log('[DEBUG] pdfDataUrl prefix:', pdfDataUrl.slice(0, 35));

      const plugins = [
        {
          id: 'file-parser',
          pdf: {
            engine: PDF_ENGINE
          }
        }
      ];

      try {
        data = await callOpenRouterForPdf({
          primaryModel: modelName,
          prompt,
          filename: req.file.originalname || 'document.pdf',
          pdfDataUrl,
          plugins,
          temperature: 0,
          max_tokens: 1200
        });

        const checkRaw = extractAssistantText(data);
        const checkNorm = normalizeFlatJson(checkRaw);
        const validValues = Object.values(checkNorm.finalResponse).filter(v => v !== null && v !== '');
        if (validValues.length === 0) {
          throw new Error('failed to parse: model returned empty data');
        }
      } catch (pdfUploadError) {
        try {
          console.log('[INFO] المحاولة الثانية باستخدام المحرك native...');
          data = await callOpenRouterForPdf({
            primaryModel: modelName,
            prompt,
            filename: req.file.originalname || 'document.pdf',
            pdfDataUrl,
            plugins: [{ id: 'file-parser', pdf: { engine: 'native' } }],
            temperature: 0,
            max_tokens: 1200
          });

          const checkRawNative = extractAssistantText(data);
          const checkNormNative = normalizeFlatJson(checkRawNative);
          const validValuesNative = Object.values(checkNormNative.finalResponse).filter(v => v !== null && v !== '');
          if (validValuesNative.length === 0) {
            throw new Error('failed to parse: native returned empty data');
          }
        } catch (nativeError) {
          const details = extractOpenRouterError(nativeError);
          const message = String(details.message || '').toLowerCase();
          const canFallbackToText =
            message.includes('file data is missing') ||
            message.includes('failed to parse');

          if (!canFallbackToText) {
            throw nativeError;
          }

          console.warn('[WARN] PDF file upload failed, using local text extraction fallback');

          const extractedText = await extractPdfTextForFallback(req.file.buffer);
          if (!extractedText) {
            throw new Error('تعذر استخراج نص من ملف PDF.');
          }

          data = await callOpenRouter({
            model: normalizeModelName(DEFAULT_TEXT_MODEL, DEFAULT_TEXT_MODEL),
            messages: [
              {
                role: 'user',
                content: buildTextPrompt(extractedText)
              }
            ],
            useFallbackModels: true,
            temperature: 0,
            max_tokens: 1200
          });
        }
      }
    } else {
      const imageDataUrl = `data:${req.file.mimetype};base64,${base64Data}`;

      const messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: imageDataUrl
              }
            }
          ]
        }
      ];

      data = await callOpenRouter({
        model: modelName,
        messages,
        plugins: undefined,
        useFallbackModels: true,
        temperature: 0,
        max_tokens: 1200
      });
    }

    const rawText = extractAssistantText(data);
    console.log('[DEBUG] Raw model response:', rawText);

    const normalized = normalizeFlatJson(rawText);

    return res.status(200).json({
      jsonResponse: normalized.finalResponse
    });
  } catch (error) {
    const details = extractOpenRouterError(error);

    console.error('[ERROR] خطأ أثناء معالجة الملف:', details.message);

    if (details?.metadata?.available_providers) {
      console.error(
        '[ERROR] available_providers:',
        JSON.stringify(details.metadata.available_providers, null, 2)
      );
    }

    if (details?.metadata?.requested_providers) {
      console.error(
        '[ERROR] requested_providers:',
        JSON.stringify(details.metadata.requested_providers, null, 2)
      );
    }

    return res.status(details.status || 500).json({
      error: 'حدث خطأ أثناء معالجة الملف.',
      providerError: details.message,
      available_providers: details?.metadata?.available_providers || undefined,
      requested_providers: details?.metadata?.requested_providers || undefined,
      details: process.env.NODE_ENV === 'development' ? details.raw : undefined
    });
  }
}

function parseOptionalInt(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

async function handleTicketsExtraction(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'لم يتم تحميل أي ملف.' });
    }

    const modelName = normalizeModelName(
      req.body.model || DEFAULT_VISION_MODEL,
      DEFAULT_VISION_MODEL
    );

    const order_id = parseOptionalInt(req.body.order_id);
    const ticketFile =
      req.body.ticketFile != null && String(req.body.ticketFile).trim() !== ''
        ? String(req.body.ticketFile).trim()
        : null;

    console.log(
      `[INFO] tickets_details: ${req.file.originalname}, ${(req.file.size / 1024 / 1024).toFixed(2)} MB`
    );

    const prompt = buildTicketDocumentPrompt();
    const base64Data = req.file.buffer.toString('base64');
    let data;

    if (req.file.mimetype === 'application/pdf') {
      const pdfDataUrl = `data:application/pdf;base64,${base64Data}`;
      const plugins = [
        {
          id: 'file-parser',
          pdf: {
            engine: PDF_ENGINE
          }
        }
      ];

      try {
        data = await callOpenRouterForPdf({
          primaryModel: modelName,
          prompt,
          filename: req.file.originalname || 'ticket.pdf',
          pdfDataUrl,
          plugins,
          temperature: 0,
          max_tokens: 1500
        });

        const checkRaw = extractAssistantText(data);
        const { tickets_details } = normalizeTicketsDetailsJson(checkRaw);
        const validValues = Object.keys(tickets_details)
          .filter(k => k !== 'id' && k !== 'order_id' && k !== 'createdAt' && k !== 'updatedAt' && k !== 'ticketFile')
          .map(k => tickets_details[k])
          .filter(v => v !== null && v !== '');

        if (validValues.length === 0) {
          throw new Error('failed to parse: model returned empty data');
        }
      } catch (pdfUploadError) {
        try {
          console.log('[INFO] المحاولة الثانية للتذكرة باستخدام المحرك native...');
          data = await callOpenRouterForPdf({
            primaryModel: modelName,
            prompt,
            filename: req.file.originalname || 'ticket.pdf',
            pdfDataUrl,
            plugins: [{ id: 'file-parser', pdf: { engine: 'native' } }],
            temperature: 0,
            max_tokens: 1500
          });

          const checkRawNative = extractAssistantText(data);
          const { tickets_details } = normalizeTicketsDetailsJson(checkRawNative);
          const validValuesNative = Object.keys(tickets_details)
            .filter(k => k !== 'id' && k !== 'order_id' && k !== 'createdAt' && k !== 'updatedAt' && k !== 'ticketFile')
            .map(k => tickets_details[k])
            .filter(v => v !== null && v !== '');

          if (validValuesNative.length === 0) {
            throw new Error('failed to parse: native returned empty data');
          }
        } catch (nativeError) {
          const details = extractOpenRouterError(nativeError);
          const message = String(details.message || '').toLowerCase();
          const canFallbackToText =
            message.includes('file data is missing') ||
            message.includes('failed to parse');

          if (!canFallbackToText) {
            throw nativeError;
          }

          console.warn('[WARN] PDF ticket: fallback to text extraction');

          const extractedText = await extractPdfTextForFallback(req.file.buffer);
          if (!extractedText) {
            throw new Error('تعذر استخراج نص من ملف PDF.');
          }

          data = await callOpenRouter({
            model: normalizeModelName(DEFAULT_TEXT_MODEL, DEFAULT_TEXT_MODEL),
            messages: [
              {
                role: 'user',
                content: buildTicketTextPrompt(extractedText)
              }
            ],
            useFallbackModels: true,
            temperature: 0,
            max_tokens: 1500
          });
        }
      }
    } else {
      const imageDataUrl = `data:${req.file.mimetype};base64,${base64Data}`;

      data = await callOpenRouter({
        model: modelName,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: imageDataUrl
                }
              }
            ]
          }
        ],
        plugins: undefined,
        useFallbackModels: true,
        temperature: 0,
        max_tokens: 1500
      });
    }

    const rawText = extractAssistantText(data);
    console.log('[DEBUG] Raw ticket model response:', rawText);

    const { tickets_details } = normalizeTicketsDetailsJson(rawText);

    if (order_id !== null) {
      tickets_details.order_id = order_id;
    }
    if (ticketFile !== null) {
      tickets_details.ticketFile = ticketFile;
    }

    return res.status(200).json({ tickets_details });
  } catch (error) {
    const details = extractOpenRouterError(error);

    console.error('[ERROR] extractdatafromtickets:', details.message);

    return res.status(details.status || 500).json({
      error: 'حدث خطأ أثناء استخراج بيانات التذكرة.',
      providerError: details.message,
      available_providers: details?.metadata?.available_providers || undefined,
      requested_providers: details?.metadata?.requested_providers || undefined,
      details: process.env.NODE_ENV === 'development' ? details.raw : undefined
    });
  }
}

app.post('/api/gemini', upload.single('image'), handleGeminiExtraction);
app.post('/gemini', upload.single('image'), handleGeminiExtraction);

app.post(
  '/extractdatafromtickets',
  upload.single('image'),
  handleTicketsExtraction
);
app.post(
  '/api/extractdatafromtickets',
  upload.single('image'),
  handleTicketsExtraction
);

/* =========================
   CAR INSPECTION API
========================= */
async function handleCarInspection(req, res) {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'لم يتم تحميل أي صور.' });
    }

    const modelName = normalizeModelName(
      req.body.model || DEFAULT_VISION_MODEL,
      DEFAULT_VISION_MODEL
    );

    console.log(
      `[INFO] car inspection: ${req.files.length} images received`
    );

    const prompt = buildCarInspectionPrompt();
    
    const contentArray = [{ type: 'text', text: prompt }];
    
    for (const file of req.files) {
      const base64Data = file.buffer.toString('base64');
      const imageDataUrl = `data:${file.mimetype};base64,${base64Data}`;
      contentArray.push({
        type: 'image_url',
        image_url: {
          url: imageDataUrl
        }
      });
    }

    const messages = [
      {
        role: 'user',
        content: contentArray
      }
    ];

    const data = await callOpenRouter({
      model: modelName,
      messages,
      plugins: undefined,
      useFallbackModels: true,
      temperature: 0,
      max_tokens: 1500
    });

    const rawText = extractAssistantText(data);
    console.log('[DEBUG] Raw car inspection response:', rawText);

    const { inspection_details } = normalizeCarInspectionJson(rawText);

    return res.status(200).json({ inspection_details });
  } catch (error) {
    const details = extractOpenRouterError(error);

    console.error('[ERROR] inspect-car:', details.message);

    return res.status(details.status || 500).json({
      error: 'حدث خطأ أثناء فحص السيارة.',
      providerError: details.message,
      details: process.env.NODE_ENV === 'development' ? details.raw : undefined
    });
  }
}

app.post('/api/inspect-car', upload.array('images', 20), handleCarInspection);

app.post('/prompt', async (req, res) => {
  try {
    const { text, model } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'الرجاء توفير نص للمعالجة.' });
    }

    const selectedModel = normalizeModelName(
      model || DEFAULT_TEXT_MODEL,
      DEFAULT_TEXT_MODEL
    );

    console.log(`[INFO] استخدام نموذج OpenRouter: ${selectedModel}`);

    const prompt = buildTextPrompt(text);

    const data = await callOpenRouter({
      model: selectedModel,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      useFallbackModels: true
    });

    const rawText = extractAssistantText(data);
    console.log('[DEBUG] Raw model response:', rawText);

    const normalized = normalizeFlatJson(rawText);

    return res.status(200).json({
      jsonResponse: normalized.finalResponse
    });
  } catch (error) {
    const details = extractOpenRouterError(error);

    console.error('[ERROR] خطأ أثناء معالجة النص:', details.message);

    return res.status(details.status || 500).json({
      error: 'حدث خطأ أثناء معالجة النص.',
      providerError: details.message,
      available_providers: details?.metadata?.available_providers || undefined,
      requested_providers: details?.metadata?.requested_providers || undefined,
      details: process.env.NODE_ENV === 'development' ? details.raw : undefined
    });
  }
});

app.post('/process-document', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'لم يتم تحميل أي ملف.' });
    }

    return res.status(200).json({
      message: 'استخدم /api/gemini لمعالجة الصور وPDF عبر OpenRouter.'
    });
  } catch (error) {
    return res.status(500).json({
      error: 'حدث خطأ داخلي أثناء معالجة الملف.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'OpenRouter API يعمل',
    timestamp: new Date().toISOString()
  });
});

app.listen(port, () => {
  console.log(`✅ Server running on http://localhost:${port}`);
  console.log(`📋 Health check: http://localhost:${port}/health`);
});
