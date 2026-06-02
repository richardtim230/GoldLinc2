
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
const Result = require('../models/Result');
const teacherAuth = require('../middleware/teacherAuth'); // Should set req.staff
const ResultCBT = require('../models/ResultCBT');
const CBT = require('../models/CBTExam'); // If your results reference Exam
const Collection = require('../models/Collection');
const AssignmentSubmission = require('../models/AssignmentSubmission');
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

// In routes/teachers.js - should look like this:
router.get('/students', teacherAuth, async (req, res) => {
  const { classId } = req.query;
  if (!classId) return res.status(400).json({ error: "classId is required" });

  const cls = await Class.findById(classId);
  if (!cls) return res.status(404).json({ error: "Class not found" });

  const students = await Student.find({ class: cls.name });
  res.json(students.map(stu => ({
    _id: stu._id,              // ← Make sure this is included
    id: stu._id,               // Also include as 'id' for compatibility
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
    const { class: classId, subject, title, description, dueDate, cbt, type, questionsAllocated } = req.body;
    const assignment = new Assignment({
      teacher: req.params.id,
      class: classId,
      subject,
      title,
      description,
      dueDate,
      cbt,
      type: type || 'STANDARD',
      questionsAllocated: questionsAllocated || []
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
/**
 * GET: Teacher fetch their uploaded results filtered by class and student
 * GET /api/teacher/:id/results?class={classId}&student={studentId}
 * Used by gradebook to sync student results
 */
router.get('/:id/results', teacherAuth, async (req, res) => {
  try {
    const teacherId = req.params.id;
    const {
  class: classId,
  student: studentId,
  session: sessionId,
  term: termId
} = req.query;
    if (!classId || !studentId) {
      return res.status(400).json({ 
        error: 'Missing required query parameters: class and student',
        results: [] 
      });
    }

    // Query results by teacher (createdBy), class, and student
const query = {
  class: classId,
  student: studentId,
  session: sessionId,
  term: termId
};

    console.log('Teacher results query:', query);

    const results = await Result.find(query)
      .populate('student', 'name regNo student_id')
      .populate('subject', 'name')
      .populate('class', 'name')
      .populate('session', 'name')
      .populate('term', 'name')
      .sort({ createdAt: -1 });

    console.log(`Found ${results.length} results for query:`, query);

    if (!results.length) {
      return res.status(404).json({ 
        error: `No results found for this student in class ${classId}`,
        results: [] 
      });
    }

    // Transform results to expose all score fields
    const transformedResults = results.map(r => ({
      _id: r._id,
      student: r.student,
      subject: r.subject,
      class: r.class,
      session: r.session,
      term: r.term,
      ca1_score: r.ca1_score || 0,
      ca2_score: r.ca2_score || 0,
      midterm_score: r.midterm_score || 0,
      exam_score: r.exam_score || 0,
      score: r.score || 0,
      grade: r.grade || '',
      remarks: r.remarks || '',
      status: r.status,
      createdAt: r.createdAt
    }));

    res.json({ 
      results: transformedResults,
      count: transformedResults.length
    });

  } catch (err) {
    console.error('Error fetching teacher results:', err);
    res.status(500).json({ 
      error: err.message,
      results: [] 
    });
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
// PATCH /api/teachers/:id/collections/:collectionId - Update collection metadata
router.patch('/:id/collections/:collectionId', teacherAuth, async (req, res) => {
  try {
    if (String(req.params.id) !== String(req.staff._id)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { name, description, class: classId, subject: subjectId } = req.body;

    const collection = await Collection.findById(req.params.collectionId);
    if (!collection) return res.status(404).json({ error: "Collection not found" });
    if (String(collection.teacher) !== String(req.staff._id)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (name !== undefined) collection.name = name;
    if (description !== undefined) collection.description = description;
    if (classId !== undefined) collection.class = classId;
    if (subjectId !== undefined) collection.subject = subjectId;

    await collection.save();
    res.json({ success: true, collection });
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
// POST /api/teachers/:id/attendance - Save daily attendance for a class
router.post('/:id/attendance', teacherAuth, async (req, res) => {
  try {
    if (String(req.params.id) !== String(req.staff._id)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { classId, date, attendance } = req.body;

    if (!classId || !date || !attendance || Object.keys(attendance).length === 0) {
      return res.status(400).json({ 
        error: "classId, date, and attendance object are required" 
      });
    }

    // Verify teacher has access to this class
    const cls = await Class.findOne({ 
      _id: classId, 
      teachers: req.staff._id 
    });

    if (!cls) {
      return res.status(403).json({ 
        error: "Not assigned to this class" 
      });
    }

    // Get students for this class
    const students = await Student.find({ class: cls.name });
    const studentMap = new Map(students.map(s => [String(s._id), s]));

    // Create attendance records for each student
    const AttendanceRecord = require('../models/AttendanceRecord');
    const records = [];

    for (const [studentId, status] of Object.entries(attendance)) {
      const student = studentMap.get(studentId);
      
      if (!student) {
        console.warn(`Student ${studentId} not found`);
        continue;
      }

      // Check if record already exists for this date
      let record = await AttendanceRecord.findOne({
        userId: studentId,
        date: new Date(date),
        class: cls.name
      });

      if (record) {
        // Update existing record
        record.status = status;
        record.recordedBy = req.staff._id;
      } else {
        // Create new record
        record = new AttendanceRecord({
          date: new Date(date),
          userId: studentId,
          name: `${student.firstname} ${student.surname}`,
          role: 'student',
          class: cls.name,
          status: status,
          recordedBy: req.staff._id
        });
      }

      await record.save();
      records.push(record);
    }

    res.json({
      success: true,
      message: `Attendance saved for ${records.length} students`,
      classId: classId,
      date: date,
      recordsCount: records.length
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/teachers/:id/attendance - Get attendance records for a class
router.get('/:id/attendance', teacherAuth, async (req, res) => {
  try {
    if (String(req.params.id) !== String(req.staff._id)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { classId, date } = req.query;

    if (!classId) {
      return res.status(400).json({ error: "classId is required" });
    }

    // Verify teacher has access to this class
    const cls = await Class.findOne({ 
      _id: classId, 
      teachers: req.staff._id 
    });

    if (!cls) {
      return res.status(403).json({ 
        error: "Not assigned to this class" 
      });
    }

    const AttendanceRecord = require('../models/AttendanceRecord');
    let query = {
      class: cls.name,
      role: 'student'
    };

    if (date) {
      const dateObj = new Date(date);
      const nextDay = new Date(dateObj);
      nextDay.setDate(nextDay.getDate() + 1);
      
      query.date = {
        $gte: dateObj,
        $lt: nextDay
      };
    }

    const records = await AttendanceRecord.find(query).sort({ createdAt: -1 });

    // Group by date
    const grouped = {};
    records.forEach(record => {
      const dateKey = record.date.toISOString().split('T')[0];
      if (!grouped[dateKey]) {
        grouped[dateKey] = [];
      }
      grouped[dateKey].push({
        studentId: record.userId,
        name: record.name,
        status: record.status,
        date: record.date,
        recordedAt: record.createdAt
      });
    });

    res.json({
      classId: classId,
      className: cls.name,
      records: grouped
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// === UNIFIED QUESTION BANK ENDPOINT - Fetch from BOTH CBT & Collection models ===
// GET /api/teachers/:id/question-bank - Get ALL questions from both CBT documents and Collection model
router.get('/:id/question-bank', teacherAuth, async (req, res) => {
  try {
    if (String(req.params.id) !== String(req.staff._id)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Fetch from Collections (new model)
    const collections = await Collection.find({ teacher: req.staff._id }).sort({ createdAt: -1 });

    // Fetch from CBT documents (legacy - for migration)
    const cbts = await CBT.find({ teacher: req.staff._id }).sort({ createdAt: -1 });

    // Transform CBT documents into collection format for legacy data
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
      isMigrated: false, // Mark as legacy/not migrated
      source: 'CBT'
    }));

    // Combine both sources - new collections first, then legacy CBT
    const allQuestionBanks = [
      ...collections.map(c => ({ 
        ...c.toObject(), 
        isMigrated: true,
        source: 'Collection'
      })),
      ...legacyCBTCollections
    ];

    res.json({ questionBanks: allQuestionBanks });
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

// GET /api/teachers/:id/cbt - List CBTs uploaded by teacher
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
// GET /api/teachers/:id/assignments/:assignmentId/submissions
router.get(
  '/:id/assignments/:assignmentId/submissions',
  teacherAuth,
  async (req, res) => {
    try {

      if (String(req.params.id) !== String(req.staff._id)) {
        return res.status(403).json({
          error: 'Forbidden'
        });
      }

      const assignment = await Assignment.findById(
        req.params.assignmentId
      );

      if (!assignment) {
        return res.status(404).json({
          error: 'Assignment not found'
        });
      }

      if (
        String(assignment.teacher) !==
        String(req.staff._id)
      ) {
        return res.status(403).json({
          error: 'Forbidden'
        });
      }

      const submissions =
        await AssignmentSubmission.find({
          assignment: req.params.assignmentId
        })
          .populate(
            'student',
            'firstname surname regNo studentEmail'
          )
          .sort({
            submittedAt: -1
          });

      const formatted =
        submissions.map(sub => ({
          _id: sub._id,
          studentId: sub.student?._id,
          studentName: sub.student
            ? `${sub.student.firstname} ${sub.student.surname}`
            : 'Unknown Student',
          regNo: sub.student?.regNo || '',
          email:
            sub.student?.studentEmail || '',
          status: sub.status,
          score: sub.score,
          totalScore: sub.totalScore,
          feedback: sub.feedback,
          submittedAt: sub.submittedAt,
          submissionFile:
            sub.submissionFile || null
        }));

      res.json({
        submissions: formatted
      });

    } catch (err) {

      res.status(500).json({
        error: err.message
      });

    }
  }
);
// ✅ FIXED: POST /api/teachers/:id/collections/:collectionId/convert-to-cbt
// Convert collection to CBT format and return the CBT ID
router.post('/:id/collections/:collectionId/convert-to-cbt', teacherAuth, async (req, res) => {
  try {
    if (String(req.params.id) !== String(req.staff._id)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Find the collection
    const collection = await Collection.findById(req.params.collectionId);
    if (!collection) return res.status(404).json({ error: "Collection not found" });
    if (String(collection.teacher) !== String(req.staff._id)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Validate collection has required fields
    if (!collection.class) {
      return res.status(400).json({ error: "Collection must have a class assigned" });
    }
    if (!collection.subject) {
      return res.status(400).json({ error: "Collection must have a subject assigned" });
    }

    // ✅ FIXED: Transform collection questions to CBT format
    // Collection has: { text, options: [{ text, isCorrect }], imageUrl, explanation }
    // CBT expects: { text, options: [{ value }], answer: index, imageUrl, explanation }
    const transformedQuestions = (collection.questions || []).map(q => {
      // Find index of correct answer
      const correctIndex = q.options.findIndex(opt => opt.isCorrect === true);
      
      return {
        text: q.text,
        options: q.options.map(opt => ({
          value: opt.text  // Map Collection's 'text' to CBT's 'value'
        })),
        answer: correctIndex >= 0 ? correctIndex : 0, // Single correct answer index
        imageUrl: q.imageUrl || null,
        explanation: q.explanation || null
      };
    });

    // Create new CBT document from collection
    const cbt = new CBT({
      teacher: req.staff._id,
      title: collection.name,
      class: collection.class,
      subject: collection.subject,
      duration: 60, // Default duration
      questions: transformedQuestions,
      status: 'Draft'
    });

    await cbt.save();
    
    res.json({ 
      success: true, 
      cbtId: cbt._id
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ✅ FIXED: POST /api/teachers/:id/collections/:collectionId/push - Push collection to CBT model
router.post('/:id/collections/:collectionId/push', teacherAuth, async (req, res) => {
  try {
    if (String(req.params.id) !== String(req.staff._id)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Find the collection
    const collection = await Collection.findById(req.params.collectionId);
    if (!collection) return res.status(404).json({ error: "Collection not found" });
    if (String(collection.teacher) !== String(req.staff._id)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Validate collection has required fields
    if (!collection.class) {
      return res.status(400).json({ error: "Collection must have a class assigned" });
    }
    if (!collection.subject) {
      return res.status(400).json({ error: "Collection must have a subject assigned" });
    }

    // ✅ FIXED: Transform collection questions to CBT format
    const transformedQuestions = (collection.questions || []).map(q => {
      // Find index of correct answer
      const correctIndex = q.options.findIndex(opt => opt.isCorrect === true);
      
      return {
        text: q.text,
        options: q.options.map(opt => ({
          value: opt.text  // Map Collection's 'text' to CBT's 'value'
        })),
        answer: correctIndex >= 0 ? correctIndex : 0, // Single correct answer index
        imageUrl: q.imageUrl || null,
        explanation: q.explanation || null
      };
    });

    // Create new CBT document from collection
    const cbt = new CBT({
      teacher: req.staff._id,
      title: collection.name,
      class: collection.class,
      subject: collection.subject,
      duration: 60, // Default duration
      questions: transformedQuestions,
      status: 'Draft'
    });

    await cbt.save();
    await cbt.populate([
      { path: 'class', select: 'name' },
      { path: 'subject', select: 'name' }
    ]);

    res.json({ 
      success: true, 
      message: `Collection "${collection.name}" successfully pushed to CBT Exam`,
      cbt 
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/teachers/:id/collections - Get only new Collection model data
router.get('/:id/collections', teacherAuth, async (req, res) => {
  try {
    if (String(req.params.id) !== String(req.staff._id)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const collections = await Collection.find({ teacher: req.staff._id }).sort({ createdAt: -1 });
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
    const { name, classId, subjectId, description } = req.body;
    if (!name) return res.status(400).json({ error: "Collection name is required" });

    const collection = new Collection({
      teacher: req.staff._id,
      name,
      class: classId || null,
      subject: subjectId || null,
      description: description || '',
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
    
    if (!text || !options || options.length === 0) {
      return res.status(400).json({ error: "Question text and options are required" });
    }

    const collection = await Collection.findById(req.params.collectionId);
    if (!collection) return res.status(404).json({ error: "Collection not found" });
    if (String(collection.teacher) !== String(req.staff._id)) {
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
    
    res.status(201).json({ question });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/teachers/:id/collections/:collectionId/questions/:questionId - Update question
router.patch('/:id/collections/:collectionId/questions/:questionId', teacherAuth, async (req, res) => {
  try {
    if (String(req.params.id) !== String(req.staff._id)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const { text, options, imageUrl, explanation } = req.body;

    const collection = await Collection.findById(req.params.collectionId);
    if (!collection) return res.status(404).json({ error: "Collection not found" });
    if (String(collection.teacher) !== String(req.staff._id)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const questionIndex = collection.questions.findIndex(q => q.id === req.params.questionId);
    if (questionIndex === -1) return res.status(404).json({ error: "Question not found" });

    if (text !== undefined) collection.questions[questionIndex].text = text;
    if (options !== undefined) collection.questions[questionIndex].options = options;
    if (imageUrl !== undefined) collection.questions[questionIndex].imageUrl = imageUrl;
    if (explanation !== undefined) collection.questions[questionIndex].explanation = explanation;

    await collection.save();
    res.json({ question: collection.questions[questionIndex] });
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
    const collection = await Collection.findByIdAndDelete(req.params.collectionId);
    if (!collection) return res.status(404).json({ error: "Collection not found" });
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
    if (!collection) return res.status(404).json({ error: "Collection not found" });
    if (String(collection.teacher) !== String(req.staff._id)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    collection.questions = collection.questions.filter(q => q.id !== req.params.questionId);
    await collection.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* Note: For student update/delete, those should be in the students.js route file. */

module.exports = router;
