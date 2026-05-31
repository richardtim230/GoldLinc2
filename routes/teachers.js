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

// ============ NON-PARAMETERIZED ROUTES FIRST ============

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

// GET /api/teachers/classes - Classes assigned to logged-in teacher
router.get('/classes', teacherAuth, async (req, res) => {
  const classes = await Class.find({ teachers: req.staff._id });
  res.json(classes.map(cls => ({
    id: cls._id,
    name: cls.name,
    arms: cls.arms
  })));
});

// GET /api/teachers/subjects - Subjects per class
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

// GET /api/teachers/students - Students by class
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

// ============ SPECIFIC NON-PARAMETERIZED ROUTES (BEFORE /:id ROUTES) ============

// POST /api/teachers/classes/:classId/subjects
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

// GET /api/teachers/cbt/:cbtId (NO teacher ID in path)
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

// ============ OTHER /:id ROUTES ============

// GET /api/teachers/:id/cbt-results
router.get('/:id/cbt-results', teacherAuth, async (req, res) => {
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

// GET /api/teachers/:id/assignments
router.get('/:id/assignments', teacherAuth, async (req, res) => {
  try {
    const assignments = await Assignment.find({ teacher: req.params.id })
      .populate({ path: 'class', select: 'name' })
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
      cbt
    });
    await assignment.save();
    await assignment.populate({ path: 'class', select: 'name' });
    res.status(201).json({ assignment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/teachers/:id/assignments/:assignmentId
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

// DELETE /api/teachers/:id/assignments/:assignmentId
router.delete('/:id/assignments/:assignmentId', teacherAuth, async (req, res) => {
  try {
    const assignment = await Assignment.findOneAndDelete({ _id: req.params.assignmentId, teacher: req.params.id });
    if (!assignment) return res.status(404).json({ error: "Assignment not found or not owned by teacher." });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/teachers/:id/notifications
router.get('/:id/notifications', teacherAuth, async (req, res) => {
  try {
    const notifications = await Notification.find({ teacher: req.params.id }).sort({ date: -1 });
    res.json({ notifications });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/teachers/:id/notifications/:notificationId
router.delete('/:id/notifications/:notificationId', teacherAuth, async (req, res) => {
  try {
    const notification = await Notification.findOneAndDelete({ _id: req.params.notificationId, teacher: req.params.id });
    if (!notification) return res.status(404).json({ error: "Notification not found or not owned by teacher." });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

// POST /api/teachers/:id/cbt
router.post('/:id/cbt', teacherAuth, async (req, res) => {
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
    res.status(500).json({ error: err.message });
  }
});

// GET /api/teachers/:id/cbt
router.get('/:id/cbt', teacherAuth, async (req, res) => {
  try {
    if (String(req.params.id) !== String(req.staff._id)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const cbts = await CBT.find({ teacher: req.staff._id })
      .populate('class', 'name')
      .populate('subject', 'name');
    res.json({ cbts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/teachers/:id/cbt/:cbtId
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

// DELETE /api/teachers/:id/cbt/:cbtId
router.delete('/:id/cbt/:cbtId', teacherAuth, async (req, res) => {
  try {
    const cbt = await CBT.findOneAndDelete({ _id: req.params.cbtId, teacher: req.params.id });
    if (!cbt) return res.status(404).json({ error: "CBT not found or not owned by teacher." });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/teachers/:id/cbt/:cbtId
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
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
