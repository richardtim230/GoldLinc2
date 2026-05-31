const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const Staff = require('../models/Staff');
const Assignment = require('../models/Assignment');
const Notification = require('../models/Notification');
const DraftResult = require('../models/DraftResult');
const Class = require('../models/Class');
const Subject = require('../models/Subject');
const Student = require('../models/Student');
const teacherAuth = require('../middleware/teacherAuth');
const ResultCBT = require('../models/ResultCBT');
const CBT = require('../models/CBTExam');
const Collection = require('../models/Collection');

console.log('[TEACHERS.JS] Router file loaded');

// ============ GLOBAL REQUEST LOGGING ============
router.use((req, res, next) => {
  console.log(`\n[TEACHERS ROUTER] ${req.method} ${req.originalUrl}`);
  console.log(`[TEACHERS ROUTER] Path: ${req.path}`);
  console.log(`[TEACHERS ROUTER] Params:`, req.params);
  next();
});

// ============ NON-PARAMETERIZED ROUTES FIRST ============

router.get('/', async (req, res) => {
  console.log('[GET /] Listing all teachers');
  const teachers = await Staff.find({ access_level: 'Teacher' });
  res.json(teachers.map(t => ({
    id: t._id,
    first_name: t.first_name,
    last_name: t.last_name,
    name: `${t.first_name} ${t.last_name}`,
    email: t.email,
    phone: t.phone,
    designation: t.designation,
    department: t.department,
    photo_url: t.photo || null,
  })));
});

router.get('/me', teacherAuth, async (req, res) => {
  console.log('[GET /me] Fetching own profile');
  const teacher = req.staff;
  if (!teacher || teacher.access_level !== 'Teacher') return res.status(404).json({ error: "Teacher not found" });

  const classes = await Class.find({ teachers: teacher._id })
    .populate({
      path: 'subjects.subject',
      model: 'Subject'
    })
    .populate({
      path: 'subjects.teacher',
      model: 'Staff',
      select: 'first_name last_name email'
    });

  const classData = classes.map(cls => ({
    id: cls._id,
    name: cls.name,
    arms: cls.arms,
    subjects: (cls.subjects || []).map(s => ({
      id: s.subject && s.subject._id,
      name: s.subject && s.subject.name,
      teacher: s.teacher ? {
        id: s.teacher._id,
        name: `${s.teacher.first_name} ${s.teacher.last_name}`,
        email: s.teacher.email
      } : null
    }))
  }));

  res.json({
    id: teacher._id,
    name: `${teacher.first_name} ${teacher.last_name}`,
    email: teacher.email,
    phone: teacher.phone,
    designation: teacher.designation,
    department: teacher.department,
    photo_url: teacher.photo || null,
    classes: classData
  });
});

router.patch('/me', teacherAuth, async (req, res) => {
  console.log('[PATCH /me] Updating own profile');
  if (req.body.login_password) {
    req.body.login_password = await bcrypt.hash(req.body.login_password, 10);
  }
  const teacher = await Staff.findByIdAndUpdate(req.staff._id, req.body, { new: true });
  res.json({
    id: teacher._id,
    name: `${teacher.first_name} ${teacher.last_name}`,
    email: teacher.email,
    phone: teacher.phone,
    designation: teacher.designation,
    department: teacher.department,
    photo_url: teacher.photo || null,
  });
});

router.get('/classes', teacherAuth, async (req, res) => {
  console.log('[GET /classes] Fetching teacher classes');
  const classes = await Class.find({ teachers: req.staff._id });
  res.json(classes.map(cls => ({
    id: cls._id,
    name: cls.name,
    arms: cls.arms
  })));
});

router.get('/subjects', teacherAuth, async (req, res) => {
  const { classId } = req.query;
  console.log('[GET /subjects] ClassID:', classId);
  if (!classId) return res.status(400).json({ error: "classId is required" });
  const cls = await Class.findById(classId)
    .populate('subjects.subject')
    .populate('subjects.teacher');
  if (!cls) return res.json([]);
  const subjects = (cls.subjects || []).filter(
    s => s.teacher && String(s.teacher._id) === String(req.staff._id)
  ).map(s => ({
    id: s.subject ? s.subject._id : undefined,
    name: s.subject ? s.subject.name : undefined
  }));
  res.json(subjects);
});

