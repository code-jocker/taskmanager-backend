import bcrypt from 'bcryptjs';
import xlsx from 'xlsx';
import fs from 'fs';
import { User, StudentProfile, EmployeeProfile, Organization, Class } from '../database.js';
import { Op } from 'sequelize';

// Generate unique student ID: ST-xxxx (4-digit sequential)
async function generateStudentId() {
  // Get all existing student IDs that match the pattern
  const profiles = await StudentProfile.findAll({
    attributes: ['student_id'],
    where: {
      student_id: { [Op.like]: 'ST-%' }
    }
  });

  // Extract numbers and find max
  let maxNum = 0;
  profiles.forEach(profile => {
    const match = profile.student_id.match(/^ST-(\d{4})$/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  });

  // Next number
  const nextNum = maxNum + 1;
  const newId = `ST-${nextNum.toString().padStart(4, '0')}`;

  // Check if exists (to handle race conditions)
  const existing = await StudentProfile.findOne({ where: { student_id: newId } });
  if (existing) {
    // If collision, recurse (though unlikely with sequential)
    return await generateStudentId();
  }

  return newId;
}

class UserController {
  // Create user (teacher/worker/student) by Org Admin or Teacher (for students)
  async createUser(req, res) {
    try {
      const { name, email, password, phone, role, employee_id, position, department, employment_type } = req.body;
      const organization_id = req.user.organization_id;

      // Teachers can only create students/interns
      if (req.user.role === 'teacher' && !['student', 'intern'].includes(role)) {
        return res.status(403).json({ success: false, message: 'Teachers can only create student accounts' });
      }

      const organization = await Organization.findByPk(organization_id);
      // if (!organization.canAddUsers()) {
      //   return res.status(403).json({ success: false, message: 'User limit reached for this organization' });
      // }

      const existing = await User.findOne({ where: { email, organization_id } });
      if (existing) {
        return res.status(409).json({ success: false, message: 'Email already exists in this organization' });
      }

      const user = await User.create({
        name, email, password, phone, role,
        organization_id,
        status: 'active',
        created_by: req.user.id
      });

      if (['teacher', 'worker'].includes(role)) {
        const empId = employee_id || `EMP-${organization_id}-${user.id}`;
        await EmployeeProfile.create({
          user_id: user.id,
          employee_id: empId,
          position: position || role,
          department: department || 'General',
          employment_type: employment_type || 'full_time'
        });
      } else if (['student', 'intern'].includes(role)) {
        // Generate student ID
        let studentId;
        try {
          studentId = await generateStudentId();
        } catch (error) {
          return res.status(500).json({ success: false, message: 'Failed to generate student ID', error: error.message });
        }

        let classId = req.body.class_id;
        if (classId) {
          // Validate class exists and belongs to org
          const cls = await Class.findOne({ where: { id: classId, organization_id } });
          if (!cls) {
            return res.status(400).json({ success: false, message: 'Invalid class' });
          }
          // Check if class has space
          if (cls.current_students >= cls.max_students) {
            return res.status(400).json({ success: false, message: 'Class is full' });
          }
        }

        await StudentProfile.create({
          user_id: user.id,
          student_id: studentId,
          class_id: classId || null,
          status: 'active'
        });

        // Increment class current_students if assigned
        if (classId) {
          await Class.increment('current_students', { where: { id: classId } });
        }
      }

      await organization.increment('current_users');

      const created = await User.findByPk(user.id, {
        attributes: { exclude: ['password'] },
        include: [
          { model: EmployeeProfile, as: 'employeeProfile' },
          { model: StudentProfile, as: 'studentProfile' }
        ]
      });

      res.status(201).json({ success: true, message: 'User created successfully', data: created });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to create user', error: error.message });
    }
  }

  // Student self-signup via org code + student ID
  async studentSignup(req, res) {
    try {
      const { organization_code, student_id, name, email, password, phone } = req.body;

      const organization = await Organization.findOne({
        where: { code: organization_code, status: 'approved' }
      });

      if (!organization) {
        return res.status(404).json({ success: false, message: 'Invalid organization code' });
      }

      if (!organization.isSubscriptionActive()) {
        return res.status(403).json({ success: false, message: 'Organization subscription expired' });
      }

      // Check if student ID is pre-loaded (pending user with this student_id)
      const preloaded = await StudentProfile.findOne({
        where: { student_id },
        include: [{
          model: User,
          as: 'user',
          where: { organization_id: organization.id, status: 'pending' }
        }]
      });

      if (!preloaded) {
        return res.status(404).json({
          success: false,
          message: 'Student ID not found. Please contact your organization admin.'
        });
      }

      const existingEmail = await User.findOne({ where: { email, organization_id: organization.id } });
      if (existingEmail) {
        return res.status(409).json({ success: false, message: 'Email already registered' });
      }

      // Activate the pre-loaded user
      await preloaded.user.update({ name, email, password, phone, status: 'active' });

      const user = await User.findByPk(preloaded.user.id, {
        attributes: { exclude: ['password'] },
        include: [
          { model: StudentProfile, as: 'studentProfile', include: [{ model: Class, as: 'class' }] },
          { model: Organization, as: 'organization' }
        ]
      });

      res.status(200).json({
        success: true,
        message: 'Account activated successfully. You can now log in.',
        data: user
      });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Signup failed', error: error.message });
    }
  }

  // Bulk import students/employees from CSV/Excel
  async bulkImport(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, message: 'No file uploaded' });
      }

      const organization_id = req.user.organization_id;
      const organization = await Organization.findByPk(organization_id);

      const workbook = xlsx.readFile(req.file.path);
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const rows = xlsx.utils.sheet_to_json(sheet);

      if (!rows.length) {
        return res.status(400).json({ success: false, message: 'File is empty' });
      }

      const results = { created: 0, skipped: 0, errors: [] };

      for (const row of rows) {
        try {
          const role = (row.role || 'student').toLowerCase();
          const idField = ['student', 'intern'].includes(role) ? row.student_id : row.employee_id;

          if (!idField || !row.name) {
            results.errors.push({ row: row.name || 'unknown', reason: 'Missing required fields (name, student_id/employee_id)' });
            results.skipped++;
            continue;
          }

          // Create placeholder user (status: pending — activated on self-signup)
          const tempEmail = `pending_${idField}_${organization_id}@placeholder.rw`;
          const existing = await User.findOne({ where: { organization_id, email: tempEmail } });
          if (existing) { results.skipped++; continue; }

          const user = await User.create({
            name: row.name,
            email: tempEmail,
            password: await bcrypt.hash(Math.random().toString(36), 10),
            role,
            organization_id,
            status: 'pending',
            created_by: req.user.id
          });

          if (['student', 'intern'].includes(role)) {
            const classId = row.class_id ? parseInt(row.class_id) : null;
            await StudentProfile.create({
              user_id: user.id,
              student_id: String(idField),
              class_id: classId,
              academic_year: row.academic_year || null
            });
          } else {
            await EmployeeProfile.create({
              user_id: user.id,
              employee_id: String(idField),
              department: row.department || 'General',
              position: row.position || role,
              employment_type: row.employment_type || 'full_time'
            });
          }

          results.created++;
        } catch (err) {
          results.errors.push({ row: row.name || 'unknown', reason: err.message });
          results.skipped++;
        }
      }

      // Cleanup uploaded file
      fs.unlinkSync(req.file.path);

      res.json({
        success: true,
        message: `Import complete: ${results.created} created, ${results.skipped} skipped`,
        data: results
      });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Import failed', error: error.message });
    }
  }

  // Get all users in organization
  async getUsers(req, res) {
    try {
      const { role, status, page = 1, limit = 20, search } = req.query;
      const offset = (page - 1) * limit;

      const where = { organization_id: req.user.organization_id };
      if (role) where.role = role;
      if (status) where.status = status;
      if (search) where.name = { [Op.like]: `%${search}%` };

      const { count, rows } = await User.findAndCountAll({
        where,
        attributes: { exclude: ['password'] },
        include: [
          { model: StudentProfile, as: 'studentProfile', required: false },
          { model: EmployeeProfile, as: 'employeeProfile', required: false }
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
      res.status(500).json({ success: false, message: 'Failed to fetch users', error: error.message });
    }
  }

  // Get single user
  async getUser(req, res) {
    try {
      const user = await User.findOne({
        where: { id: req.params.id, organization_id: req.user.organization_id },
        attributes: { exclude: ['password'] },
        include: [
          { model: StudentProfile, as: 'studentProfile', include: [{ model: Class, as: 'class' }] },
          { model: EmployeeProfile, as: 'employeeProfile' }
        ]
      });

      if (!user) return res.status(404).json({ success: false, message: 'User not found' });

      res.json({ success: true, data: user });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to fetch user', error: error.message });
    }
  }

  // Update user
  async updateUser(req, res) {
    try {
      const { name, phone, status } = req.body;

      const user = await User.findOne({
        where: { id: req.params.id, organization_id: req.user.organization_id }
      });

      if (!user) return res.status(404).json({ success: false, message: 'User not found' });

      await user.update({ name, phone, status });

      res.json({ success: true, message: 'User updated successfully', data: user });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to update user', error: error.message });
    }
  }

  // Soft delete user
  async deleteUser(req, res) {
    try {
      const user = await User.findOne({
        where: { id: req.params.id, organization_id: req.user.organization_id }
      });

      if (!user) return res.status(404).json({ success: false, message: 'User not found' });

      await user.destroy(); // paranoid soft delete
      await Organization.decrement('current_users', { where: { id: req.user.organization_id } });

      res.json({ success: true, message: 'User removed successfully' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to delete user', error: error.message });
    }
  }

  // Validate student ID before signup (public endpoint)
  async validateStudentId(req, res) {
    try {
      const { organization_code, student_id } = req.body;

      const organization = await Organization.findOne({
        where: { code: organization_code, status: 'approved' }
      });

      if (!organization) {
        return res.status(404).json({ success: false, message: 'Invalid organization code' });
      }

      const profile = await StudentProfile.findOne({
        where: { student_id },
        include: [{
          model: User,
          as: 'user',
          where: { organization_id: organization.id, status: 'pending' },
          attributes: ['id', 'name', 'role']
        }]
      });

      if (!profile) {
        return res.status(404).json({ success: false, message: 'Student ID not found or already registered' });
      }

      res.json({
        success: true,
        message: 'Student ID verified',
        data: {
          organization: { id: organization.id, name: organization.name, type: organization.type },
          student: { name: profile.user.name, class_id: profile.class_id }
        }
      });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Validation failed', error: error.message });
    }
  }
}

export default new UserController();
