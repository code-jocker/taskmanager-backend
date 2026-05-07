import { Task, Submission, User, Class, Subject, StudentProfile, Reminder } from '../database.js';
import sequelize from '../database.js';
import { Op } from 'sequelize';
import { getFileUrl } from '../services/FileUploadService.js';
import EmailService from '../services/EmailService.js';

class TaskController {
  // Create task
  async createTask(req, res) {
    try {
      const {
        title, description, instructions, due_date, class_id, subject_id,
        priority, type, max_score, submission_type, late_submission_allowed,
        late_penalty_percentage, group_task, max_group_size, allowed_file_types, rubric
      } = req.body;

      // Verify class belongs to organization
      if (class_id) {
        const cls = await Class.findOne({
          where: { id: class_id, organization_id: req.user.organization_id }
        });
        if (!cls) return res.status(400).json({ success: false, message: 'Invalid class' });
      }

      const task = await Task.create({
        title, description, instructions, due_date,
        class_id, subject_id,
        priority: priority || 'medium',
        type: type || 'assignment',
        max_score: max_score || 100,
        submission_type: submission_type || 'both',
        late_submission_allowed: late_submission_allowed !== false,
        late_penalty_percentage: late_penalty_percentage || 10,
        group_task: group_task || false,
        max_group_size: max_group_size || 1,
        allowed_file_types: allowed_file_types || ['pdf', 'doc', 'docx'],
        rubric,
        created_by: req.user.id,
        status: 'draft'
      });

      // Auto-publish task for teachers (immediate visibility to students)
      if (req.user.role === 'teacher') {
        await task.update({ status: 'published', published_at: new Date() });

        // Notify students in the class
        if (task.class_id) {
          const students = await StudentProfile.findAll({
            where: { class_id: task.class_id },
            include: [{ model: User, as: 'user', where: { status: 'active' } }]
          });

          for (const profile of students) {
            try {
              await EmailService.sendTaskAssigned(profile.user, task);
            } catch (err) {
              console.error(`Email failed for ${profile.user.email}:`, err.message);
            }
          }
        }
      }

      const statusMessage = req.user.role === 'teacher' ? 'Task created and published' : 'Task created as draft';
      res.status(201).json({ success: true, message: statusMessage, data: task });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to create task', error: error.message });
    }
  }

  // Publish task (sends notifications to students)
  async publishTask(req, res) {
    try {
      const task = await Task.findOne({
        where: { id: req.params.id, created_by: req.user.id },
        include: [{ model: Class, as: 'class' }]
      });

      if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
      if (task.status !== 'draft') return res.status(400).json({ success: false, message: 'Task is already published' });

      await task.update({ status: 'published', published_at: new Date() });

      // Notify students in the class
      if (task.class_id) {
        const students = await StudentProfile.findAll({
          where: { class_id: task.class_id },
          include: [{ model: User, as: 'user', where: { status: 'active' } }]
        });

        for (const profile of students) {
          try {
            await EmailService.sendTaskAssigned(profile.user, task);
          } catch (err) {
            console.error(`Email failed for ${profile.user.email}:`, err.message);
          }
        }
      }

      res.json({ success: true, message: 'Task published and students notified', data: task });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to publish task', error: error.message });
    }
  }

  // Get tasks (role-aware)
  async getTasks(req, res) {
    try {
      const { status, class_id, priority, type, page = 1, limit = 20 } = req.query;
      const offset = (page - 1) * limit;

      const where = {};
      if (status) where.status = status;
      if (class_id) where.class_id = class_id;
      if (priority) where.priority = priority;
      if (type) where.type = type;

      // Teachers see only their tasks
      if (req.user.role === 'teacher') {
        where.created_by = req.user.id;
      }

      // Students see tasks for their class
      if (['student', 'intern'].includes(req.user.role)) {
        const profile = await StudentProfile.findOne({ where: { user_id: req.user.id } });
        if (profile) where.class_id = profile.class_id;
        where.status = 'published';
      }

      const { count, rows } = await Task.findAndCountAll({
        where,
        include: [
          { model: User, as: 'creator', attributes: ['id', 'name'] },
          { model: Class, as: 'class', attributes: ['id', 'name', 'code'] },
          { model: Subject, as: 'subject', attributes: ['id', 'name'], required: false }
        ],
        limit: parseInt(limit),
        offset: parseInt(offset),
        order: [['due_date', 'ASC']]
      });

      // For students, attach their submission status
      let data = rows;
      if (['student', 'intern'].includes(req.user.role)) {
        const taskIds = rows.map(t => t.id);
        const submissions = await Submission.findAll({
          where: { task_id: { [Op.in]: taskIds }, student_id: req.user.id },
          attributes: ['task_id', 'status', 'score', 'submitted_at']
        });
        const subMap = {};
        submissions.forEach(s => { subMap[s.task_id] = s; });
        data = rows.map(t => ({ ...t.toJSON(), my_submission: subMap[t.id] || null }));
      }

      res.json({
        success: true,
        data,
        pagination: { total: count, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(count / limit) }
      });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to fetch tasks', error: error.message });
    }
  }

  // Get single task
  async getTask(req, res) {
    try {
      const task = await Task.findByPk(req.params.id, {
        include: [
          { model: User, as: 'creator', attributes: ['id', 'name', 'email'] },
          { model: Class, as: 'class', attributes: ['id', 'name', 'code'] },
          { model: Subject, as: 'subject', required: false }
        ]
      });

      if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

      let mySubmission = null;
      if (['student', 'intern'].includes(req.user.role)) {
        mySubmission = await Submission.findOne({
          where: { task_id: task.id, student_id: req.user.id }
        });
      }

      res.json({ success: true, data: { ...task.toJSON(), my_submission: mySubmission } });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to fetch task', error: error.message });
    }
  }

