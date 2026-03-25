const express = require('express');
const multer = require('multer');
const cors = require('cors');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(cors());
const port = process.env.PORT || 4000;

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) {
  console.error('[ERROR] OPENROUTER_API_KEY غير موجود في ملف .env');
  process.exit(1);
}

// موديل افتراضي للنص
const DEFAULT_TEXT_MODEL =
  process.env.OPENROUTER_TEXT_MODEL || 'google/gemini-2.5-flash-lite';

// موديل افتراضي للصور / المستندات
const DEFAULT_VISION_MODEL =
  process.env.OPENROUTER_VISION_MODEL || 'google/gemini-2.5-flash-lite';

const ALLOWED_KEYS = [
  "Name","Religion","Passportnumber","ExperienceYears","maritalstatus",
  "Experience","dateofbirth","Nationality","job","Education",
  "EnglishLanguageLevel","ArabicLanguageLeveL","SewingLevel","weight",
  "height","childrencount","CleaningLevel","CookingLevel","WashingLevel",
  "IroningLevel","ChildcareLevel","ElderlycareLevel",
  "phone","age","officeName","experienceType",
  "PassportStart","PassportEnd","Salary","BabySitterLevel"
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

async function callOpenRouter({
  model,
  messages,
  plugins,
  temperature = 0,
  max_tokens = 1200
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

  const response = await axios.post(
    'https://openrouter.ai/api/v1/chat/completions',
    payload,
    {
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.APP_URL || 'http://localhost:4000',
        'X-Title': process.env.APP_NAME || 'Document Extractor'
      },
      timeout: 180000
    }
  );

  return response.data;
}

function extractAssistantText(data) {
  const message = data?.choices?.[0]?.message;

  if (!message) {
    throw new Error('OpenRouter response did not contain a message');
  }

  // أغلب الحالات
  if (typeof message.content === 'string') {
    return message.content;
  }

  // بعض الموديلات قد ترجع content كمصفوفة
  if (Array.isArray(message.content)) {
    return message.content
      .map(part => {
        if (typeof part === 'string') return part;
        if (part?.type === 'text') return part.text || '';
        return '';
      })
      .join('\n')
      .trim();
  }

  throw new Error('Unsupported OpenRouter response format');
}

// Multer errors
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    console.error('[ERROR] فشل تحميل الملف: حجم الملف يتجاوز 50 ميجابايت');
    return res.status(400).json({
      error: 'حجم الملف كبير جدًا. الحد الأقصى المسموح به هو 50 ميجابايت. الرجاء ضغط الصورة.',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }

  if (err?.message?.includes('الرجاء تحميل ملف صورة')) {
    console.error('[ERROR] نوع الملف غير مدعوم:', err.message);
    return res.status(400).json({
      error: err.message,
      details: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }

  next(err);
});

/**
 * @api {post} /api/gemini
 * احتفظنا بالاسم كما هو للتوافق مع الفرونت الحالي
 * لكنه الآن يستخدم OpenRouter بدل Gemini SDK
 */
app.post('/api/gemini', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'لم يتم تحميل أي ملف.' });
    }

    const modelName = req.body.model || DEFAULT_VISION_MODEL;

    console.log(
      `[INFO] معالجة الملف: ${req.file.originalname}, الحجم: ${(req.file.size / 1024 / 1024).toFixed(2)} ميجابايت`
    );
    console.log(`[INFO] استخدام نموذج OpenRouter: ${modelName}`);

    const prompt = buildDocumentPrompt();
    const base64Data = req.file.buffer.toString('base64');

    let messages;
    let plugins = undefined;

    if (req.file.mimetype === 'application/pdf') {
      const pdfDataUrl = `data:application/pdf;base64,${base64Data}`;

      messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'file',
              file: {
                filename: req.file.originalname || 'document.pdf',
                file_data: pdfDataUrl
              }
            }
          ]
        }
      ];

      // مجاني للنصوص الواضحة داخل PDF
      // لو الـ PDF سكان أو صور، غيّره إلى mistral-ocr
      plugins = [
        {
          id: 'file-parser',
          pdf: {
            engine: process.env.OPENROUTER_PDF_ENGINE || 'pdf-text'
          }
        }
      ];
    } else {
      const imageDataUrl = `data:${req.file.mimetype};base64,${base64Data}`;

      messages = [
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
    }

    console.log('[INFO] إرسال الملف إلى OpenRouter...');
    const data = await callOpenRouter({
      model: modelName,
      messages,
      plugins
    });

    const rawText = extractAssistantText(data);
    console.log('[INFO] استجابة OpenRouter الخام:', rawText);

    let normalized;
    try {
      normalized = normalizeFlatJson(rawText);
    } catch (parseError) {
      console.error('[ERROR] فشل تحليل استجابة OpenRouter:', parseError.message, rawText);
      return res.status(500).json({
        error: 'فشل في تحليل استجابة OpenRouter كـ JSON صالح.',
        details: process.env.NODE_ENV === 'development' ? parseError.message : undefined,
        rawResponse: process.env.NODE_ENV === 'development' ? rawText : undefined
      });
    }

    console.log('[INFO] استجابة OpenRouter المحللة:', normalized.finalResponse);
    res.status(200).json({ jsonResponse: normalized.finalResponse });

  } catch (error) {
    console.error(
      '[ERROR] خطأ أثناء معالجة الملف:',
      error.response?.data || error.message,
      error.stack
    );

    res.status(500).json({
      error: 'حدث خطأ داخلي أثناء معالجة الملف.',
      details: process.env.NODE_ENV === 'development'
        ? (error.response?.data || error.message)
        : undefined
    });
  }
});