router.get('/students', teacherAuth, async (req, res) => {
  const { classId } = req.query;
  console.log('[GET /students] ClassID:', classId);
  if (!classId) return res.status(400).json({ error: "classId is required" });

  const cls = await Class.findById(classId);
  if (!cls) return res.status(404).json({ error: "Class not found" });

  const students = await Student.find({ class: cls.name });
  res.json(students.map(stu => ({
    id: stu._id,
    name: `${stu.firstname} ${stu.surname}`,
    regNo: stu.regNo,
    email: stu.studentEmail
  })));
});

router.post('/classes/:classId/subjects', teacherAuth, async (req, res) => {
  console.log('[POST /classes/:classId/subjects] ClassID:', req.params.classId);
  const { classId } = req.params;
  const { subjectName } = req.body;
  let subject = await Subject.findOne({ name: subjectName });
  if (!subject) {
    subject = new Subject({ name: subjectName });
    await subject.save();
  }
  const cls = await Class.findById(classId);
  if (!cls.subjects.some(s => String(s.subject) === String(subject._id) && String(s.teacher) === String(req.staff._id))) {
    cls.subjects.push({ subject: subject._id, teacher: req.staff._id });
    await cls.save();
  }
  await cls.populate([
    { path: 'subjects.subject', model: 'Subject' },
    { path: 'subjects.teacher', model: 'Staff', select: 'first_name last_name email' }
  ]);
  const added = cls.subjects.find(s =>
    String(s.subject._id) === String(subject._id) &&
    String(s.teacher._id) === String(req.staff._id)
  );
  res.json({
    success: true,
    subject: added
      ? {
          id: added.subject._id,
          name: added.subject.name,
          teacher: added.teacher
            ? {
                id: added.teacher._id,
                name: `${added.teacher.first_name} ${added.teacher.last_name}`,
                email: added.teacher.email
              }
            : null
        }
      : null
  });
});

