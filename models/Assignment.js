const mongoose = require('mongoose');

const AssignmentSchema = new mongoose.Schema({
  title: { type: String, required: true },

  description: {
    type: String,
    default: ""
  },

  type: {
    type: String,
    enum: ['STANDARD', 'QUESTION_BANK'],
    default: 'STANDARD'
  },

  questionsAllocated: [{
    type: String
  }],

  cbt: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Exam',
    required: false
  },

  subject: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Subject',
    required: true
  },

  assignedTo: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Student'
  }],

  class: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Class',
    required: true
  },

  teacher: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Staff',
    required: true
  },

  files: [{
    url: String,
    name: String
  }],

  dueDate: {
    type: Date,
    required: true
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Staff'
  }

}, { timestamps: true });

module.exports = mongoose.model('Assignment', AssignmentSchema);
