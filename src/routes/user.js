import express from 'express';
import UserController from '../controllers/UserController.js';
import { authMiddleware } from '../middleware/auth.js';
import { roleMiddleware, organizationScopeMiddleware } from '../middleware/authorization.js';
import { validateRequest, schemas } from '../middleware/validation.js';
import { auditLogger } from '../middleware/security.js';
import { uploadCSV } from '../services/FileUploadService.js';
import Joi from 'joi';

const router = express.Router();

// ─── Public Routes ────────────────────────────────────────────────────────────

// Validate student ID before signup
router.post('/validate-id',
  auditLogger('validate_student_id', 'user'),
  UserController.validateStudentId
);

// Student/intern self-signup via org code + student ID
router.post('/signup',
  validateRequest(Joi.object({
    organization_code: Joi.string().min(6).max(12).required(),
    student_id: Joi.string().required(),
    name: Joi.string().min(2).max(100).required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
    phone: Joi.string().pattern(/^[+]?[0-9\s\-()]+$/).optional()
  })),
  auditLogger('student_signup', 'user'),
  UserController.studentSignup
);

// ─── Protected Routes ─────────────────────────────────────────────────────────

router.use(authMiddleware);
router.use(organizationScopeMiddleware);

// Create user (teacher/worker) — Org Admin only
router.post('/',
  roleMiddleware(['organization_admin']),
  validateRequest(schemas.userCreation),
  auditLogger('create_user', 'user'),
  UserController.createUser
);

// Bulk import students/employees from CSV/Excel
router.post('/import',
  roleMiddleware(['organization_admin']),
  (req, res, next) => { req.uploadSubDir = 'imports'; next(); },
  uploadCSV,
  auditLogger('bulk_import_users', 'user'),
  UserController.bulkImport
);

// Get all users in organization
router.get('/',
  roleMiddleware(['organization_admin', 'teacher']),
  auditLogger('view_users', 'user'),
  UserController.getUsers
);

// Get single user
router.get('/:id',
  auditLogger('view_user_profile', 'user'),
  UserController.getUser
);

// Update user
router.put('/:id',
  roleMiddleware(['organization_admin']),
  auditLogger('update_user', 'user'),
  UserController.updateUser
);

// Soft delete user
router.delete('/:id',
  roleMiddleware(['organization_admin']),
  auditLogger('delete_user', 'user'),
  UserController.deleteUser
);

export default router;
