const express = require('express');
const multer = require('multer');
const { DocumentProcessorServiceClient } = require('@google-cloud/documentai').v1;
const path = require('path');
const cors = require('cors');

require('dotenv').config(); // لإدارة متغيرات البيئة

const app = express();
app.use(cors());
const port = process.env.PORT ;
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
// استخدم multer لتحميل الملفات في الذاكرة
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// تهيئة Document AI من متغيرات البيئة أو القيم الافتراضية
const projectId = process.env.GCP_PROJECT_ID || 'eastern-amp-471710-u4';
const location = process.env.GCP_LOCATION || 'us';
const processorId = process.env.GCP_PROCESSOR_ID || 'abc7c6209dbadfc1';

const client = new DocumentProcessorServiceClient();

/**
 * @api {post} /process-document معالجة مستند
 * @apiDescription تقوم هذه النقطة بمعالجة ملف PDF باستخدام Document AI.
 * @apiParam {File} document الملف المراد معالجته (PDF).
 * @apiSuccess {Object} response يحتوي على النص والحقول المستخرجة.
 */
app.post('/process-document', upload.single('document'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('لم يتم تحميل أي ملف.');
  }

  // تحقق من نوع الملف
  if (req.file.mimetype !== 'application/pdf') {
    return res.status(400).send('الرجاء تحميل ملف PDF فقط.');
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
      text: document.text,
      entities: {},
    };

    if (document.entities) {
      for (const entity of document.entities) {
        const key = entity.type;
        const value = entity.mentionText || '';
        extractedData.entities[key] = value;
      }
    }

    res.status(200).json(extractedData);

  } catch (error) {
    console.error('حدث خطأ أثناء معالجة المستند:', error);
    res.status(500).json({ error: 'حدث خطأ داخلي أثناء معالجة المستند.' });
  }
});

/**
 * @api {post} /processor-control التحكم في المعالج
 * @apiDescription تتيح هذه النقطة تفعيل أو تعطيل معالج Document AI.
 * @apiParam {String} action القيم المسموح بها: "enable" أو "disable".
 * @apiSuccess {Object} response نتيجة عملية التحكم في المعالج.
 */
app.post('/processor-control', async (req, res) => {
  const { action } = req.body;

  if (!action || !['enable', 'disable'].includes(action)) {
    return res.status(400).json({ error: 'يجب تحديد إجراء صالح: "enable" أو "disable".' });
  }

  try {
    const name = `projects/${projectId}/locations/${location}/processors/${processorId}`;

    let operation;
    if (action === 'disable') {
      [operation] = await client.disableProcessor({ name });
    } else {
      [operation] = await client.enableProcessor({ name });
    }

    console.log(`${action === 'enable' ? 'Enabling' : 'Disabling'} processor, waiting for operation to complete...`);
    const [response] = await operation.promise();

    res.status(200).json({
      message: `Processor ${action}d successfully`,
      response
    });
  } catch (error) {
    console.error(`حدث خطأ أثناء ${action === 'enable' ? 'تفعيل' : 'تعطيل'} المعالج:`, error);
    res.status(500).json({ error: `حدث خطأ داخلي أثناء ${action === 'enable' ? 'تفعيل' : 'تعطيل'} المعالج.` });
  }
});

app.listen(port, () => {
  console.log(`خادم Document AI يعمل على http://localhost:${port}`);
});