import { Class, Subject, User, StudentProfile, Organization, District, Task, Submission } from '../database.js';
import sequelize from '../database.js';
import { Op } from 'sequelize';
import NotificationService from '../services/NotificationService.js';

// Build a clean uppercase slug from a string: "Kigali School" -> "KIGALISCHOOL"
function slugify(str) {
  return str.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 8);
}

class ClassController {
  // Create class/department
  async createClass(req, res) {
    try {
      const { name, description, manager_id, type, academic_year, semester, max_students } = req.body;
      const organization_id = req.user.organization_id;

      // Load org + district to build the unique code
      const org = await Organization.findByPk(organization_id, {
        include: [{ model: (await import('../models/District.js')).default, as: 'district' }]
        
      });

      const districtCode = org?.district?.code || 'RW';
      const orgSlug      = slugify(org?.name || 'ORG');
      const year         = new Date().getFullYear();
      const classSlug    = slugify(name);
      const code         = `${districtCode}-${orgSlug}-${year}-${classSlug}`.substring(0, 50);

      // If manager_id provided, verify it — otherwise default to the creator
      let resolvedManagerId = req.user.id;
      if (manager_id) {
        const manager = await User.findOne({
          where: { id: manager_id, organization_id, role: { [Op.in]: ['teacher', 'organization_admin', 'worker'] } }
        });
        if (!manager) {
          return res.status(400).json({ success: false, message: 'Invalid manager. Must be a teacher or admin in this organization.' });
        }
        resolvedManagerId = manager_id;
      }

      const existing = await Class.findOne({ where: { code, organization_id } });
      if (existing) {
        return res.status(409).json({ success: false, message: 'A class with this name already exists in your organization this year.' });
      }

      const cls = await Class.create({
        name, code, description,
        manager_id: resolvedManagerId,
        type: type || 'class',
        academic_year: academic_year || null,
        semester: semester || '1',
        max_students: max_students || 50,
        organization_id
      });

      const created = await Class.findByPk(cls.id, {
        include: [{ model: User, as: 'manager', attributes: ['id', 'name', 'email', 'role'] }]
      });

      await NotificationService.createNotification(req.user.id, organization_id, 'CREATE', `Created new ${type}: ${name}`, { class_id: cls.id, type }, 'success');

      res.status(201).json({ success: true, message: 'Class created successfully', data: created });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to create class', error: error.message });
    }
  }

