const mongoose = require('mongoose');
const AttendanceRecordSchema = new mongoose.Schema({
  date: { type: Date, required: true },
  userId: { type: String, required: true }, // student_id, regNo, or staffId
  name: { type: String, required: true },
  role: { type: String, enum: ['student', 'teaching', 'non-teaching'], required: true },
  class: String, // for students
  department: String, // for staff
  status: { type: String, enum: ['EXCUSED', 'ABSENT', 'LATE', 'PRESENT', 'LEAVE'], required: true },
  remark: String,
  recordedBy: { type: String }, // admin/staff id or name
}, { timestamps: true });
module.exports = mongoose.model('AttendanceRecord', AttendanceRecordSchema);
