const express = require('express');
const multer = require('multer');
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;
const path = require('path');
const cors = require('cors');

require('dotenv').config(); // Load environment variables

const app = express();
app.use(cors());
const port = process.env.PORT || 3000;

// Middleware for JSON and URL-encoded bodies with size limits
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Configure multer to store files in memory (for binary processing)
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Google Document AI Configuration
const projectId = process.env.GCP_PROJECT_ID || 'eastern-amp-471710-u4';
const location = process.env.GCP_LOCATION || 'us';
const processorId = process.env.GCP_PROCESSOR_ID || 'abc7c6209dbadfc1';

const client = new DocumentProcessorServiceClient();

/**
 * @api {post} /process-document معالجة مستند PDF
 * @apiDescription تحميل ملف PDF ومعالجته عبر Document AI لاستخراج النص والكيانات
 * @apiParam {File} document الملف المراد معالجته (يجب أن يكون PDF)
 * @apiSuccess {String} text النص الكامل المستخرج من المستند
 * @apiSuccess {Object} entities كائن يحتوي على الكيانات المستخرجة (مفتاح=النوع، قيمة=النص)
 */
app.post('/process-document', upload.single('document'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'لم يتم تحميل أي ملف.' });
  }

  if (req.file.mimetype !== 'application/pdf') {
    return res.status(400).json({ error: 'الرجاء تحميل ملف PDF فقط.' });
  }

  try {
    const name = `projects/${projectId}/locations/${location}/processors/${processorId}`;
    const encodedDocument = req.file.buffer.toString('base64');

    const request = {
      name,
      rawDocument: {
        content: encodedDocument,
        mimeType: req.file.mimetype,
      },
    };

    const [result] = await client.processDocument(request);
    const { document } = result;

    const extractedData = {
      text: document.text || '',
      entities: {},
    };

    if (document.entities && Array.isArray(document.entities)) {
      for (const entity of document.entities) {
        const key = entity.type;
        const value = entity.mentionText || '';
        if (extractedData.entities[key]) {
          // Handle duplicate types by making array (optional enhancement)
          if (!Array.isArray(extractedData.entities[key])) {
            extractedData.entities[key] = [extractedData.entities[key]];
          }
          extractedData.entities[key].push(value);
        } else {
          extractedData.entities[key] = value;
        }
      }
    }

    res.status(200).json(extractedData);

  } catch (error) {
    console.error('[ERROR] أثناء معالجة المستند:', error.message);
    res.status(500).json({
      error: 'حدث خطأ داخلي أثناء معالجة المستند.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * @api {post} /processor-control التحكم في حالة المعالج
 * @apiDescription تفعيل أو تعطيل معالج Document AI
 * @apiParam {String} action "enable" أو "disable"
 * @apiSuccess {String} message رسالة نجاح
 * @apiSuccess {Object} response استجابة العملية من Google Cloud
 */
app.post('/processor-control', async (req, res) => {
  const { action } = req.body;

  if (!action || !['enable', 'disable'].includes(action)) {
    return res.status(400).json({
      error: 'يجب تحديد إجراء صالح: "enable" أو "disable".',
    });
  }

  try {
    const name = `projects/${projectId}/locations/${location}/processors/${processorId}`;

    let operation;
    if (action === 'disable') {
      [operation] = await client.disableProcessor({ name });
      console.log(`[INFO] جارٍ تعطيل المعالج: ${processorId}`);
    } else {
      [operation] = await client.enableProcessor({ name });
      console.log(`[INFO] جارٍ تفعيل المعالج: ${processorId}`);
    }

    const [response] = await operation.promise();
    console.log(`[SUCCESS] تم ${action} المعالج بنجاح.`);

    res.status(200).json({
      message: `تم ${action === 'enable' ? 'تفعيل' : 'تعطيل'} المعالج بنجاح.`,
      response,
    });

  } catch (error) {
    console.error(`[ERROR] أثناء ${action === 'enable' ? 'تفعيل' : 'تعطيل'} المعالج:`, error.message);
    res.status(500).json({
      error: `حدث خطأ داخلي أثناء ${action === 'enable' ? 'تفعيل' : 'تعطيل'} المعالج.`,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

/**
 * 🆕 NEW ENDPOINT: Get current processor status
 * @api {get} /processor-control/status التحقق من حالة المعالج
 * @apiDescription يُعيد الحالة الحالية للمعالج (ENABLED/DISABLED) ووقت آخر تحديث
 * @apiSuccess {String} status "ENABLED" أو "DISABLED"
 * @apiSuccess {String} updatedAt وقت آخر تحديث للحالة (ISO 8601)
 */
app.get('/processor-control/status', async (req, res) => {
  try {
    const name = `projects/${projectId}/locations/${location}/processors/${processorId}`;
    const [processor] = await client.getProcessor({ name });

    const status = processor.state.toString(); // e.g., "ENABLED", "DISABLED"
    const updatedAt = processor.updateTime
      ? new Date(processor.updateTime.seconds * 1000).toISOString()
      : new Date().toISOString();

    res.json({
      status,
      updatedAt,
    });

  } catch (error) {
    console.error('[ERROR] أثناء التحقق من حالة المعالج:', error.message);
    res.status(500).json({
      error: 'فشل التحقق من حالة المعالج.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
});

// Start server
app.listen(port, () => {
  console.log(`✅ خادم Document AI يعمل على http://localhost:${port}`);
});