  // Get all classes in organization
  async getClasses(req, res) {
    try {
      const { type, status, page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;

      const where = { organization_id: req.user.organization_id };
      if (type) where.type = type;
      if (status) where.status = status;

      // Teachers only see their managed classes
      if (req.user.role === 'teacher') {
        where.manager_id = req.user.id;
      }

      // Students only see their enrolled class
      if (['student', 'intern'].includes(req.user.role)) {
        const profile = await StudentProfile.findOne({ where: { user_id: req.user.id } });
        if (profile) where.id = profile.class_id;
      }

      const { count, rows } = await Class.findAndCountAll({
        where,
        include: [
          { model: User, as: 'manager', attributes: ['id', 'name', 'email'] },
          { model: Subject, as: 'subjects', required: false, attributes: ['id', 'name', 'code'] }
        ],
        limit: parseInt(limit),
        offset: parseInt(offset),
        order: [['created_at', 'DESC']]
      });

      res.json({
        success: true,
        data: rows,
        pagination: { total: count, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(count / limit) }
      });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to fetch classes', error: error.message });
    }
  }

  // Get class details with students and tasks
  async getClass(req, res) {
    try {
      const cls = await Class.findOne({
        where: { id: req.params.id, organization_id: req.user.organization_id },
        include: [
          { model: User, as: 'manager', attributes: ['id', 'name', 'email'] },
          { model: Subject, as: 'subjects', include: [{ model: User, as: 'teacher', attributes: ['id', 'name'] }] },
          {
            model: StudentProfile, as: 'students',
            include: [{ model: User, as: 'user', attributes: ['id', 'name', 'email', 'status'] }]
          },
          {
            model: Task, as: 'tasks',
            where: { status: 'published' },
            required: false,
            attributes: ['id', 'title', 'due_date', 'priority', 'status', 'total_submissions']
          }
        ]
      });

      if (!cls) return res.status(404).json({ success: false, message: 'Class not found' });

      res.json({ success: true, data: cls });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to fetch class', error: error.message });
    }
  }

  // Update class
  async updateClass(req, res) {
    try {
      const { name, description, manager_id, status, max_students, schedule } = req.body;

      const cls = await Class.findOne({
        where: { id: req.params.id, organization_id: req.user.organization_id }
      });

      if (!cls) return res.status(404).json({ success: false, message: 'Class not found' });

      if (manager_id) {
        const manager = await User.findOne({
          where: { id: manager_id, organization_id: req.user.organization_id }
        });
        if (!manager) return res.status(400).json({ success: false, message: 'Invalid manager' });
      }

      await cls.update({ name, description, manager_id, status, max_students, schedule });

      await NotificationService.createNotification(req.user.id, req.user.organization_id, 'UPDATE', `Updated ${cls.type}: ${name}`, { class_id: cls.id }, 'info');

      res.json({ success: true, message: 'Class updated successfully', data: cls });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to update class', error: error.message });
    }
  }

  // Soft delete class
  async deleteClass(req, res) {
    try {
      const cls = await Class.findOne({
        where: { id: req.params.id, organization_id: req.user.organization_id }
      });

      if (!cls) return res.status(404).json({ success: false, message: 'Class not found' });

      await cls.destroy();
      await NotificationService.createNotification(req.user.id, req.user.organization_id, 'DELETE', `Deleted ${cls.type}: ${cls.name}`, { class_id: cls.id }, 'warning');
      res.json({ success: true, message: 'Class deleted successfully' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to delete class', error: error.message });
    }
  }

  // Create subject in a class
  async createSubject(req, res) {
    try {
      const { name, code, description, teacher_id, credits, hours_per_week, syllabus } = req.body;
      const class_id = req.params.id;

      const cls = await Class.findOne({
        where: { id: class_id, organization_id: req.user.organization_id }
      });
      if (!cls) return res.status(404).json({ success: false, message: 'Class not found' });

      const teacher = await User.findOne({
        where: { id: teacher_id, organization_id: req.user.organization_id, role: 'teacher' }
      });
      if (!teacher) return res.status(400).json({ success: false, message: 'Invalid teacher' });

      const existing = await Subject.findOne({ where: { code, class_id } });
      if (existing) return res.status(409).json({ success: false, message: 'Subject code already exists in this class' });

      const subject = await Subject.create({
        name, code, description, class_id, teacher_id,
        credits: credits || 1,
        hours_per_week: hours_per_week || 1,
        syllabus
      });

      await NotificationService.createNotification(req.user.id, req.user.organization_id, 'CREATE', `Created subject: ${name} in ${cls.name}`, { subject_id: subject.id, class_id }, 'success');

      res.status(201).json({ success: true, message: 'Subject created successfully', data: subject });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to create subject', error: error.message });
    }
  }

  // Add student to class
  async addStudent(req, res) {
    try {
      const { student_id } = req.body; // user id of the student
      const class_id = req.params.id;
      const organization_id = req.user.organization_id;

      const cls = await Class.findOne({ where: { id: class_id, organization_id } });
      if (!cls) return res.status(404).json({ success: false, message: 'Class not found' });

      // Org admins can add to any class, teachers can add to any class in their org
      // No restriction on which teacher can add students

      const student = await User.findOne({
        where: { id: student_id, organization_id, role: { [Op.in]: ['student', 'intern'] } }
      });
      if (!student) return res.status(404).json({ success: false, message: 'Student not found in this organization' });

      const profile = await StudentProfile.findOne({ where: { user_id: student_id } });
      if (!profile) return res.status(404).json({ success: false, message: 'Student profile not found' });

      if (profile.class_id === parseInt(class_id)) {
        return res.status(409).json({ success: false, message: 'Student is already in this class' });
      }

      const oldClassId = profile.class_id;
      await profile.update({ class_id: parseInt(class_id) });

      // Update student counts
      await Class.increment('current_students', { where: { id: class_id } });
      if (oldClassId) await Class.decrement('current_students', { where: { id: oldClassId } });

      res.json({ success: true, message: `${student.name} added to class` });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to add student', error: error.message });
    }
  }

  // Remove student from class
  async removeStudent(req, res) {
    try {
      const class_id = req.params.id;
      const student_id = req.params.studentId;
      const organization_id = req.user.organization_id;

      const cls = await Class.findOne({ where: { id: class_id, organization_id } });
      if (!cls) return res.status(404).json({ success: false, message: 'Class not found' });

      if (req.user.role === 'teacher' && cls.manager_id !== req.user.id) {
        return res.status(403).json({ success: false, message: 'Only the class teacher can remove students' });
      }

      const profile = await StudentProfile.findOne({
        where: { user_id: student_id, class_id: parseInt(class_id) }
      });
      if (!profile) return res.status(404).json({ success: false, message: 'Student not in this class' });

      await profile.update({ class_id: null });
      await Class.decrement('current_students', { where: { id: class_id } });

      res.json({ success: true, message: 'Student removed from class' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to remove student', error: error.message });
    }
  }

  // Get class performance stats
  async getClassStats(req, res) {
    try {
      const cls = await Class.findOne({
        where: { id: req.params.id, organization_id: req.user.organization_id }
      });
      if (!cls) return res.status(404).json({ success: false, message: 'Class not found' });

      const [totalStudents, totalTasks, submissions] = await Promise.all([
        StudentProfile.count({ where: { class_id: cls.id } }),
        Task.count({ where: { class_id: cls.id, status: 'published' } }),
        Submission.findAll({
          include: [{ model: Task, as: 'task', where: { class_id: cls.id }, attributes: [] }],
          attributes: ['status', [sequelize.fn('COUNT', sequelize.col('Submission.id')), 'count']],
          group: ['status'],
          raw: true
        })
      ]);

      const submissionMap = {};
      submissions.forEach(s => { submissionMap[s.status] = parseInt(s.count); });

      res.json({
        success: true,
        data: {
          class: { id: cls.id, name: cls.name, code: cls.code },
          total_students: totalStudents,
          total_tasks: totalTasks,
          submissions: submissionMap,
          completion_rate: totalStudents && totalTasks
            ? Math.round(((submissionMap.submitted || 0) + (submissionMap.graded || 0)) / (totalStudents * totalTasks) * 100)
            : 0
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to fetch class stats', error: error.message });
    }
  }
}

export default new ClassController();
