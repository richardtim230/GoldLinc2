const mongoose = require('mongoose');

const AssignmentSubmissionSchema = new mongoose.Schema({
  assignment: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment', required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  submissionFile: { url: String, name: String },
  // Store student answers as an array (question index = array index)
  answers: {
    type: [mongoose.Schema.Types.Mixed],
    default: []
  },
  submittedAt: { type: Date, default: Date.now },
  status: { type: String, enum: ['Pending', 'Submitted', 'Reviewed', 'Overdue'], default: 'Submitted' },
  score: { type: Number },
  totalScore: { type: Number },
  feedback: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('AssignmentSubmission', AssignmentSubmissionSchema);
