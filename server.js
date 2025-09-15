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
const API_KEY = process.env.GEMINI_API_KEY || "AIzaSyCvnu9jFkpki73oMquseZ7Rp6hcfgTNzys";
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
 * @apiSuccess {Object} jsonResponse الكائن JSON المسطح المحتوي على الحقول المستخرجة
 */
app.post('/api/gemini', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'لم يتم تحميل أي ملف.' });
    }
    console.log(`[INFO] معالجة الصورة: ${req.file.originalname}, الحجم: ${(req.file.size / 1024 / 1024).toFixed(2)} ميجابايت`);

    // Convert image buffer to base64 for Gemini
    const imageBase64 = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;

    // Prepare prompt for Gemini to extract text and return as flat JSON
    const prompt = `
      Extract key information from the provided image and return it as a flat JSON object (no nested fields, all values as strings). Ensure the output is valid JSON with meaningful field names based on the content. For example, if the text contains a name, use "name" as the key, and the value as a string. Do not include any nested objects or arrays. If a field is not present, do not include it in the output. Wrap the JSON output in a code block (e.g., \`\`\`json\n{...}\n\`\`\`).

      Return the result as a JSON object, make fields for:
        - full_name
        - date_of_birth (in ISO format, e.g., "YYYY-MM-DD")
        - age
        - nationality
        - birth_place
        - office_name
        - company_name
        - passport_issue_date
        - passport_expiration
        - gender
        - religion
        - skills (as a string, e.g., JSON stringified if multiple skills)
        - job_title
    passport_number
    salary: 
    languages_spoken: 
    living_town
    children_count
    weight
    height
    marital_status
    `;

    // Send image and prompt to Gemini
    console.log('[INFO] إرسال الصورة إلى Gemini...');
    const result = await model.generateContent([
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
 * @apiSuccess {Object} jsonResponse الكائن JSON المسطح المحتوي على الحقول المستخرجة
 */
app.post('/prompt', async (req, res) => {
  const { text } = req.body;
  console.log("tex", text);
  if (!text) {
    return res.status(400).json({ error: 'الرجاء توفير نص للمعالجة.' });
  }
  console.log('[INFO] إرسال النص إلى Gemini...');
  try {
    const prompt = `
      Extract key information from the following text and return it as a flat JSON object (no nested fields, all values as strings). Ensure the output is valid JSON with meaningful field names based on the content. For example, if the text contains a name, use "name" as the key, and the value as a string. Do not include any nested objects or arrays. If a field is not present, do not include it in the output.
      Text: "${text}"
     
      Return the result as a JSON object, make fields for:
      - full name
      - date of birth (in ISO format)
      - age
      - nationality
      - birth place
      - office name
      - company name
      - passport issue date
      - passport expiration
      - gender
      - religion
      - skills (as a string, e.g., JSON stringified if multiple skills)
    `;
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const rawText = response.text();
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