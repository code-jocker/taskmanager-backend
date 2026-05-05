import express from 'express';
import TaskController from '../controllers/TaskController.js';
import { authMiddleware } from '../middleware/auth.js';
import { roleMiddleware, organizationScopeMiddleware } from '../middleware/authorization.js';
import { validateRequest, validateParams, schemas } from '../middleware/validation.js';
import { auditLogger } from '../middleware/security.js';
import { uploadSubmission } from '../services/FileUploadService.js';
import Joi from 'joi';

const router = express.Router();

router.use(authMiddleware);
router.use(organizationScopeMiddleware);

// Create task (draft)
router.post('/',
  roleMiddleware(['teacher', 'organization_admin']),
  validateRequest(schemas.taskCreation),
  auditLogger('create_task', 'task'),
  TaskController.createTask
);

// Get all tasks (role-aware)
router.get('/',
  roleMiddleware(['organization_admin', 'teacher', 'student', 'worker', 'intern']),
  auditLogger('view_tasks', 'task'),
  TaskController.getTasks
);

// Task analytics (org admin)
router.get('/analytics',
  roleMiddleware(['organization_admin', 'district_admin']),
  auditLogger('view_task_analytics', 'analytics'),
  TaskController.getTaskAnalytics
);

// Get single task
router.get('/:id',
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  auditLogger('view_task_details', 'task'),
  TaskController.getTask
);

// Publish task
router.put('/:id/publish',
  roleMiddleware(['teacher', 'organization_admin']),
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  auditLogger('publish_task', 'task'),
  TaskController.publishTask
);

// Submit task (with optional file)
router.post('/:id/submit',
  roleMiddleware(['student', 'intern', 'worker']),
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  (req, res, next) => { req.uploadSubDir = 'submissions'; next(); },
  uploadSubmission,
  auditLogger('submit_task', 'submission'),
  TaskController.submitTask
);

// Get all submissions for a task
router.get('/:id/submissions',
  roleMiddleware(['teacher', 'organization_admin']),
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  auditLogger('view_submissions', 'submission'),
  TaskController.getSubmissions
);

// Grade a submission
router.put('/:id/submissions/:submissionId/grade',
  roleMiddleware(['teacher', 'organization_admin']),
  validateRequest(Joi.object({
    score: Joi.number().min(0).required(),
    feedback: Joi.string().optional(),
    grade: Joi.string().valid('A', 'B', 'C', 'D', 'F').optional()
  })),
  auditLogger('grade_submission', 'submission'),
  TaskController.gradeSubmission
);

// Update task
router.put('/:id',
  roleMiddleware(['teacher', 'organization_admin']),
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  auditLogger('update_task', 'task'),
  TaskController.updateTask
);

// Delete task
router.delete('/:id',
  roleMiddleware(['teacher', 'organization_admin']),
  validateParams(Joi.object({ id: Joi.number().integer().positive().required() })),
  auditLogger('delete_task', 'task'),
  TaskController.deleteTask
);

export default router;
