import { Notification, User, Organization } from '../database.js';

class NotificationService {
  // Create a notification for a specific user
  static async createForUser(userId, organizationId, type, actionPerformed, metadata = {}, severity = 'info') {
    return await Notification.create({
      user_id: userId,
      organization_id: organizationId,
      type,
      action_performed: actionPerformed,
      metadata,
      severity,
    });
  }

  // Create notifications based on role logic
  static async createNotification(performerId, organizationId, type, actionPerformed, metadata = {}, severity = 'info') {
    // Always notify the performer (user)
    await this.createForUser(performerId, organizationId, type, actionPerformed, metadata, severity);

    // Notify organization admins
    const orgAdmins = await User.findAll({
      where: { organization_id: organizationId, role: 'organization_admin', status: 'active' },
    });
    for (const admin of orgAdmins) {
      if (admin.id !== performerId) { // Don't duplicate for performer if they are admin
        await this.createForUser(admin.id, organizationId, type, actionPerformed, metadata, severity);
      }
    }
  }

  // Specific for import operations
  static async createImportNotification(performerId, organizationId, success, details) {
    const type = 'IMPORT';
    const actionPerformed = success ? 'Bulk data import completed successfully' : 'Bulk data import failed';
    const severity = success ? 'success' : 'error';
    const metadata = { details, success };
    await this.createNotification(performerId, organizationId, type, actionPerformed, metadata, severity);
  }

  // Get unread notifications for a user
  static async getUnreadForUser(userId) {
    return await Notification.findAll({
      where: { user_id: userId, is_read: false },
      include: [{ model: Organization, as: 'organization' }],
      order: [['created_at', 'DESC']],
    });
  }

  // Mark notification as read
  static async markAsRead(notificationId, userId) {
    const notification = await Notification.findOne({
      where: { id: notificationId, user_id: userId },
    });
    if (notification) {
      notification.is_read = true;
      await notification.save();
    }
    return notification;
  }

  // Delete notification
  static async deleteNotification(notificationId, userId) {
    return await Notification.destroy({
      where: { id: notificationId, user_id: userId },
    });
  }
}

export default NotificationService;