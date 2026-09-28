// ── CONSTANTS ─────────────────────────────────────────────────────────────────
const MEMBER_COLORS = ['#2ec98a', '#c45252', '#c9a040', '#4ea0d4', '#9b72cf'];

const BATCH_SIZE          = 200;   // Work item batch API limit
const SPRINT_DAYS         = 14;    // Duration of a date-based sprint
const DEFAULT_HISTORY     = 12;    // Default past sprints to load
const MS_PER_DAY          = 86400000;
const CHART_WIDTH         = 560;
const CHART_BAR_GAP       = 6;
const CHART_SCALE         = 0.85;  // Vertical scale factor for bar/sparkline
const PR_COMMENT_BATCH    = 5;
const COMPLETION_CONCURRENCY = 10;

const PBI_FIELDS = [
  'System.Id', 'System.WorkItemType', 'System.AssignedTo', 'System.CreatedBy',
  'System.State', 'System.ChangedDate', 'System.CreatedDate', 'System.IterationPath',
  'System.Title', 'System.TeamProject',
  'Microsoft.VSTS.Scheduling.StoryPoints', 'Microsoft.VSTS.Scheduling.Effort',
  'Microsoft.VSTS.Common.ClosedDate',
];

const TASK_FIELDS = [
  'System.Id', 'System.AssignedTo', 'System.Title', 'System.State',
  'System.IterationPath', 'System.TeamProject', 'System.CreatedDate',
  'Microsoft.VSTS.Scheduling.CompletedWork', 'Microsoft.VSTS.Scheduling.OriginalEstimate',
  'Microsoft.VSTS.Common.ClosedDate',
];
