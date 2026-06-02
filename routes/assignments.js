const express = require('express');
const router = express.Router();
const multer = require('multer');
const Assignment = require('../models/Assignment');
const AssignmentSubmission = require('../models/AssignmentSubmission');
const Student = require('../models/Student');
const studentAuth = require('../middleware/studentAuth');
const adminAuth = require('../middleware/adminAuth'); // if you have

const upload = multer({ storage: multer.memoryStorage() });

const mongoose = require('mongoose');
const Class = require('../models/Class'); // Assuming you have Class model

// --- Get assignments for logged-in student ---
router.get('/me', studentAuth, async (req, res) => {
  try {
    const studentId = req.student._id;
    const student = await Student.findById(studentId);

    let classValue = student.class;
    // If not ObjectId, treat as name
    if (!mongoose.Types.ObjectId.isValid(student.class)) {
      const classDoc = await Class.findOne({ name: student.class });
      if (!classDoc) return res.status(404).json({ error: 'Class not found for assignments' });
      classValue = classDoc._id;
    }

    const assignments = await Assignment.find({
  $or: [
    { assignedTo: studentId },
    { class: classValue }
  ]
}).populate('subject').populate('cbt'); 
    const submissions = await AssignmentSubmission.find({ student: studentId });
    const assignmentData = assignments.map(ass => {
      const submission = submissions.find(sub => sub.assignment.toString() === ass._id.toString());
      let status = "Pending", score, feedback, submissionFile, submitted = false, totalScore;
      if (submission) {
        status = submission.status || (submission.score !== undefined ? "Reviewed" : "Submitted");
        score = submission.score;
        totalScore = submission.totalScore;
        feedback = submission.feedback;
        submissionFile = submission.submissionFile?.url;
        submitted = true;
      }
      // Check overdue
      if (!submitted && new Date(ass.dueDate) < new Date()) status = "Overdue";
      // ... inside the assignmentData map in /me route
return {
  _id: ass._id,
  title: ass.title,
  description: ass.description,
  type: ass.type,
  questionsAllocated: ass.questionsAllocated,
  subject: ass.subject,
  dueDate: ass.dueDate,
  cbt: ass.cbt,
  status,
  score,
  totalScore,
  feedback,
  submissionFile,
  submitted
};
    });
    res.json(assignmentData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:assignmentId/submit', studentAuth, upload.single('file'), async (req, res) => {
  try {
    const { assignmentId } = req.params;
    const studentId = req.student._id;

    // Find the assignment to check if it is CBT
    const assignment = await Assignment.findById(assignmentId);

    // If not CBT, require a file
    if (!assignment.cbt && !req.file) {
      return res.status(400).json({ error: "No file uploaded." });
    }

    // Save file if present
    let fileMeta;
    if (req.file) {
      const fileUrl = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
      fileMeta = { url: fileUrl, name: req.file.originalname };
    }

    // Upsert submission
    let submission = await AssignmentSubmission.findOne({ assignment: assignmentId, student: studentId });
    if (submission) {
      if (fileMeta) submission.submissionFile = fileMeta;
      submission.status = 'Submitted';
      submission.submittedAt = new Date();
      await submission.save();
    } else {
      submission = await AssignmentSubmission.create({
        assignment: assignmentId,
        student: studentId,
        ...(fileMeta && { submissionFile: fileMeta }),
        status: 'Submitted'
      });
    }

    res.json({ message: 'Submission successful!' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- CRUD for assignments (admin/staff only) ---
// Create assignment
router.post('/', adminAuth, async (req, res) => {
  try {
    const data = req.body;
    const assignment = await Assignment.create(data);
    res.status(201).json(assignment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Read all assignments
router.get('/', adminAuth, async (req, res) => {
  try {
    const assignments = await Assignment.find().populate('subject');
    res.json(assignments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Read one assignment
router.get('/:id', adminAuth, async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.id).populate('subject');
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    res.json(assignment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update assignment
router.put('/:id', adminAuth, async (req, res) => {
  try {
    const assignment = await Assignment.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    res.json(assignment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete assignment
router.delete('/:id', adminAuth, async (req, res) => {
  try {
    await Assignment.findByIdAndDelete(req.params.id);
    res.json({ message: "Assignment deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
router.get('/:assignmentId/questions', studentAuth, async (req, res) => {
  try {
    const assignment = await Assignment.findById(req.params.assignmentId);

    if (!assignment) {
      return res.status(404).json({ error: 'Assignment not found' });
    }

    if (assignment.type !== 'QUESTION_BANK') {
      return res.status(400).json({ error: 'Not a question bank assignment' });
    }

    res.json({
      _id: assignment._id,
      title: assignment.title,
      questions: assignment.questionsAllocated || []
    });

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// --- Teacher/admin review student submission ---
router.post('/:assignmentId/review/:studentId', async (req, res) => {
  try {
    const { assignmentId, studentId } = req.params;
    const { score, feedback, totalScore } = req.body;
    const submission = await AssignmentSubmission.findOne({ assignment: assignmentId, student: studentId });
    if (!submission) return res.status(404).json({ error: "Submission not found" });
    submission.score = score;
    submission.feedback = feedback;
    submission.status = "Reviewed";
    if (totalScore) submission.totalScore = totalScore;
    await submission.save();
    res.json({ message: "Review saved" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
