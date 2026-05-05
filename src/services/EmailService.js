import nodemailer from 'nodemailer';

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: parseInt(process.env.EMAIL_PORT) || 587,
      secure: false,
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      }
    });
  }

  async send({ to, subject, html }) {
    return this.transporter.sendMail({
      from: `"Rwanda Task Management" <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html
    });
  }

  async sendOrganizationApproved(organization, code, credentials = null) {
    const credentialsHtml = credentials ? `
      <div style="background:#e8f5e9;border-left:4px solid #2e7d32;padding:16px;margin:16px 0;border-radius:4px">
        <p style="margin:0;font-weight:bold;color:#2e7d32">Your Admin Login Credentials</p>
        <p style="margin:8px 0 0"><strong>Email:</strong> ${credentials.email}</p>
        <p style="margin:4px 0 0"><strong>Temporary Password:</strong> <code style="background:#f5f5f5;padding:2px 6px;border-radius:3px">${credentials.password}</code></p>
        <p style="margin:8px 0 0;font-size:12px;color:#666">Please change your password after first login.</p>
      </div>` : '';

    return this.send({
      to: organization.contact_email,
      subject: 'Organization Approved – Your Access Code & Login Details',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #ddd;border-radius:8px;overflow:hidden">
          <div style="background:#003366;padding:24px;text-align:center">
            <h1 style="color:#C9A227;margin:0">Rwanda Task Management</h1>
          </div>
          <div style="padding:32px">
            <h2 style="color:#003366">Congratulations! Your Organization Has Been Approved</h2>
            <p>Dear <strong>${organization.name}</strong>,</p>
            <p>Your organization has been reviewed and approved by the District Administrator.</p>
            <div style="background:#f5f5f5;border-left:4px solid #C9A227;padding:16px;margin:24px 0;border-radius:4px">
              <p style="margin:0;font-size:14px;color:#666">Your Organization Access Code</p>
              <p style="margin:8px 0 0;font-size:32px;font-weight:bold;color:#003366;letter-spacing:4px">${code}</p>
            </div>
            <p>Share this code with your teachers and students so they can join your organization.</p>
            ${credentialsHtml}
            <p style="color:#888;font-size:12px">Keep this code secure. Do not share it publicly.</p>
          </div>
        </div>
      `
    });
  }

  async sendOrganizationRejected(organization, reason) {
    return this.send({
      to: organization.contact_email,
      subject: 'Organization Registration Update',
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #ddd;border-radius:8px;overflow:hidden">
          <div style="background:#003366;padding:24px;text-align:center">
            <h1 style="color:#C9A227;margin:0">Rwanda Task Management</h1>
          </div>
          <div style="padding:32px">
            <h2 style="color:#c0392b">Registration Not Approved</h2>
            <p>Dear <strong>${organization.name}</strong>,</p>
            <p>After review, your organization registration was not approved.</p>
            <div style="background:#fff5f5;border-left:4px solid #c0392b;padding:16px;margin:24px 0;border-radius:4px">
              <p style="margin:0;font-weight:bold">Reason:</p>
              <p style="margin:8px 0 0">${reason}</p>
            </div>
            <p>You may re-apply after addressing the issues mentioned above.</p>
          </div>
        </div>
      `
    });
  }

  async sendTaskAssigned(user, task) {
    return this.send({
      to: user.email,
      subject: `New Task: ${task.title}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #ddd;border-radius:8px;overflow:hidden">
          <div style="background:#003366;padding:24px;text-align:center">
            <h1 style="color:#C9A227;margin:0">Rwanda Task Management</h1>
          </div>
          <div style="padding:32px">
            <h2 style="color:#003366">New Task Assigned</h2>
            <p>Hello <strong>${user.name}</strong>,</p>
            <p>A new task has been assigned to you:</p>
            <div style="background:#f5f5f5;padding:16px;border-radius:4px;margin:16px 0">
              <p><strong>Title:</strong> ${task.title}</p>
              <p><strong>Due Date:</strong> ${new Date(task.due_date).toLocaleDateString()}</p>
              <p><strong>Priority:</strong> ${task.priority}</p>
            </div>
            <p>Log in to your dashboard to view and submit this task.</p>
          </div>
        </div>
      `
    });
  }

  async sendTaskReminder(user, task, hoursLeft) {
    return this.send({
      to: user.email,
      subject: `Reminder: "${task.title}" due in ${hoursLeft} hours`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;border:1px solid #ddd;border-radius:8px;overflow:hidden">
          <div style="background:#C9A227;padding:24px;text-align:center">
            <h1 style="color:#003366;margin:0">⏰ Task Reminder</h1>
          </div>
          <div style="padding:32px">
            <p>Hello <strong>${user.name}</strong>,</p>
            <p>This is a reminder that your task is due soon:</p>
            <div style="background:#fff8e1;border-left:4px solid #C9A227;padding:16px;border-radius:4px;margin:16px 0">
              <p><strong>${task.title}</strong></p>
              <p>Due in <strong>${hoursLeft} hours</strong></p>
            </div>
            <p>Please submit before the deadline to avoid late penalties.</p>
          </div>
        </div>
      `
    });
  }
}

export default new EmailService();
