import express from 'express';
import NotificationController from '../controllers/NotificationController.js';
import { authMiddleware } from '../middleware/auth.js';
import { auditLogger } from '../middleware/security.js';
import Joi from 'joi';
import { validateParams } from '../middleware/validation.js';

const router = express.Router();

// All routes require authentication
router.use(authMiddleware);

// Get unread notifications
router.get('/unread',
  auditLogger('get_unread_notifications', 'notification'),
  NotificationController.getUnread
);

// Mark notification as read
router.patch('/:id/read',
  validateParams(Joi.object({
    id: Joi.number().integer().positive().required()
  })),
  auditLogger('mark_notification_read', 'notification'),
  NotificationController.markAsRead
);

// Delete notification
router.delete('/:id',
  validateParams(Joi.object({
    id: Joi.number().integer().positive().required()
  })),
  auditLogger('delete_notification', 'notification'),
  NotificationController.deleteNotification
);

export default router;