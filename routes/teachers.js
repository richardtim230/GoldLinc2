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
const teacherAuth = require('../middleware/teacherAuth'); // Should set req.staff
const ResultCBT = require('../models/ResultCBT');
const CBT = require('../models/CBTExam'); // If your results reference Exam
const Collection = require('../models/Collection');
// GET /api/teachers/me - Get own teacher profile + classes + subjects
router.get('/me', teacherAuth, async (req, res) => {
  const teacher = req.staff;
  if (!teacher || teacher.access_level !== 'Teacher') return res.status(404).json({ error: "Teacher not found" });

  // Get classes assigned to this teacher (ObjectId match)
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

  // Structure classes and subjects in academic format
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


// GET /api/teachers/:id/cbt-results?classId=...
router.get('/:id/cbt-results', teacherAuth, async (req, res) => {
  try {
    // Only allow a teacher to fetch their own results
    if (String(req.params.id) !== String(req.staff._id)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Find all classes assigned to this teacher
    const classes = await Class.find({ teachers: req.staff._id });
    const classIds = classes.map(c => String(c._id));

    let query = {};
    if (req.query.classId) {
      // Only allow for classes assigned to this teacher!
      if (!classIds.includes(req.query.classId)) {
        return res.status(403).json({ error: "Not assigned to this class" });
      }
      query.class = req.query.classId;
    } else {
      // All classes for this teacher
      query.class = { $in: classIds };
    }

    // Fetch all CBT Results for the classes
    const results = await ResultCBT.find(query)
      .populate('student', 'firstname surname')
      .populate('class', 'name')
      .populate('exam', 'title')
      .sort({ createdAt: -1 });

    // Format results for UI
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
    res.status(500).json({ error: err.message });
  }
});

// GET /api/teachers/:id/cbt-results/:resultId
router.get('/:id/cbt-results/:resultId', teacherAuth, async (req, res) => {
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
    res.status(500).json({ error: err.message });
  }
});
// PATCH /api/teachers/me - Update own profile
router.patch('/me', teacherAuth, async (req, res) => {
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

// GET /api/teachers - List all teachers (for assignments or admin)
router.get('/', async (req, res) => {
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

// --- TEACHER CLASSES ---
// GET /api/teachers/classes - Classes assigned to logged-in teacher
router.get('/classes', teacherAuth, async (req, res) => {
  const classes = await Class.find({ teachers: req.staff._id });
  res.json(classes.map(cls => ({
    id: cls._id,
    name: cls.name,
    arms: cls.arms
  })));
});

// --- TEACHER SUBJECTS (per class) ---
router.get('/subjects', teacherAuth, async (req, res) => {
  const { classId } = req.query;
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
  if (!classId) return res.status(400).json({ error: "classId is required" });

  // Find the class by ObjectId
  const cls = await Class.findById(classId);
  if (!cls) return res.status(404).json({ error: "Class not found" });

  // Find students by class name (string)
  const students = await Student.find({ class: cls.name });
  res.json(students.map(stu => ({
    id: stu._id,
    name: `${stu.firstname} ${stu.surname}`,
    regNo: stu.regNo,
    email: stu.studentEmail
  })));
});

// GET /api/teachers/:id/assignments
router.get('/:id/assignments', teacherAuth, async (req, res) => {
  try {
    const assignments = await Assignment.find({ teacher: req.params.id })
      .populate({ path: 'class', select: 'name' }) // ensures .class.name is available
      .sort({ dueDate: 1 });
    res.json({ assignments });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/teachers/:id/assignments
router.post('/:id/assignments', teacherAuth, async (req, res) => {
  try {
    const { class: classId, subject, title, description, dueDate, cbt } = req.body;
    const assignment = new Assignment({
      teacher: req.params.id,
      class: classId,
      subject,
      title,
      description,
      dueDate,
      cbt // <-- attach CBT here!
    });
    await assignment.save();
    await assignment.populate({ path: 'class', select: 'name' });
    res.status(201).json({ assignment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// --- NOTIFICATIONS ---
// GET /api/teachers/:id/notifications
router.get('/:id/notifications', teacherAuth, async (req, res) => {
  try {
    const notifications = await Notification.find({ teacher: req.params.id }).sort({ date: -1 });
    res.json({ notifications });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- DRAFT RESULTS ---
// GET /api/teachers/:id/draft-results
router.get('/:id/draft-results', teacherAuth, async (req, res) => {
  try {
    const draftResults = await DraftResult.find({ teacher: req.params.id });
    res.json({ draftResults });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/teachers/:id/draft-results
router.post('/:id/draft-results', teacherAuth, async (req, res) => {
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
    res.status(500).json({ error: err.message });
  }
});
router.post('/classes/:classId/subjects', teacherAuth, async (req, res) => {
  const { classId } = req.params;
  const { subjectName } = req.body;
  // Find or create subject
  let subject = await Subject.findOne({ name: subjectName });
  if (!subject) {
    subject = new Subject({ name: subjectName });
    await subject.save();
  }
  const cls = await Class.findById(classId);
  // Prevent duplicate subject assignment
  let justAdded = null;
  if (!cls.subjects.some(s => String(s.subject) === String(subject._id) && String(s.teacher) === String(req.staff._id))) {
    cls.subjects.push({ subject: subject._id, teacher: req.staff._id });
    await cls.save();
    justAdded = { subject: subject._id, teacher: req.staff._id };
  }
  // Populate the subject for the response
  await cls.populate([
    { path: 'subjects.subject', model: 'Subject' },
    { path: 'subjects.teacher', model: 'Staff', select: 'first_name last_name email' }
  ]);
  // Find the just-added subject-teacher pair
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

// PATCH /api/teachers/:id/assignments/:assignmentId - Update assignment
router.patch('/:id/assignments/:assignmentId', teacherAuth, async (req, res) => {
  try {
    const assignment = await Assignment.findOneAndUpdate(
      { _id: req.params.assignmentId, teacher: req.params.id },
      req.body,
      { new: true }
    );
    if (!assignment) return res.status(404).json({ error: "Assignment not found or not owned by teacher." });
    res.json({ success: true, assignment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/teachers/:id/assignments/:assignmentId - Delete assignment
router.delete('/:id/assignments/:assignmentId', teacherAuth, async (req, res) => {
  try {
    const assignment = await Assignment.findOneAndDelete({ _id: req.params.assignmentId, teacher: req.params.id });
    if (!assignment) return res.status(404).json({ error: "Assignment not found or not owned by teacher." });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/teachers/:id/notifications/:notificationId - Delete notification
router.delete('/:id/notifications/:notificationId', teacherAuth, async (req, res) => {
  try {
    const notification = await Notification.findOneAndDelete({ _id: req.params.notificationId, teacher: req.params.id });
    if (!notification) return res.status(404).json({ error: "Notification not found or not owned by teacher." });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// POST /api/teachers/:id/cbt - Upload new CBT
router.post('/:id/cbt', teacherAuth, async (req, res) => {
  try {
    if (String(req.params.id) !== String(req.staff._id)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { class: classId, subject, title, duration, questions } = req.body;
    const cbt = new CBT({
      teacher: req.staff._id, // <--- use the authenticated teacher's ID only
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
    res.status(500).json({ error: err.message });
  }
});

// GET /api/teachers/:id/cbt - List CBTs uploaded by teacher
router.get('/:id/cbt', teacherAuth, async (req, res) => {
  try {
    if (String(req.params.id) !== String(req.staff._id)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const cbts = await CBT.find({ teacher: req.staff._id }) // <--- use the authenticated teacher's ID only
      .populate('class', 'name')
      .populate('subject', 'name');
    res.json({ cbts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.get('/cbt/:cbtId', teacherAuth, async (req, res) => {
  try {
    const cbt = await CBT.findById(req.params.cbtId)
      .populate('class', 'name')
      .populate('subject', 'name');
    if (!cbt) return res.status(404).json({ error: "CBT not found" });
    res.json({ cbt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// GET /api/teachers/:id/cbt/:cbtId - Get a specific CBT uploaded by teacher
router.get('/:id/cbt/:cbtId', teacherAuth, async (req, res) => {
  try {
    const cbt = await CBT.findOne({ _id: req.params.cbtId, teacher: req.params.id })
      .populate('class', 'name')
      .populate('subject', 'name');
    if (!cbt) return res.status(404).json({ error: "CBT not found or not owned by teacher." });
    res.json({ cbt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// DELETE /api/teachers/:id/cbt/:cbtId - Delete a CBT uploaded by teacher
router.delete('/:id/cbt/:cbtId', teacherAuth, async (req, res) => {
  try {
    // Only allow delete if this teacher owns the CBT
    const cbt = await CBT.findOneAndDelete({ _id: req.params.cbtId, teacher: req.params.id });
    if (!cbt) return res.status(404).json({ error: "CBT not found or not owned by teacher." });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// PATCH /api/teachers/:id/cbt/:cbtId - Update a CBT uploaded by teacher
router.patch('/:id/cbt/:cbtId', teacherAuth, async (req, res) => {
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
    res.status(500).json({ error: err.message });
  }
});
// POST /api/teachers/:id/cbt/push
router.post('/:id/cbt/push', teacherAuth, async (req, res) => {
  try {
    // Accepts: { cbtIds: [ ... ] }
    const { cbtIds } = req.body;
    if (!Array.isArray(cbtIds) || !cbtIds.length) {
      return res.status(400).json({ error: "cbtIds array is required" });
    }
    const cbts = await CBT.find({ _id: { $in: cbtIds }, teacher: req.params.id });
    if (!cbts.length) return res.status(404).json({ error: "No CBTs found" });

    // For each CBT, create a new Exam entry (universal document)
    let pushed = [];
    for (const cbt of cbts) {
      const exam = new Exam({
        title: cbt.title,
        class: cbt.class, // make sure this matches Exam model's expectations
        subject: cbt.subject,
        duration: cbt.duration,
        questions: cbt.questions
      });
      await exam.save();
      pushed.push(exam._id);
    }
    res.json({ success: true, pushed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// GET /api/teachers/:id/collections - Get all question bank collections for teacher
router.get('/:id/collections', teacherAuth, async (req, res) => {
  try {
    if (String(req.params.id) !== String(req.staff._id)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    // Assuming you have a Collection model, fetch all collections for this teacher
    const collections = await Collection.find({ teacher: req.staff._id })
      .populate('questions');
    res.json({ collections });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/teachers/:id/collections - Create new collection
router.post('/:id/collections', teacherAuth, async (req, res) => {
  try {
    if (String(req.params.id) !== String(req.staff._id)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { name } = req.body;
    const collection = new Collection({
      teacher: req.staff._id,
      name,
      questions: []
    });
    await collection.save();
    res.status(201).json({ collection });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/teachers/:id/collections/:collectionId/questions - Add question to collection
router.post('/:id/collections/:collectionId/questions', teacherAuth, async (req, res) => {
  try {
    if (String(req.params.id) !== String(req.staff._id)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { text, options, imageUrl, explanation } = req.body;
    const collection = await Collection.findById(req.params.collectionId);
    if (!collection) return res.status(404).json({ error: "Collection not found" });
    
    const question = {
      id: `question_${Date.now()}`,
      text,
      options,
      imageUrl,
      explanation
    };
    collection.questions.push(question);
    await collection.save();
    res.status(201).json({ question });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/teachers/:id/collections/:collectionId - Delete collection
router.delete('/:id/collections/:collectionId', teacherAuth, async (req, res) => {
  try {
    if (String(req.params.id) !== String(req.staff._id)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    await Collection.findByIdAndDelete(req.params.collectionId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/teachers/:id/collections/:collectionId/questions/:questionId
router.delete('/:id/collections/:collectionId/questions/:questionId', teacherAuth, async (req, res) => {
  try {
    if (String(req.params.id) !== String(req.staff._id)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const collection = await Collection.findById(req.params.collectionId);
    collection.questions = collection.questions.filter(q => q.id !== req.params.questionId);
    await collection.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
/* Note: For student update/delete, those should be in the students.js route file. */

module.exports = router;