/**
 * @api {post} /process-document
 * احتفظنا به كما كان
 */
app.post('/process-document', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'لم يتم تحميل أي ملف.' });
    }

    console.log(
      `[INFO] معالجة الملف: ${req.file.originalname}, الحجم: ${(req.file.size / 1024 / 1024).toFixed(2)} ميجابايت`
    );

    res.status(200).json({
      message: 'هذا المسار مخصص سابقًا لـ Vision. استخدم /api/gemini لمعالجة الصور وPDF عبر OpenRouter مباشرة.'
    });

  } catch (error) {
    console.error('[ERROR] أثناء معالجة الملف:', error.message, error.stack);
    res.status(500).json({
      error: 'حدث خطأ داخلي أثناء معالجة الملف.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @api {post} /prompt
 * إرسال نص مباشر إلى OpenRouter
 */
app.post('/prompt', async (req, res) => {
  const { text, model: modelName } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'الرجاء توفير نص للمعالجة.' });
  }

  const selectedModel = modelName || DEFAULT_TEXT_MODEL;

  console.log(`[INFO] استخدام نموذج OpenRouter: ${selectedModel}`);
  console.log('[INFO] إرسال النص إلى OpenRouter...');

  try {
    const prompt = buildTextPrompt(text);

    const data = await callOpenRouter({
      model: selectedModel,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
    });

    const rawText = extractAssistantText(data);

    let normalized;
    try {
      normalized = normalizeFlatJson(rawText);
    } catch (parseError) {
      console.error('[ERROR] فشل تحليل استجابة OpenRouter:', parseError.message, rawText);
      return res.status(500).json({
        error: 'فشل في تحليل استجابة OpenRouter كـ JSON صالح.',
        details: process.env.NODE_ENV === 'development' ? parseError.message : undefined,
        rawResponse: process.env.NODE_ENV === 'development' ? rawText : undefined
      });
    }

    console.log('[INFO] استجابة OpenRouter المحللة:', normalized.finalResponse);
    res.status(200).json({ jsonResponse: normalized.finalResponse });

  } catch (error) {
    console.error(
      '[ERROR] خطأ أثناء معالجة النص:',
      error.response?.data || error.message,
      error.stack
    );

    res.status(500).json({
      error: 'حدث خطأ داخلي أثناء معالجة النص.',
      details: process.env.NODE_ENV === 'development'
        ? (error.response?.data || error.message)
        : undefined,
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
  console.log(`✅ خادم OpenRouter يعمل على http://localhost:${port}`);
  console.log(`📋 فحص الحالة: http://localhost:${port}/health`);
});
