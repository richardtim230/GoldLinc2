const express = require('express');
const router = express.Router();
const teacherAuth = require('../middleware/teacherAuth');
const Collection = require('../models/Collection');
const CBT = require('../models/CBTExam');

// ============ COLLECTIONS ROUTES ============

// GET /api/question-bank/collections
router.get('/collections', teacherAuth, async (req, res) => {
  console.log('[GET /collections] Teacher ID:', req.staff._id);
  try {
    const collections = await Collection.find({ teacher: req.staff._id }).sort({ createdAt: -1 });
    console.log('[GET /collections] Collections found:', collections.length);
    res.json({ collections });
  } catch (err) {
    console.error('[GET /collections] ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/question-bank/collections
router.post('/collections', teacherAuth, async (req, res) => {
  console.log('[POST /collections] Creating collection for teacher:', req.staff._id);
  try {
    const { name, classId, subjectId, description } = req.body;
    console.log('[POST /collections] Request body:', { name, classId, subjectId, description });
    
    if (!name) {
      console.log('[POST /collections] ERROR: Collection name is required');
      return res.status(400).json({ error: "Collection name is required" });
    }

    const collection = new Collection({
      teacher: req.staff._id,
      name,
      class: classId || null,
      subject: subjectId || null,
      description: description || '',
      questions: []
    });
    await collection.save();
    console.log('[POST /collections] SUCCESS: Collection created with ID:', collection._id);
    res.status(201).json({ collection });
  } catch (err) {
    console.error('[POST /collections] CATCH ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/question-bank/collections/:collectionId/questions
router.post('/collections/:collectionId/questions', teacherAuth, async (req, res) => {
  console.log('[POST /collections/:collectionId/questions] Collection ID:', req.params.collectionId);
  try {
    const { text, options, imageUrl, explanation } = req.body;
    console.log('[POST /collections/:collectionId/questions] Request body keys:', Object.keys(req.body));
    
    if (!text || !options || options.length === 0) {
      console.log('[POST /collections/:collectionId/questions] ERROR: Missing required fields');
      return res.status(400).json({ error: "Question text and options are required" });
    }

    const collection = await Collection.findById(req.params.collectionId);
    if (!collection) {
      console.log('[POST /collections/:collectionId/questions] ERROR: Collection not found');
      return res.status(404).json({ error: "Collection not found" });
    }
    if (String(collection.teacher) !== String(req.staff._id)) {
      console.log('[POST /collections/:collectionId/questions] ERROR: Forbidden - not owner');
      return res.status(403).json({ error: "Forbidden" });
    }

    const question = {
      id: `question_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      text,
      options,
      imageUrl: imageUrl || null,
      explanation: explanation || null,
      createdAt: new Date()
    };

    collection.questions.push(question);
    await collection.save();
    console.log('[POST /collections/:collectionId/questions] SUCCESS: Question created with ID:', question.id);
    
    res.status(201).json({ question });
  } catch (err) {
    console.error('[POST /collections/:collectionId/questions] CATCH ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/question-bank/collections/:collectionId/questions/:questionId
router.patch('/collections/:collectionId/questions/:questionId', teacherAuth, async (req, res) => {
  console.log('[PATCH /collections/:collectionId/questions/:questionId] IDs:', {
    collectionId: req.params.collectionId,
    questionId: req.params.questionId
  });
  try {
    const { text, options, imageUrl, explanation } = req.body;

    const collection = await Collection.findById(req.params.collectionId);
    if (!collection) {
      console.log('[PATCH /collections/:collectionId/questions/:questionId] ERROR: Collection not found');
      return res.status(404).json({ error: "Collection not found" });
    }
    if (String(collection.teacher) !== String(req.staff._id)) {
      console.log('[PATCH /collections/:collectionId/questions/:questionId] ERROR: Forbidden');
      return res.status(403).json({ error: "Forbidden" });
    }

    const questionIndex = collection.questions.findIndex(q => q.id === req.params.questionId);
    if (questionIndex === -1) {
      console.log('[PATCH /collections/:collectionId/questions/:questionId] ERROR: Question not found');
      return res.status(404).json({ error: "Question not found" });
    }

    if (text !== undefined) collection.questions[questionIndex].text = text;
    if (options !== undefined) collection.questions[questionIndex].options = options;
    if (imageUrl !== undefined) collection.questions[questionIndex].imageUrl = imageUrl;
    if (explanation !== undefined) collection.questions[questionIndex].explanation = explanation;

    await collection.save();
    console.log('[PATCH /collections/:collectionId/questions/:questionId] SUCCESS');
    res.json({ question: collection.questions[questionIndex] });
  } catch (err) {
    console.error('[PATCH /collections/:collectionId/questions/:questionId] CATCH ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/question-bank/collections/:collectionId/questions/:questionId
router.delete('/collections/:collectionId/questions/:questionId', teacherAuth, async (req, res) => {
  console.log('[DELETE /collections/:collectionId/questions/:questionId] IDs:', {
    collectionId: req.params.collectionId,
    questionId: req.params.questionId
  });
  try {
    const collection = await Collection.findById(req.params.collectionId);
    if (!collection) {
      console.log('[DELETE /collections/:collectionId/questions/:questionId] ERROR: Collection not found');
      return res.status(404).json({ error: "Collection not found" });
    }
    if (String(collection.teacher) !== String(req.staff._id)) {
      console.log('[DELETE /collections/:collectionId/questions/:questionId] ERROR: Forbidden');
      return res.status(403).json({ error: "Forbidden" });
    }

    collection.questions = collection.questions.filter(q => q.id !== req.params.questionId);
    await collection.save();
    console.log('[DELETE /collections/:collectionId/questions/:questionId] SUCCESS');
    res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /collections/:collectionId/questions/:questionId] CATCH ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/question-bank/collections/:collectionId
router.delete('/collections/:collectionId', teacherAuth, async (req, res) => {
  console.log('[DELETE /collections/:collectionId] Collection ID:', req.params.collectionId);
  try {
    const collection = await Collection.findByIdAndDelete(req.params.collectionId);
    if (!collection) {
      console.log('[DELETE /collections/:collectionId] ERROR: Collection not found');
      return res.status(404).json({ error: "Collection not found" });
    }
    console.log('[DELETE /collections/:collectionId] SUCCESS');
    res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /collections/:collectionId] CATCH ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============ UNIFIED QUESTION BANK ENDPOINT ============

// GET /api/question-bank/all
router.get('/all', teacherAuth, async (req, res) => {
  console.log('[GET /all] Fetching all question banks for teacher:', req.staff._id);
  try {
    const collections = await Collection.find({ teacher: req.staff._id }).sort({ createdAt: -1 });
    const cbts = await CBT.find({ teacher: req.staff._id }).sort({ createdAt: -1 });

    console.log('[GET /all] Collections found:', collections.length);
    console.log('[GET /all] CBTs found:', cbts.length);

    const legacyCBTCollections = cbts.map(cbt => ({
      _id: cbt._id,
      name: cbt.title || 'Legacy CBT',
      teacher: cbt.teacher,
      class: cbt.class,
      subject: cbt.subject,
      questions: (cbt.questions || []).map((q, idx) => ({
        id: `cbt_${cbt._id}_${idx}`,
        text: q.text,
        options: (q.options || []).map((opt, optIdx) => ({
          text: typeof opt === 'string' ? opt : opt.value || opt,
          isCorrect: q.answer === optIdx || (Array.isArray(q.answer) && q.answer.includes(optIdx))
        })),
        imageUrl: null,
        explanation: null,
        createdAt: cbt.createdAt
      })),
      description: 'Legacy CBT Document - Auto-migrated',
      createdAt: cbt.createdAt,
      isMigrated: false,
      source: 'CBT'
    }));

    const allQuestionBanks = [
      ...collections.map(c => ({ 
        ...c.toObject(), 
        isMigrated: true,
        source: 'Collection'
      })),
      ...legacyCBTCollections
    ];

    console.log('[GET /all] Total question banks:', allQuestionBanks.length);
    res.json({ questionBanks: allQuestionBanks });
  } catch (err) {
    console.error('[GET /all] CATCH ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