router.get('/cbt/:cbtId', teacherAuth, async (req, res) => {
  console.log('[GET /cbt/:cbtId] CBT ID:', req.params.cbtId);
  try {
    const cbt = await CBT.findById(req.params.cbtId)
      .populate('class', 'name')
      .populate('subject', 'name');
    if (!cbt) return res.status(404).json({ error: "CBT not found" });
    res.json({ cbt });
  } catch (err) {
    console.error('[GET /cbt/:cbtId] ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============ NEW DEDICATED COLLECTION ENDPOINTS ============
// These are simpler and don't use the /:id pattern that was causing conflicts

router.get('/question-bank', teacherAuth, async (req, res) => {
  console.log('\n[GET /question-bank] ===== UNIFIED QUESTION BANK ENDPOINT =====');
  try {
    console.log('[GET /question-bank] Fetching for teacher:', req.staff._id);
    
    const collections = await Collection.find({ teacher: req.staff._id }).sort({ createdAt: -1 });
    const cbts = await CBT.find({ teacher: req.staff._id }).sort({ createdAt: -1 });

    console.log('[GET /question-bank] Collections found:', collections.length);
    console.log('[GET /question-bank] CBTs found:', cbts.length);

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

    console.log('[GET /question-bank] ✅ Total question banks:', allQuestionBanks.length);
    res.json({ questionBanks: allQuestionBanks });
  } catch (err) {
    console.error('[GET /question-bank] ❌ ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET all collections for teacher
router.get('/collections/list', teacherAuth, async (req, res) => {
  console.log('\n[GET /collections/list] ===== FETCH ALL COLLECTIONS =====');
  try {
    console.log('[GET /collections/list] Teacher ID:', req.staff._id);
    const collections = await Collection.find({ teacher: req.staff._id }).sort({ createdAt: -1 });
    console.log('[GET /collections/list] ✅ Found:', collections.length);
    res.json({ collections });
  } catch (err) {
    console.error('[GET /collections/list] ❌ ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST create new collection
router.post('/collections/create', teacherAuth, async (req, res) => {
  console.log('\n[POST /collections/create] ===== CREATE NEW COLLECTION =====');
  console.log('[POST /collections/create] Body:', req.body);
  try {
    const { name, classId, subjectId, description } = req.body;
    
    if (!name) {
      console.log('[POST /collections/create] ERROR: Name required');
      return res.status(400).json({ error: "Collection name is required" });
    }

    console.log('[POST /collections/create] Creating collection:', name);
    const collection = new Collection({
      teacher: req.staff._id,
      name,
      class: classId || null,
      subject: subjectId || null,
      description: description || '',
      questions: []
    });
    
    await collection.save();
    console.log('[POST /collections/create] ✅ Created:', collection._id);
    res.status(201).json({ collection });
  } catch (err) {
    console.error('[POST /collections/create] ❌ ERROR:', err.message);
    console.error('[POST /collections/create] Stack:', err.stack);
    res.status(500).json({ error: err.message });
  }
});

// POST add question to collection
router.post('/collections/:collectionId/add-question', teacherAuth, async (req, res) => {
  console.log('\n[POST /collections/:collectionId/add-question] ===== ADD QUESTION =====');
  console.log('[POST /collections/:collectionId/add-question] Collection ID:', req.params.collectionId);
  try {
    const { text, options, imageUrl, explanation } = req.body;
    
    if (!text || !options || options.length === 0) {
      console.log('[POST /collections/:collectionId/add-question] ERROR: Missing fields');
      return res.status(400).json({ error: "Question text and options are required" });
    }

    const collection = await Collection.findById(req.params.collectionId);
    if (!collection) {
      console.log('[POST /collections/:collectionId/add-question] ERROR: Collection not found');
      return res.status(404).json({ error: "Collection not found" });
    }
    
    if (String(collection.teacher) !== String(req.staff._id)) {
      console.log('[POST /collections/:collectionId/add-question] ERROR: Forbidden');
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
    console.log('[POST /collections/:collectionId/add-question] ✅ Question added:', question.id);
    
    res.status(201).json({ question });
  } catch (err) {
    console.error('[POST /collections/:collectionId/add-question] ❌ ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// PATCH update question in collection
router.patch('/collections/:collectionId/question/:questionId', teacherAuth, async (req, res) => {
  console.log('\n[PATCH /collections/:collectionId/question/:questionId] ===== UPDATE QUESTION =====');
  try {
    const { text, options, imageUrl, explanation } = req.body;

    const collection = await Collection.findById(req.params.collectionId);
    if (!collection) {
      return res.status(404).json({ error: "Collection not found" });
    }
    
    if (String(collection.teacher) !== String(req.staff._id)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const questionIndex = collection.questions.findIndex(q => q.id === req.params.questionId);
    if (questionIndex === -1) {
      return res.status(404).json({ error: "Question not found" });
    }

    if (text !== undefined) collection.questions[questionIndex].text = text;
    if (options !== undefined) collection.questions[questionIndex].options = options;
    if (imageUrl !== undefined) collection.questions[questionIndex].imageUrl = imageUrl;
    if (explanation !== undefined) collection.questions[questionIndex].explanation = explanation;

    await collection.save();
    console.log('[PATCH /collections/:collectionId/question/:questionId] ✅ Updated');
    res.json({ question: collection.questions[questionIndex] });
  } catch (err) {
    console.error('[PATCH /collections/:collectionId/question/:questionId] ❌ ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE question from collection
router.delete('/collections/:collectionId/question/:questionId', teacherAuth, async (req, res) => {
  console.log('\n[DELETE /collections/:collectionId/question/:questionId] ===== DELETE QUESTION =====');
  try {
    const collection = await Collection.findById(req.params.collectionId);
    if (!collection) {
      return res.status(404).json({ error: "Collection not found" });
    }
    
    if (String(collection.teacher) !== String(req.staff._id)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    collection.questions = collection.questions.filter(q => q.id !== req.params.questionId);
    await collection.save();
    console.log('[DELETE /collections/:collectionId/question/:questionId] ✅ Deleted');
    res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /collections/:collectionId/question/:questionId] ❌ ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// DELETE entire collection
router.delete('/collections/:collectionId', teacherAuth, async (req, res) => {
  console.log('\n[DELETE /collections/:collectionId] ===== DELETE COLLECTION =====');
  try {
    const collection = await Collection.findById(req.params.collectionId);
    if (!collection) {
      return res.status(404).json({ error: "Collection not found" });
    }
    
    if (String(collection.teacher) !== String(req.staff._id)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    await Collection.findByIdAndDelete(req.params.collectionId);
    console.log('[DELETE /collections/:collectionId] ✅ Deleted');
    res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /collections/:collectionId] ❌ ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ============ OTHER /:id ROUTES ============

router.get('/:id/cbt-results', teacherAuth, async (req, res) => {
  console.log('[GET /:id/cbt-results] ROUTE HIT');
  try {
    if (String(req.params.id) !== String(req.staff._id)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const classes = await Class.find({ teachers: req.staff._id });
    const classIds = classes.map(c => String(c._id));

    let query = {};
    if (req.query.classId) {
      if (!classIds.includes(req.query.classId)) {
        return res.status(403).json({ error: "Not assigned to this class" });
      }
      query.class = req.query.classId;
    } else {
      query.class = { $in: classIds };
    }

    const results = await ResultCBT.find(query)
      .populate('student', 'firstname surname')
      .populate('class', 'name')
      .populate('exam', 'title')
      .sort({ createdAt: -1 });

    const formatted = results.map(r => ({
      _id: r._id,
      studentName: r.student ? `${r.student.firstname} ${r.student.surname}` : '',
      classId: r.class ? r.class._id : '',
      className: r.class ? r.class.name : '',
      examTitle: r.exam ? r.exam.title : '',
      score: r.score,
      total: r.total,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      answers: r.answers
    }));

    res.json({ results: formatted });
  } catch (err) {
    console.error('[GET /:id/cbt-results] ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/cbt-results/:resultId', teacherAuth, async (req, res) => {
  console.log('[GET /:id/cbt-results/:resultId] ROUTE HIT');
  try {
    if (String(req.params.id) !== String(req.staff._id)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const result = await ResultCBT.findById(req.params.resultId)
      .populate('student', 'firstname surname')
      .populate('class', 'name')
      .populate('exam', 'title');
    if (!result) return res.status(404).json({ error: "Result not found" });
    res.json({
      _id: result._id,
      studentName: result.student ? `${result.student.firstname} ${result.student.surname}` : '',
      className: result.class ? result.class.name : '',
      examTitle: result.exam ? result.exam.title : '',
      score: result.score,
      total: result.total,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      answers: result.answers
    });
  } catch (err) {
    console.error('[GET /:id/cbt-results/:resultId] ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/assignments', teacherAuth, async (req, res) => {
  console.log('[GET /:id/assignments] ROUTE HIT');
  try {
    const assignments = await Assignment.find({ teacher: req.params.id })
      .populate({ path: 'class', select: 'name' })
      .sort({ dueDate: 1 });
    res.json({ assignments });
  } catch (err) {
    console.error('[GET /:id/assignments] ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/assignments', teacherAuth, async (req, res) => {
  console.log('[POST /:id/assignments] ROUTE HIT');
  try {
    const { class: classId, subject, title, description, dueDate, cbt } = req.body;
    const assignment = new Assignment({
      teacher: req.params.id,
      class: classId,
      subject,
      title,
      description,
      dueDate,
      cbt
    });
    await assignment.save();
    await assignment.populate({ path: 'class', select: 'name' });
    res.status(201).json({ assignment });
  } catch (err) {
    console.error('[POST /:id/assignments] ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/assignments/:assignmentId', teacherAuth, async (req, res) => {
  console.log('[PATCH /:id/assignments/:assignmentId] ROUTE HIT');
  try {
    const assignment = await Assignment.findOneAndUpdate(
      { _id: req.params.assignmentId, teacher: req.params.id },
      req.body,
      { new: true }
    );
    if (!assignment) return res.status(404).json({ error: "Assignment not found or not owned by teacher." });
    res.json({ success: true, assignment });
  } catch (err) {
    console.error('[PATCH /:id/assignments/:assignmentId] ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/assignments/:assignmentId', teacherAuth, async (req, res) => {
  console.log('[DELETE /:id/assignments/:assignmentId] ROUTE HIT');
  try {
    const assignment = await Assignment.findOneAndDelete({ _id: req.params.assignmentId, teacher: req.params.id });
    if (!assignment) return res.status(404).json({ error: "Assignment not found or not owned by teacher." });
    res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /:id/assignments/:assignmentId] ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/notifications', teacherAuth, async (req, res) => {
  console.log('[GET /:id/notifications] ROUTE HIT');
  try {
    const notifications = await Notification.find({ teacher: req.params.id }).sort({ date: -1 });
    res.json({ notifications });
  } catch (err) {
    console.error('[GET /:id/notifications] ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/notifications/:notificationId', teacherAuth, async (req, res) => {
  console.log('[DELETE /:id/notifications/:notificationId] ROUTE HIT');
  try {
    const notification = await Notification.findOneAndDelete({ _id: req.params.notificationId, teacher: req.params.id });
    if (!notification) return res.status(404).json({ error: "Notification not found or not owned by teacher." });
    res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /:id/notifications/:notificationId] ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/draft-results', teacherAuth, async (req, res) => {
  console.log('[GET /:id/draft-results] ROUTE HIT');
  try {
    const draftResults = await DraftResult.find({ teacher: req.params.id });
    res.json({ draftResults });
  } catch (err) {
    console.error('[GET /:id/draft-results] ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/draft-results', teacherAuth, async (req, res) => {
  console.log('[POST /:id/draft-results] ROUTE HIT');
  try {
    const input = req.body;
    let draft = await DraftResult.findOne({
      teacher: req.params.id,
      student: input.studentId,
      class: input.classId,
      term: input.term
    });
    if (!draft) {
      draft = new DraftResult({ ...input, teacher: req.params.id });
    } else {
      Object.assign(draft, input);
    }
    draft.updated = new Date();
    await draft.save();
    res.json({ draftResult: draft });
  } catch (err) {
    console.error('[POST /:id/draft-results] ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/cbt', teacherAuth, async (req, res) => {
  console.log('[POST /:id/cbt] ROUTE HIT');
  try {
    if (String(req.params.id) !== String(req.staff._id)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { class: classId, subject, title, duration, questions } = req.body;
    const cbt = new CBT({
      teacher: req.staff._id,
      class: classId,
      subject,
      title,
      duration,
      questions
    });
    await cbt.save();
    await cbt.populate([
      { path: 'class', select: 'name' },
      { path: 'subject', select: 'name' }
    ]);
    res.status(201).json({ cbt });
  } catch (err) {
    console.error('[POST /:id/cbt] ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/cbt', teacherAuth, async (req, res) => {
  console.log('[GET /:id/cbt] ROUTE HIT');
  try {
    if (String(req.params.id) !== String(req.staff._id)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const cbts = await CBT.find({ teacher: req.staff._id })
      .populate('class', 'name')
      .populate('subject', 'name');
    res.json({ cbts });
  } catch (err) {
    console.error('[GET /:id/cbt] ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/cbt/:cbtId', teacherAuth, async (req, res) => {
  console.log('[GET /:id/cbt/:cbtId] ROUTE HIT');
  try {
    const cbt = await CBT.findOne({ _id: req.params.cbtId, teacher: req.params.id })
      .populate('class', 'name')
      .populate('subject', 'name');
    if (!cbt) return res.status(404).json({ error: "CBT not found or not owned by teacher." });
    res.json({ cbt });
  } catch (err) {
    console.error('[GET /:id/cbt/:cbtId] ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/cbt/:cbtId', teacherAuth, async (req, res) => {
  console.log('[DELETE /:id/cbt/:cbtId] ROUTE HIT');
  try {
    const cbt = await CBT.findOneAndDelete({ _id: req.params.cbtId, teacher: req.params.id });
    if (!cbt) return res.status(404).json({ error: "CBT not found or not owned by teacher." });
    res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /:id/cbt/:cbtId] ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/cbt/:cbtId', teacherAuth, async (req, res) => {
  console.log('[PATCH /:id/cbt/:cbtId] ROUTE HIT');
  try {
    const cbt = await CBT.findOneAndUpdate(
      { _id: req.params.cbtId, teacher: req.params.id },
      req.body,
      { new: true }
    );
    if (!cbt) return res.status(404).json({ error: "CBT not found or not owned by teacher." });
    await cbt.populate([
      { path: 'class', select: 'name' },
      { path: 'subject', select: 'name' }
    ]);
    res.json({ success: true, cbt });
  } catch (err) {
    console.error('[PATCH /:id/cbt/:cbtId] ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/cbt/push', teacherAuth, async (req, res) => {
  console.log('[POST /:id/cbt/push] ROUTE HIT');
  try {
    const { cbtIds } = req.body;
    if (!Array.isArray(cbtIds) || !cbtIds.length) {
      return res.status(400).json({ error: "cbtIds array is required" });
    }
    const cbts = await CBT.find({ _id: { $in: cbtIds }, teacher: req.params.id });
    if (!cbts.length) return res.status(404).json({ error: "No CBTs found" });

    let pushed = [];
    for (const cbt of cbts) {
      const exam = new CBT({
        title: cbt.title,
        class: cbt.class,
        subject: cbt.subject,
        duration: cbt.duration,
        questions: cbt.questions
      });
      await exam.save();
      pushed.push(exam._id);
    }
    res.json({ success: true, pushed });
  } catch (err) {
    console.error('[POST /:id/cbt/push] ERROR:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