  // Submit task (with optional file upload)
  async submitTask(req, res) {
    try {
      const task = await Task.findByPk(req.params.id);

      if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
      if (!task.canSubmit()) {
        return res.status(400).json({ success: false, message: 'Task is not accepting submissions' });
      }

      const existing = await Submission.findOne({
        where: { task_id: task.id, student_id: req.user.id }
      });

      const isLate = task.isOverdue();
      const lateHours = isLate
        ? Math.round((new Date() - new Date(task.due_date)) / (1000 * 60 * 60))
        : 0;

      const submissionData = {
        task_id: task.id,
        student_id: req.user.id,
        content: req.body.content || null,
        status: 'submitted',
        submitted_at: new Date(),
        is_late: isLate,
        late_hours: lateHours,
        max_score: task.max_score
      };

      if (req.file) {
        submissionData.file_url = getFileUrl(req.file.filename);
        submissionData.file_name = req.file.originalname;
        submissionData.file_size = req.file.size;
        submissionData.file_type = req.file.mimetype;
      }

      let submission;
      if (existing) {
        submissionData.attempt_number = (existing.attempt_number || 1) + 1;
        submissionData.status = 'resubmitted';
        await existing.update(submissionData);
        submission = existing;
      } else {
        submission = await Submission.create(submissionData);
        await task.increment('total_submissions');
      }

      res.json({
        success: true,
        message: isLate ? 'Submitted late. Penalty may apply.' : 'Submitted successfully',
        data: submission
      });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Submission failed', error: error.message });
    }
  }

  // Get all submissions for a task (teacher/admin)
  async getSubmissions(req, res) {
    try {
      const task = await Task.findOne({
        where: { id: req.params.id, created_by: req.user.id }
      });

      if (!task && req.user.role !== 'organization_admin') {
        return res.status(404).json({ success: false, message: 'Task not found' });
      }

      const submissions = await Submission.findAll({
        where: { task_id: req.params.id },
        include: [{ model: User, as: 'student', attributes: ['id', 'name', 'email'] }],
        order: [['submitted_at', 'DESC']]
      });

      res.json({ success: true, data: submissions, count: submissions.length });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to fetch submissions', error: error.message });
    }
  }

  // Grade a submission
  async gradeSubmission(req, res) {
    try {
      const { score, feedback, grade } = req.body;

      const submission = await Submission.findOne({
        where: { id: req.params.submissionId, task_id: req.params.id }
      });

      if (!submission) return res.status(404).json({ success: false, message: 'Submission not found' });

      const percentage = (score / submission.max_score) * 100;
      const autoGrade = grade || submission.calculateGrade();

      await submission.update({
        score,
        percentage,
        grade: autoGrade,
        feedback,
        graded_by: req.user.id,
        graded_at: new Date(),
        status: 'graded'
      });

      await Task.increment('graded_submissions', { where: { id: req.params.id } });

      res.json({ success: true, message: 'Submission graded successfully', data: submission });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to grade submission', error: error.message });
    }
  }

  // Update task
  async updateTask(req, res) {
    try {
      const task = await Task.findOne({
        where: { id: req.params.id, created_by: req.user.id }
      });

      if (!task) return res.status(404).json({ success: false, message: 'Task not found' });
      if (task.status === 'closed') return res.status(400).json({ success: false, message: 'Cannot edit a closed task' });

      const { title, description, instructions, due_date, priority, status } = req.body;

      // If publishing task, also send notifications
      if (status === 'published' && task.status === 'draft') {
        // Notify students in the class
        if (task.class_id) {
          const students = await StudentProfile.findAll({
            where: { class_id: task.class_id },
            include: [{ model: User, as: 'user', where: { status: 'active' } }]
          });

          for (const profile of students) {
            try {
              await EmailService.sendTaskAssigned(profile.user, task);
            } catch (err) {
              console.error(`Email failed for ${profile.user.email}:`, err.message);
            }
          }
        }

        await task.update({
          title, description, instructions, due_date, priority, status,
          published_at: new Date()
        });
      } else {
        await task.update({ title, description, instructions, due_date, priority, status });
      }

      res.json({ success: true, message: 'Task updated successfully', data: task });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to update task', error: error.message });
    }
  }

  // Soft delete task
  async deleteTask(req, res) {
    try {
      const task = await Task.findOne({
        where: { id: req.params.id, created_by: req.user.id }
      });

      if (!task) return res.status(404).json({ success: false, message: 'Task not found' });

      await task.destroy();
      res.json({ success: true, message: 'Task deleted successfully' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to delete task', error: error.message });
    }
  }

  // Analytics: submission rates per class (for org admin / district admin)
  async getTaskAnalytics(req, res) {
    try {
      const orgId = req.user.organization_id;

      const analytics = await Task.findAll({
        include: [
          { model: Class, as: 'class', where: { organization_id: orgId }, attributes: ['id', 'name'] },
          {
            model: Submission, as: 'submissions',
            attributes: ['status', [sequelize.fn('COUNT', sequelize.col('submissions.id')), 'count']],
            required: false
          }
        ],
        attributes: ['id', 'title', 'due_date', 'total_submissions', 'graded_submissions', 'status'],
        where: { status: { [Op.in]: ['published', 'closed'] } },
        group: ['Task.id', 'class.id', 'submissions.status'],
        order: [['due_date', 'DESC']],
        limit: 50
      });

      res.json({ success: true, data: analytics });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to fetch analytics', error: error.message });
    }
  }
}

export default new TaskController();
