import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

/** Projects in the rotation */
export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  domain: text('domain'),
  rotationOrder: integer('rotation_order').notNull(),
  platforms: text('platforms').default('[]'),
  config: text('config').default('{}'),
  isActive: integer('is_active').default(1),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

/** Tracks rotation state. Single-row table (id='singleton'). */
export const scheduleState = sqliteTable('schedule_state', {
  id: text('id').primaryKey().default('singleton'),
  lastProjectId: text('last_project_id'),
  lastRunAt: text('last_run_at'),
  nextRunAt: text('next_run_at'),
  currentStep: text('current_step').default('IDLE'),
  currentCycleId: text('current_cycle_id'),
  currentProjectId: text('current_project_id'),
  analysisUrl: text('analysis_url'),
  analysisData: text('analysis_data'),
  updatedAt: text('updated_at').default(sql`(datetime('now'))`),
});

/** Generated content ideas (3 per cycle) */
export const contentIdeas = sqliteTable('content_ideas', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull(),
  cycleId: text('cycle_id').notNull(),
  optionNumber: integer('option_number').notNull(),
  title: text('title').notNull(),
  targetKeyword: text('target_keyword'),
  pitch: text('pitch'),
  searchVolumeRationale: text('search_volume_rationale'),
  isSelected: integer('is_selected').default(0),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

/** Content drafts and revisions */
export const contentDrafts = sqliteTable('content_drafts', {
  id: text('id').primaryKey(),
  ideaId: text('idea_id').notNull(),
  projectId: text('project_id').notNull(),
  cycleId: text('cycle_id').notNull(),
  version: integer('version').default(1),
  title: text('title'),
  slug: text('slug'),
  metaDescription: text('meta_description'),
  bodyHtml: text('body_html'),
  excerpt: text('excerpt'),
  socialLinkedin: text('social_linkedin'),
  socialTwitter: text('social_twitter'),
  socialFacebook: text('social_facebook'),
  socialInstagram: text('social_instagram'),
  reviewScore: real('review_score'),
  reviewFeedback: text('review_feedback'),
  images: text('images'),
  status: text('status').default('draft'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

/** Publication tracking per platform */
export const publications = sqliteTable('publications', {
  id: text('id').primaryKey(),
  draftId: text('draft_id').notNull(),
  projectId: text('project_id').notNull(),
  platform: text('platform').notNull(),
  platformPostId: text('platform_post_id'),
  publishedUrl: text('published_url'),
  status: text('status').default('pending'),
  errorMessage: text('error_message'),
  publishedAt: text('published_at'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

/** Email approval tracking */
export const approvalEmails = sqliteTable('approval_emails', {
  id: text('id').primaryKey(),
  cycleId: text('cycle_id').notNull(),
  projectId: text('project_id').notNull(),
  gmailThreadId: text('gmail_thread_id'),
  gmailMessageId: text('gmail_message_id'),
  sentAt: text('sent_at'),
  reminderSentAt: text('reminder_sent_at'),
  replyReceivedAt: text('reply_received_at'),
  selectedOption: integer('selected_option'),
  status: text('status').default('sent'),
});

/** Audit log */
export const activityLog = sqliteTable('activity_log', {
  id: text('id').primaryKey(),
  cycleId: text('cycle_id'),
  projectId: text('project_id'),
  action: text('action').notNull(),
  details: text('details'),
  createdAt: text('created_at').default(sql`(datetime('now'))`),
});

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;
export type ContentIdea = typeof contentIdeas.$inferSelect;
export type ContentDraft = typeof contentDrafts.$inferSelect;
export type Publication = typeof publications.$inferSelect;
export type ApprovalEmail = typeof approvalEmails.$inferSelect;
export type ScheduleState = typeof scheduleState.$inferSelect;
