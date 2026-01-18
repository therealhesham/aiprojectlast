const express = require('express');
const multer = require('multer');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config(); // Load environment variables
const app = express();
app.use(cors());
const port = process.env.PORT || 4000;

// Middleware for JSON and URL-encoded bodies with size limits
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Configure multer with file size limit and image filter
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/png', 'image/jpeg', 'application/pdf'];
    if (!allowedTypes.includes(file.mimetype)) {
      return cb(new Error('الرجاء تحميل ملف صورة (PNG أو JPEG) أو PDF فقط.'));
    }
    cb(null, true);
  }
});

// Gemini API Configuration
const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('[ERROR] GEMINI_API_KEY غير موجود في ملف .env');
  process.exit(1);
}
const genAI = new GoogleGenerativeAI(API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

// Multer error handling middleware
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    console.error('[ERROR] فشل تحميل الملف: حجم الملف يتجاوز 50 ميجابايت');
    return res.status(400).json({
      error: 'حجم الملف كبير جدًا. الحد الأقصى المسموح به هو 50 ميجابايت. الرجاء ضغط الصورة.',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  } else if (err.message.includes('الرجاء تحميل ملف صورة')) {
    console.error('[ERROR] نوع الملف غير مدعوم:', err.message);
    return res.status(400).json({
      error: err.message,
      details: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
  next(err);
});

/**
 * @api {post} /api/gemini معالجة الصورة باستخدام Gemini مباشرة
 * @apiDescription تحميل ملف صورة (PNG أو JPEG) واستخراج النص وتحليله باستخدام Gemini API
 * @apiParam {File} image الصورة المراد معالجتها (PNG أو JPEG، بحد أقصى 50 ميجابايت)
 * @apiParam {String} [model] اسم نموذج Gemini (اختياري، القيمة الافتراضية: gemini-2.5-flash)
 * @apiSuccess {Object} jsonResponse الكائن JSON المسطح المحتوي على الحقول المستخرجة
 */
app.post('/api/gemini', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'لم يتم تحميل أي ملف.' });
    }
    
    // Get model name from request body or use default
    const modelName = req.body.model || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
    const dynamicModel = genAI.getGenerativeModel({ model: modelName });
    
    console.log(`[INFO] معالجة الصورة: ${req.file.originalname}, الحجم: ${(req.file.size / 1024 / 1024).toFixed(2)} ميجابايت`);
    console.log(`[INFO] استخدام نموذج: ${modelName}`);

    // Convert image buffer to base64 for Gemini
    const imageBase64 = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;

    // Prepare prompt for Gemini to extract text and return as flat JSON
    const prompt = `
    Extract key information from this document/image and return it as a **flat JSON object** (no nested fields, all values as strings).  

⚠️ Rules:
- Only use values from the allowed list below when filling fields like experience, education, marital_status, religion, language levels, skills.
- Do not translate or normalize values — keep them **exactly as in the reference list**.
- If a field is missing, return null for that field.
- Dates must be in **ISO format** (YYYY-MM-DD).
- Always return the output in valid JSON format.
- All keys listed below are required - if a value is not found, return null for that key.

📝 Required keys (all must be present, use null if not found):
- Name (or full_name, name)
- dateofbirth (or date_of_birth, birthDate, BirthDate) - ISO format YYYY-MM-DD
- age (as integer string, e.g., "25")
- Nationalitycopy (or nationality, Nationality) - string value
- Religion (or religion)
- Passportnumber (or passport_number, passport, PassportNumber)
- PassportStart (or passport_issue_date, passportStart, passportStartDate, PassportStartDate) - ISO format YYYY-MM-DD
- PassportEnd (or passport_expiration, passportEnd, passportEndDate, PassportEndDate) - ISO format YYYY-MM-DD
- maritalstatus (or marital_status, maritalStatus, MaritalStatus)
- job (or job_title, jobTitle, JobTitle, profession, Profession)
- Salary (or salary)
- weight (as integer string, e.g., "60")
- height (as integer string, e.g., "165")
- children (or children_count, childrenCount) - as integer string
- officeName (or office_name, officeName, OfficeName)
- Education (or educationLevel, education_level, EducationLevel, education)
- EnglishLanguageLevel (or englishLevel, english_level, EnglishLevel, EnglishLanguageLevel)
- ArabicLanguageLeveL (or arabicLevel, arabic_level, ArabicLevel, ArabicLanguageLeveL)
- Experience (or experienceField, experience_field, ExperienceField, experience)
- ExperienceYears (or experienceYears, experience_years, ExperienceYears, years_of_experience)
- CookingLevel (or cookingLevel, cooking_level, CookingLevel)
- WashingLevel (or washingLevel, washing_level, WashingLevel)
- IroningLevel (or ironingLevel, ironing_level, IroningLevel)
- CleaningLevel (or cleaningLevel, cleaning_level, CleaningLevel)
- SewingLevel (or sewingLevel, sewing_level, SewingLevel)
- ChildcareLevel (or childcareLevel, childcare_level, ChildcareLevel, babysitter, Babysitter, babysitting, Babysitting)
- ElderlycareLevel (or elderlycareLevel, elderlycare_level, ElderlycareLevel, elderly_care, ElderlyCare)
- LaundryLevel (or laundryLevel, laundry_level, LaundryLevel)
- BabySitterLevel (or BabySitterLevel, baby_sitter_level)
- phone (or mobile, phone, Mobile, Phone)

🎯 Allowed Values (use EXACTLY as shown):

- Experience: "Novice | مدربة بدون خبرة", "Intermediate | مدربة بخبرة متوسطة", "Well-experienced | خبرة جيدة", "Expert | خبرة ممتازة"
- Education: "Illiterate - غير متعلم", "Literate - القراءة والكتابة", "Primary school - ابتدائي", "High school - ثانوي", "Diploma - دبلوم", "University level - جامعي"
- Marital Status: "Single - عازبة", "Married - متزوجة", "Divorced - مطلقة", "Separated - منفصلة"
- Religion: "Islam - الإسلام", "Non-Muslim - غير مسلم", "Christianity - المسيحية"
- Language Levels: "Expert - ممتاز", "Advanced - جيد جداً", "Intermediate - جيد", "Beginner - مبتدأ", "Non - لا تجيد"
- Skills (CookingLevel, WashingLevel, CleaningLevel, IroningLevel, SewingLevel, ChildcareLevel, ElderlycareLevel, LaundryLevel, BabySitterLevel): same as Language Levels
- Nationality: Must match exactly from database (e.g., "Uganda - أوغندا", "Ethiopia - إثيوبيا", "Kenya - كينيا", "Bengladesh - بنغلادش", "Philippines - الفلبين")
    `;

    // Send image and prompt to Gemini
    console.log('[INFO] إرسال الصورة إلى Gemini...');
    const result = await dynamicModel.generateContent([
      {
        inlineData: {
          data: imageBase64,
          mimeType: mimeType
        }
      },
      { text: prompt }
    ]);

    const response = await result.response;
    let rawText = response.text();
    console.log('[INFO] استجابة Gemini الخام:', rawText);

    // Clean the response: Remove ```json and ``` markers, trim whitespace
    rawText = rawText.replace(/```json\n?|\n?```/g, '').trim();

    // Ensure the response is valid JSON
    let jsonResponse;
    try {
      jsonResponse = JSON.parse(rawText);
      // Validate that the response is a flat object
      if (typeof jsonResponse !== 'object' || Array.isArray(jsonResponse) || jsonResponse === null) {
        throw new Error('Response is not a valid flat JSON object');
      }
      // Ensure all values are strings and no nested objects
      jsonResponse = Object.entries(jsonResponse).reduce((acc, [key, value]) => {
        if (typeof value === 'object' && value !== null) {
          return { ...acc, [key]: JSON.stringify(value) };
        }
        return { ...acc, [key]: String(value) };
      }, {});
    } catch (parseError) {
      console.error('[ERROR] فشل تحليل استجابة Gemini:', parseError.message, 'Raw response:', rawText);
      return res.status(500).json({
        error: 'فشل في تحليل استجابة Gemini كـ JSON صالح.',
        details: process.env.NODE_ENV === 'development' ? parseError.message : undefined,
        rawResponse: process.env.NODE_ENV === 'development' ? rawText : undefined
      });
    }

    console.log('[INFO] استجابة Gemini المحللة:', jsonResponse);
    res.status(200).json({ jsonResponse });

  } catch (error) {
    console.error('[ERROR] خطأ أثناء معالجة الصورة:', error.message, error.stack);
    res.status(500).json({
      error: 'حدث خطأ داخلي أثناء معالجة الصورة.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * @api {post} /process-document معالجة صورة
 * @apiDescription تحميل ملف صورة (PNG أو JPEG) واستخراج النص باستخدام Google Cloud Vision API
 * @apiParam {File} document الصورة المراد معالجتها (PNG أو JPEG، بحد أقصى 50 ميجابايت)
 * @apiSuccess {String} text النص المستخرج من الصورة
 */
app.post('/process-document', upload.single('document'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'لم يتم تحميل أي ملف.' });
    }
    console.log(`[INFO] معالجة الصورة: ${req.file.originalname}, الحجم: ${(req.file.size / 1024 / 1024).toFixed(2)} ميجابايت`);
    
    // Note: Google Cloud Vision code is removed from this route since you requested no vision
    // If you need it back, you can re-add the visionClient.textDetection call here

    res.status(200).json({ message: 'هذا المسار مخصص لـ Google Cloud Vision، استخدم /api/gemini لمعالجة الصور مباشرة.' });

  } catch (error) {
    console.error('[ERROR] أثناء معالجة الصورة:', error.message, error.stack);
    res.status(500).json({
      error: 'حدث خطأ داخلي أثناء معالجة الصورة.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @api {post} /prompt معالجة النص باستخدام Gemini API
 * @apiDescription إرسال نص مباشر إلى Gemini API لتنظيمه ككائن JSON مسطح
 * @apiParam {String} text النص المراد معالجته
 * @apiParam {String} [model] اسم نموذج Gemini (اختياري، القيمة الافتراضية: gemini-2.5-flash)
 * @apiSuccess {Object} jsonResponse الكائن JSON المسطح المحتوي على الحقول المستخرجة
 */
app.post('/prompt', async (req, res) => {
  const { text, model: modelName } = req.body;
  console.log("tex", text);
  if (!text) {
    return res.status(400).json({ error: 'الرجاء توفير نص للمعالجة.' });
  }
  
  // Get model name from request body or use default
  const selectedModel = modelName || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const dynamicModel = genAI.getGenerativeModel({ model: selectedModel });
  
  console.log(`[INFO] استخدام نموذج: ${selectedModel}`);
  console.log('[INFO] إرسال النص إلى Gemini...');
  try {
    const prompt = `
      Extract key information from the following text and return it as a **flat JSON object** (no nested fields, all values as strings).  
      
      ⚠️ Rules:
      - Only use values from the allowed list below when filling fields like experience, education, marital_status, religion, language levels, skills.
      - Do not translate or normalize values — keep them **exactly as in the reference list**.
      - If a field is missing, return null for that field.
      - Dates must be in **ISO format** (YYYY-MM-DD).
      - Always return the output in valid JSON format.
      - All keys listed below are required - if a value is not found, return null for that key.
      
      Text: "${text}"
     
      📝 Required keys (all must be present, use null if not found):
      - Name (or full_name, name)
      - dateofbirth (or date_of_birth, birthDate, BirthDate) - ISO format YYYY-MM-DD
      - age (as integer string, e.g., "25")
      - Nationalitycopy (or nationality, Nationality) - string value
      - Religion (or religion)
      - Passportnumber (or passport_number, passport, PassportNumber)
      - PassportStart (or passport_issue_date, passportStart, passportStartDate, PassportStartDate) - ISO format YYYY-MM-DD
      - PassportEnd (or passport_expiration, passportEnd, passportEndDate, PassportEndDate) - ISO format YYYY-MM-DD
      - maritalstatus (or marital_status, maritalStatus, MaritalStatus)
      - job (or job_title, jobTitle, JobTitle, profession, Profession)
      - Salary (or salary)
      - weight (as integer string, e.g., "60")
      - height (as integer string, e.g., "165")
      - children (or children_count, childrenCount) - as integer string
      - officeName (or office_name, officeName, OfficeName)
      - Education (or educationLevel, education_level, EducationLevel, education)
      - EnglishLanguageLevel (or englishLevel, english_level, EnglishLevel, EnglishLanguageLevel)
      - ArabicLanguageLeveL (or arabicLevel, arabic_level, ArabicLevel, ArabicLanguageLeveL)
      - Experience (or experienceField, experience_field, ExperienceField, experience)
      - ExperienceYears (or experienceYears, experience_years, ExperienceYears, years_of_experience)
      - CookingLevel (or cookingLevel, cooking_level, CookingLevel)
      - WashingLevel (or washingLevel, washing_level, WashingLevel)
      - IroningLevel (or ironingLevel, ironing_level, IroningLevel)
      - CleaningLevel (or cleaningLevel, cleaning_level, CleaningLevel)
      - SewingLevel (or sewingLevel, sewing_level, SewingLevel)
      - ChildcareLevel (or childcareLevel, childcare_level, ChildcareLevel, babysitter, Babysitter)
      - ElderlycareLevel (or elderlycareLevel, elderlycare_level, ElderlycareLevel, elderly_care, ElderlyCare)
      - LaundryLevel (or laundryLevel, laundry_level, LaundryLevel)
      - BabySitterLevel (or BabySitterLevel, baby_sitter_level)
      - phone (or mobile, phone, Mobile, Phone)
      
      🎯 Allowed Values (use EXACTLY as shown):
      - Experience: "Novice | مدربة بدون خبرة", "Intermediate | مدربة بخبرة متوسطة", "Well-experienced | خبرة جيدة", "Expert | خبرة ممتازة"
      - Education: "Illiterate - غير متعلم", "Literate - القراءة والكتابة", "Primary school - ابتدائي", "High school - ثانوي", "Diploma - دبلوم", "University level - جامعي"
      - Marital Status: "Single - عازبة", "Married - متزوجة", "Divorced - مطلقة", "Separated - منفصلة"
      - Religion: "Islam - الإسلام", "Non-Muslim - غير مسلم", "Christianity - المسيحية"
      - Language Levels: "Expert - ممتاز", "Advanced - جيد جداً", "Intermediate - جيد", "Beginner - مبتدأ", "Non - لا تجيد"
      - Skills (CookingLevel, WashingLevel, CleaningLevel, IroningLevel, SewingLevel, ChildcareLevel, ElderlycareLevel, LaundryLevel, BabySitterLevel): same as Language Levels
      - Nationality: Must match exactly from database (e.g., "Uganda - أوغندا", "Ethiopia - إثيوبيا", "Kenya - كينيا", "Bengladesh - بنغلادش", "Philippines - الفلبين")
    `;
    const result = await dynamicModel.generateContent(prompt);
    const response = await result.response;
    const rawText = response.text();
    // Ensure the response is valid JSON
    let jsonResponse;
    try {
      // Clean the response: Remove ```json and ``` markers, trim whitespace
      const cleanedText = rawText.replace(/```json\n?|\n?```/g, '').trim();
      jsonResponse = JSON.parse(cleanedText);
      // Validate that the response is a flat object
      if (typeof jsonResponse !== 'object' || Array.isArray(jsonResponse) || jsonResponse === null) {
        throw new Error('Response is not a valid flat JSON object');
      }
      // Ensure all values are strings and no nested objects
      jsonResponse = Object.entries(jsonResponse).reduce((acc, [key, value]) => {
        if (typeof value === 'object' && value !== null) {
          return { ...acc, [key]: JSON.stringify(value) };
        }
        return { ...acc, [key]: String(value) };
      }, {});
    } catch (parseError) {
      console.error('[ERROR] فشل تحليل استجابة Gemini:', parseError.message, rawText);
      return res.status(500).json({
        error: 'فشل في تحليل استجابة Gemini كـ JSON صالح.',
        details: process.env.NODE_ENV === 'development' ? parseError.message : undefined,
      });
    }
    console.log('[INFO] استجابة Gemini المحللة:', jsonResponse);
    res.status(200).json({ jsonResponse });
  } catch (error) {
    console.error('[ERROR] خطأ أثناء معالجة النص:', error.message, error.stack);
    res.status(500).json({
      error: 'حدث خطأ داخلي أثناء معالجة النص.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    message: 'Gemini API يعمل',
    timestamp: new Date().toISOString()
  });
});

// Start server
app.listen(port, () => {
  console.log(`✅ خادم Gemini يعمل على http://localhost:${port}`);
  console.log(`📋 فحص الحالة: http://localhost:${port}/health`);
});

