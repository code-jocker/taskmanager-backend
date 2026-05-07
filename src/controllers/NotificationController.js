import NotificationService from '../services/NotificationService.js';

class NotificationController {
  // Get unread notifications for the user
  async getUnread(req, res) {
    try {
      const notifications = await NotificationService.getUnreadForUser(req.user.id);
      res.json({ success: true, data: notifications });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to fetch notifications', error: error.message });
    }
  }

  // Mark notification as read
  async markAsRead(req, res) {
    try {
      const notification = await NotificationService.markAsRead(req.params.id, req.user.id);
      if (!notification) return res.status(404).json({ success: false, message: 'Notification not found' });
      res.json({ success: true, message: 'Notification marked as read' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to mark as read', error: error.message });
    }
  }

  // Delete notification
  async deleteNotification(req, res) {
    try {
      const deleted = await NotificationService.deleteNotification(req.params.id, req.user.id);
      if (!deleted) return res.status(404).json({ success: false, message: 'Notification not found' });
      res.json({ success: true, message: 'Notification deleted' });
    } catch (error) {
      res.status(500).json({ success: false, message: 'Failed to delete notification', error: error.message });
    }
  }
}

export default new NotificationController();