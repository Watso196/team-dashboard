// ── CONFIG & CONSTANTS ────────────────────────────────────────────────────────
let CFG = {};
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
const THREE_MONTHS_DAYS   = 90;


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

// ── CONFIG SCREEN UI HELPERS ───────────────────────────────────────────────────
function onSprintModeChange() {
  const mode = document.querySelector('input[name="sprint-mode"]:checked')?.value;
  document.getElementById('iter-fields').style.display = mode === 'iterations' ? '' : 'none';
  document.getElementById('date-fields').style.display = mode === 'dates'      ? '' : 'none';
}

// ── ENV PRE-FILL ──────────────────────────────────────────────────────────────
(function prefillFromEnv() {
  const e = window.ENV;
  if (!e) return;
  const set = (id, val) => { if (!val && val !== 0) return; const el = document.getElementById(id); if (el) el.value = val; };

  set('org-url', e.org);
  set('project', e.project);
  set('team', e.team);
  set('related-projects', (e.relatedProjects||[]).join('\n'));
  set('sprint-start-date', e.sprintStartDate);
  set('iteration-count', e.iterationCount||12);
  set('sprint-count', e.sprintCount||12);

  if (e.pat) { const p = document.getElementById('pat'); if (p) { p.type='text'; p.value=e.pat; p.type='password'; } }
  if (e.members?.length) { const el = document.getElementById('members'); if (el) el.value = e.members.join('\n'); }
  if (e.designReviewEnabled) {
    const cb = document.getElementById('design-review-enabled');
    if (cb) cb.setAttribute('aria-checked', 'true');
  }

  // Apply sprint mode radio
  const mode = e.sprintMode === 'dates' ? 'dates' : 'iterations';
  const radio = document.getElementById(mode === 'dates' ? 'mode-dates' : 'mode-iterations');
  if (radio) { radio.checked = true; onSprintModeChange(); }
})();

// ── ADO API ───────────────────────────────────────────────────────────────────
function authHeader() { return 'Basic ' + btoa(':' + CFG.pat); }
const hdrs = () => ({ 'Authorization': authHeader(), 'Content-Type': 'application/json' });

async function adoGet(url) {
  let res;
  try { res = await fetch(url, { headers: hdrs() }); }
  catch(e) { if (e.message?.toLowerCase().includes('failed to fetch')) throw new Error('Network blocked (CORS).\n\nRun: python serve.py\nThen: http://localhost:8765/ado-dashboard.html'); throw e; }
  if (!res.ok) {
    const b = await res.text().catch(()=>'');
    if (res.status===401) throw new Error('401 Unauthorized — PAT invalid or expired.');
    if (res.status===404) throw new Error('404 Not Found — Check Org URL, Project, Team name.\nURL: '+url);
    throw new Error(`ADO ${res.status}\nURL: ${url}\n${b.slice(0,300)}`);
  }
  return res.json();
}

async function adoPost(url, body) {
  let res;
  try { res = await fetch(url, { method:'POST', headers:hdrs(), body:JSON.stringify(body) }); }
  catch(e) { if (e.message?.toLowerCase().includes('failed to fetch')) throw new Error('Network blocked (CORS).\n\nRun: python serve.py'); throw e; }
  if (!res.ok) {
    const b = await res.text().catch(()=>'');
    if (res.status===401) throw new Error('401 Unauthorized — PAT invalid or expired.');
    if (res.status===404) throw new Error('404 Not Found\nURL: '+url);
    throw new Error(`ADO POST ${res.status}\n${b.slice(0,300)}`);
  }
  return res.json();
}

// ── URL HELPERS ───────────────────────────────────────────────────────────────
const enc       = s  => encodeURIComponent(s);
const projBase  = () => `${CFG.org}/${enc(CFG.project)}`;
const teamBase  = () => `${CFG.org}/${enc(CFG.project)}/${enc(CFG.team)}`;
const witApi    = () => `${projBase()}/_apis/wit`;
const orgWiqlUrl= () => `${CFG.org}/_apis/wit/wiql?api-version=7.0`;
const wiUrl     = wi => { const p=wi.fields?.['System.TeamProject']||CFG.project; return `${CFG.org}/${enc(p)}/_workitems/edit/${wi.id}`; };

// ── DATE HELPERS ──────────────────────────────────────────────────────────────
const addDays   = (d,n) => { const r=new Date(d); r.setDate(r.getDate()+n); return r; };
const subMonths = (d,n) => { const r=new Date(d); r.setMonth(r.getMonth()-n); return r; };
const isoDate   = d => d.toISOString().split('T')[0];
const normPath  = p => (p||'').replace(/\\/g,'/').trim().toLowerCase();

// ── ASSIGNEE FILTER ───────────────────────────────────────────────────────────
function assigneeClause(field='System.AssignedTo') {
  const quoted = CFG.members.map(m=>`'${m.replace(/'/g,"''")}'`).join(',');
  return `[${field}] IN (${quoted})`;
}

// ── WIQL ──────────────────────────────────────────────────────────────────────
async function orgWiqlQuery(query) {
  const d = await adoPost(orgWiqlUrl(), { query });
  return (d.workItems||[]).map(w=>w.id);
}
async function projectWiqlQuery(query) {
  const d = await adoPost(`${witApi()}/wiql?api-version=7.0`, { query });
  return (d.workItems||[]).map(w=>w.id);
}
async function fetchWIBatch(ids, fields, expand) {
  if (!ids.length) return [];
  const results = [];
  for (let i=0; i<ids.length; i+=BATCH_SIZE) {
    const body = { ids: ids.slice(i,i+BATCH_SIZE) };
    if (fields) body.fields = fields;
    if (expand) body['$expand'] = expand;
    const d = await adoPost(`${witApi()}/workitemsbatch?api-version=7.0`, body);
    results.push(...(d.value||[]));
  }
  return results;
}
async function fetchWIUpdates(id) {
  const d = await adoGet(`${witApi()}/workitems/${id}/updates?api-version=7.0`);
  return d.value||[];
}

// ── PR API ────────────────────────────────────────────────────────────────────
async function fetchAllRepos() {
  if (!CFG.relatedProjects?.length) return [];
  try {
    const allRepos = [];
    const projects = CFG.relatedProjects.length ? CFG.relatedProjects : [CFG.project];
    for (const proj of projects) {
      try {
        const d = await adoGet(`${CFG.org}/${enc(proj)}/_apis/git/repositories?api-version=7.0`);
        allRepos.push(...(d.value||[]));
      } catch(e) { console.warn(`[TeamPulse] Could not fetch repos for project "${proj}":`, e.message); }
    }
    console.log(`[TeamPulse] Scoped repos across ${projects.length} project(s): ${allRepos.length} total`);
    return allRepos;
  } catch(e) { console.warn('[TeamPulse] Failed to fetch repos:', e.message); return []; }
}

async function fetchPRCommentsByMember(repoId, repoName, repoProject, prId) {
  try {
    const d = await adoGet(`${CFG.org}/_apis/git/repositories/${repoId}/pullRequests/${prId}/threads?api-version=7.0`);
    const threads = d.value||[];
    const byMember = {};
    const prUrl = `${CFG.org}/${enc(repoProject)}/_git/${enc(repoName)}/pullrequest/${prId}`;
    for (const thread of threads) {
      for (const comment of (thread.comments||[])) {
        if (comment.commentType === 'system') continue;
        const author = comment.author?.displayName||'';
        const member = CFG.members.find(m => m.toLowerCase()===author.toLowerCase());
        if (!member) continue;
        if (!byMember[member]) byMember[member] = [];
        const text = (comment.content||'').trim();
        if (text) byMember[member].push({ text, prUrl });
      }
    }
    return byMember;
  } catch(e) { console.warn('[TeamPulse] Failed to fetch PR comments:', e.message); return {}; }
}

// ── ITERATION FETCHING ────────────────────────────────────────────────────────
async function fetchCurrentIteration() {
  const url = `${teamBase()}/_apis/work/teamsettings/iterations?api-version=7.0&$timeframe=current`;
  const d = await adoGet(url);
  const items = d.value||[];
  if (!items.length) throw new Error(`No current iteration found for team "${CFG.team}" in project "${CFG.project}".\n\nCheck:\n• Team name exactly correct\n• Sprint has Start/End dates\n• Iteration assigned to this team`);
  return items[0];
}
async function fetchAllIterations() {
  const d = await adoGet(`${teamBase()}/_apis/work/teamsettings/iterations?api-version=7.0`);
  return (d.value||[]).filter(i=>i.attributes?.startDate);
}

// ── DATE-BASED SPRINT HELPERS ─────────────────────────────────────────────────
// Synthesises artificial iteration objects matching the shape used by the
// real ADO iteration API so the rest of the pipeline is mode-agnostic.
function buildDateBasedSprints(startDate, count) {
  // startDate = first day of the most recent sprint
  const sprints = [];
  for (let i = 0; i < count; i++) {
    const s = addDays(startDate, -(i * SPRINT_DAYS));
    const e = addDays(s, SPRINT_DAYS - 1);
    const label = `Sprint ${isoDate(s)}`;
    sprints.unshift({
      name: label,
      path: `date-sprint/${isoDate(s)}`,    // synthetic path, unique per sprint
      attributes: { startDate: s.toISOString(), finishDate: e.toISOString() },
      _synthetic: true,
    });
  }
  return sprints; // oldest first
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
function setStep(msg) { const el=document.getElementById('loading-step'); if(el) el.textContent=msg; }
function effortOf(wi) { return wi.fields['Microsoft.VSTS.Scheduling.StoryPoints']||wi.fields['Microsoft.VSTS.Scheduling.Effort']||0; }
const projectOf = wi => wi.fields?.['System.TeamProject']||CFG.project;
function extractName(val) {
  if (!val) return null;
  if (typeof val==='string') return val.replace(/<[^>]+>/g,'').trim();
  if (typeof val==='object') return (val.displayName||val.uniqueName||'').replace(/<[^>]+>/g,'').trim();
  return null;
}
function matchMember(val) {
  const name = extractName(val);
  if (!name) return null;
  if (CFG.members.includes(name)) return name;
  return CFG.members.find(m=>m.toLowerCase()===name.toLowerCase())||null;
}

// ── MAIN DATA BUILD: HELPERS ──────────────────────────────────────────────────

function initMemberBuckets() {
  const md = {};
  for (const m of CFG.members) {
    md[m] = {
      effortDone: 0, effortThisSprint: 0,
      itemsDoneThisSprint: 0,
      pbisChanged: new Set(), bugsChanged: new Set(), featuresChanged: new Set(),
      hoursThisSprint: 0, prCount: 0,
      doneItems: [], changedPBIs: [], changedBugs: [], changedFeatures: [], sprintTasks: [],
      allSprintPBIs: [],
      history: {},
      completionDays: [],
      prsReviewed3mo: 0, prsReviewed6mo: 0,
      prsAuthoredThisSprint: 0, prsAuthored3mo: 0, prsAuthored6mo: 0,
      prComments: [],
      pbisCreated3mo: 0, bugsCreated3mo: 0,
      peerReviewTasksThisSprint: 0,
      peerReviewTaskCount3mo: 0, peerReviewTaskCount6mo: 0,
      peerReviewHours3mo: 0, peerReviewHoursPerTask3mo: null,
      designReviewItems: [],
      designReviewFlagged: [],
    };
  }
  return md;
}

async function resolveIterations(now, threeMonthsAgo, sixMonthsAgo, twelveMonthsAgo) {
  let currentIter, sprintStart, sprintEnd, allIters, historyIters;
  let iters3moNorm, iters6moNorm;

  if (CFG.sprintMode === 'dates') {
    const count = CFG.sprintCount || 12;
    allIters = buildDateBasedSprints(CFG.sprintStartDate, count);
    currentIter = allIters[allIters.length - 1];
    sprintStart = new Date(currentIter.attributes.startDate);
    sprintEnd   = new Date(currentIter.attributes.finishDate);
    historyIters = allIters;
    iters3moNorm = new Set(allIters.filter(i => new Date(i.attributes.startDate) >= threeMonthsAgo).map(i => normPath(i.path)));
    iters6moNorm = new Set(allIters.filter(i => new Date(i.attributes.startDate) >= sixMonthsAgo).map(i => normPath(i.path)));
  } else {
    currentIter = await fetchCurrentIteration();
    sprintStart = new Date(currentIter.attributes.startDate);
    sprintEnd   = currentIter.attributes.finishDate ? new Date(currentIter.attributes.finishDate) : addDays(sprintStart,SPRINT_DAYS);
    allIters = await fetchAllIterations();
    const filterIters = (cutoff) => allIters
      .filter(i=>{ const s=new Date(i.attributes.startDate); return s>=cutoff && s<=now; })
      .sort((a,b)=>new Date(a.attributes.startDate)-new Date(b.attributes.startDate));
    const iters6mo  = filterIters(sixMonthsAgo);
    const iters12mo = filterIters(twelveMonthsAgo);
    const maxHistory = CFG.iterationCount || DEFAULT_HISTORY;
    historyIters = iters12mo.slice(-maxHistory);
    iters3moNorm = new Set(filterIters(threeMonthsAgo).map(i=>normPath(i.path)));
    iters6moNorm = new Set(iters6mo.map(i=>normPath(i.path)));
  }

  console.group('[TeamPulse] Iterations');
  console.log('Mode:', CFG.sprintMode);
  console.log('Current:', currentIter.name, normPath(currentIter.path));
  console.log('History window:', historyIters.length, 'sprints');
  historyIters.forEach(i=>console.log(' ',i.name, normPath(i.path)));
  console.groupEnd();

  return { currentIter, sprintStart, sprintEnd, historyIters, iters3moNorm, iters6moNorm };
}

async function fetchChangedPBIsAndBugs(ctx) {
  const { md, sprintStart, sprintEnd } = ctx;
  setStep('Querying PBIs and bugs…');
  const pbiBugChangedIds = await orgWiqlQuery(
    `SELECT [System.Id] FROM WorkItems WHERE ${assigneeClause()} AND [System.WorkItemType] IN ('Product Backlog Item','Bug') AND [System.ChangedDate] >= '${isoDate(sprintStart)}' AND [System.ChangedDate] <= '${isoDate(addDays(sprintEnd,1))}' ORDER BY [System.ChangedDate] DESC`
  );
  const pbiBugItems = await fetchWIBatch(pbiBugChangedIds, PBI_FIELDS);
  for (const wi of pbiBugItems) {
    const m = matchMember(wi.fields['System.AssignedTo']); if (!m) continue;
    const type=wi.fields['System.WorkItemType'], title=wi.fields['System.Title']||'', state=wi.fields['System.State']||'', pts=effortOf(wi), project=projectOf(wi), url=wiUrl(wi);
    if (type==='Product Backlog Item') { md[m].pbisChanged.add(wi.id); md[m].changedPBIs.push({id:wi.id,title,state,pts,project,url}); }
    else if (type==='Bug') { md[m].bugsChanged.add(wi.id); md[m].changedBugs.push({id:wi.id,title,state,project,url}); }
  }
}

async function fetchChangedFeatures(ctx) {
  const { md, sprintStart, sprintEnd } = ctx;
  setStep('Querying features…');
  const featureIds = await orgWiqlQuery(
    `SELECT [System.Id] FROM WorkItems WHERE ${assigneeClause()} AND [System.WorkItemType] = 'Feature' AND [System.ChangedDate] >= '${isoDate(sprintStart)}' AND [System.ChangedDate] <= '${isoDate(addDays(sprintEnd,1))}' ORDER BY [System.ChangedDate] DESC`
  );
  const featureItems = await fetchWIBatch(featureIds, PBI_FIELDS);
  for (const wi of featureItems) {
    const m = matchMember(wi.fields['System.AssignedTo']); if (!m) continue;
    md[m].featuresChanged.add(wi.id);
    md[m].changedFeatures.push({id:wi.id, title:wi.fields['System.Title']||'', project:projectOf(wi), url:wiUrl(wi)});
  }
}

async function fetchDoneItems(ctx) {
  const { md, sprintStart, sprintEnd, sprintPath } = ctx;
  setStep('Querying done items…');
  let primaryDoneIds = [];
  if (CFG.sprintMode !== 'dates') {
    primaryDoneIds = await projectWiqlQuery(
      `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject]='${CFG.project}' AND [System.WorkItemType] IN ('Product Backlog Item','Bug') AND [System.IterationPath] UNDER '${sprintPath}' AND [System.State]='Done'`
    );
  }
  const orgDoneIds = await orgWiqlQuery(
    `SELECT [System.Id] FROM WorkItems WHERE ${assigneeClause()} AND [System.WorkItemType] IN ('Product Backlog Item','Bug') AND [System.State]='Done' AND [Microsoft.VSTS.Common.ClosedDate] >= '${isoDate(sprintStart)}' AND [Microsoft.VSTS.Common.ClosedDate] <= '${isoDate(addDays(sprintEnd,1))}'`
  );
  const doneItems = await fetchWIBatch([...new Set([...primaryDoneIds,...orgDoneIds])], PBI_FIELDS);
  for (const wi of doneItems) {
    const m = matchMember(wi.fields['System.AssignedTo']); if (!m) continue;
    const pts=effortOf(wi);
    md[m].effortDone += pts;
    md[m].itemsDoneThisSprint++;
    md[m].doneItems.push({id:wi.id, title:wi.fields['System.Title']||'', type:wi.fields['System.WorkItemType'], pts, project:projectOf(wi), url:wiUrl(wi)});
  }
}

async function fetchAllSprintPBIs(ctx) {
  const { md, sprintStart, sprintEnd, sprintPath } = ctx;
  if (CFG.sprintMode !== 'dates') {
    const allPrimaryIds = await projectWiqlQuery(
      `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject]='${CFG.project}' AND [System.WorkItemType] IN ('Product Backlog Item','Bug') AND [System.IterationPath] UNDER '${sprintPath}'`
    );
    const allPrimaryPBIs = await fetchWIBatch(allPrimaryIds, PBI_FIELDS);
    for (const wi of allPrimaryPBIs) {
      const m = matchMember(wi.fields['System.AssignedTo']); if (!m) continue;
      md[m].allSprintPBIs.push({
        id: wi.id, title: wi.fields['System.Title']||'',
        type: wi.fields['System.WorkItemType'], state: wi.fields['System.State']||'',
        pts: effortOf(wi), project: projectOf(wi), url: wiUrl(wi),
      });
      if (wi.fields['System.State'] !== 'Done') md[m].effortThisSprint += effortOf(wi);
    }
    for (const m of CFG.members) md[m].effortThisSprint += md[m].effortDone;
    const sprintPBIsWithRels = await fetchWIBatch(allPrimaryIds, null, 'relations');
    for (const wi of sprintPBIsWithRels) {
      const m = matchMember(wi.fields?.['System.AssignedTo']); if (!m) continue;
      if ((wi.relations||[]).some(r=>r.rel==='ArtifactLink'&&r.url?.toLowerCase().includes('pullrequest'))) md[m].prCount++;
    }
  } else {
    for (const m of CFG.members) {
      md[m].allSprintPBIs = [...md[m].doneItems];
      md[m].effortThisSprint = md[m].effortDone;
    }
  }
}

async function fetchSprintTasks(ctx) {
  const { md, sprintStart, sprintEnd, sprintPath } = ctx;
  setStep('Querying tasks…');
  let taskIdsByIter = [];
  if (CFG.sprintMode !== 'dates') {
    taskIdsByIter = await projectWiqlQuery(
      `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject]='${CFG.project}' AND [System.WorkItemType]='Task' AND [System.IterationPath] UNDER '${sprintPath}'`
    );
  }
  const taskIdsByDate = await orgWiqlQuery(
    `SELECT [System.Id] FROM WorkItems WHERE ${assigneeClause()} AND [System.WorkItemType]='Task' AND [System.State]='Done' AND [Microsoft.VSTS.Common.ClosedDate] >= '${isoDate(sprintStart)}' AND [Microsoft.VSTS.Common.ClosedDate] <= '${isoDate(addDays(sprintEnd,1))}'`
  );
  const taskItems = await fetchWIBatch([...new Set([...taskIdsByIter,...taskIdsByDate])], TASK_FIELDS);
  for (const t of taskItems) {
    const m = matchMember(t.fields['System.AssignedTo']); if (!m) continue;
    const closedDate = t.fields['Microsoft.VSTS.Common.ClosedDate'];
    if (!closedDate) continue;
    const cd = new Date(closedDate);
    if (cd < sprintStart || cd > addDays(sprintEnd, 1)) continue;
    const hours = t.fields['Microsoft.VSTS.Scheduling.CompletedWork']||0;
    const title = t.fields['System.Title']||'';
    const isPeerReview = /peer.?review/i.test(title);
    if (hours > 0) {
      md[m].hoursThisSprint += hours;
      md[m].sprintTasks.push({id:t.id, title, hours, project:projectOf(t), url:wiUrl(t)});
    }
    if (isPeerReview && t.fields['System.State']==='Done') md[m].peerReviewTasksThisSprint++;
  }
}

async function fetchCreatedItems(ctx) {
  const { md, threeMonthsAgo } = ctx;
  setStep('Querying created items…');
  const createdIds = await orgWiqlQuery(
    `SELECT [System.Id] FROM WorkItems WHERE ${assigneeClause('System.CreatedBy')} AND [System.WorkItemType] IN ('Product Backlog Item','Bug') AND [System.CreatedDate] >= '${isoDate(threeMonthsAgo)}'`
  );
  const createdItems = await fetchWIBatch(createdIds, PBI_FIELDS);
  for (const wi of createdItems) {
    const m = matchMember(wi.fields['System.CreatedBy']); if (!m) continue;
    if (wi.fields['System.WorkItemType']==='Product Backlog Item') md[m].pbisCreated3mo++;
    else if (wi.fields['System.WorkItemType']==='Bug') md[m].bugsCreated3mo++;
  }
}

async function fetchPeerReviewTasks(ctx) {
  const { md, now, threeMonthsAgo, sixMonthsAgo } = ctx;
  setStep('Querying peer review tasks…');
  const prTaskIds = await orgWiqlQuery(
    `SELECT [System.Id] FROM WorkItems WHERE ${assigneeClause()} AND [System.WorkItemType]='Task' AND [System.Title] CONTAINS 'peer review' AND [System.State]='Done' AND [System.ChangedDate] >= '${isoDate(sixMonthsAgo)}'`
  );
  const prTasks = await fetchWIBatch(prTaskIds, TASK_FIELDS);
  for (const t of prTasks) {
    const m = matchMember(t.fields['System.AssignedTo']); if (!m) continue;
    const changed  = new Date(t.fields['System.ChangedDate']||t.fields['System.CreatedDate']||now);
    const hours    = t.fields['Microsoft.VSTS.Scheduling.CompletedWork']||0;
    const is3mo    = changed >= threeMonthsAgo;
    if (is3mo) { md[m].peerReviewTaskCount3mo++; md[m].peerReviewHours3mo += hours; }
    md[m].peerReviewTaskCount6mo++;
  }
  for (const m of CFG.members) {
    md[m].peerReviewHoursPerTask3mo = md[m].peerReviewTaskCount3mo > 0
      ? md[m].peerReviewHours3mo / md[m].peerReviewTaskCount3mo : null;
  }
}

async function fetchPRData(ctx) {
  const { md, sprintStart, sprintEnd, threeMonthsAgo, sixMonthsAgo } = ctx;
  setStep('Fetching PR data…');
  const repos = await fetchAllRepos();
  console.log(`[TeamPulse] Found ${repos.length} repos`);

  const reviewerPRMap  = {};
  const reviewerPRList = {};
  for (const m of CFG.members) { reviewerPRMap[m] = new Set(); reviewerPRList[m] = []; }

  for (const repo of repos) {
    try {
      let skip=0;
      while (true) {
        const url = `${CFG.org}/_apis/git/repositories/${repo.id}/pullrequests?searchCriteria.status=completed&searchCriteria.minTime=${sixMonthsAgo.toISOString()}&$top=100&$skip=${skip}&api-version=7.0`;
        const d = await adoGet(url);
        const prs = d.value||[];
        if (!prs.length) break;
        for (const pr of prs) {
          const closedDate = pr.closedDate ? new Date(pr.closedDate) : new Date(pr.creationDate);
          // ── Reviewer tracking ──
          for (const reviewer of (pr.reviewers||[])) {
            const m = matchMember(reviewer.displayName||reviewer.uniqueName||'');
            if (!m) continue;
            if (!reviewerPRMap[m].has(pr.pullRequestId)) {
              reviewerPRMap[m].add(pr.pullRequestId);
              reviewerPRList[m].push({ repoId: repo.id, repoName: repo.name, repoProject: repo.project?.name||CFG.project, prId: pr.pullRequestId, closedDate });
            }
          }
          // ── Authorship tracking ──
          const author = matchMember(pr.createdBy?.displayName||pr.createdBy?.uniqueName||'');
          if (author) {
            const is3mo = closedDate >= threeMonthsAgo;
            const is6mo = closedDate >= sixMonthsAgo;
            const isThisSprint = closedDate >= sprintStart && closedDate <= addDays(sprintEnd, 1);
            if (isThisSprint) md[author].prsAuthoredThisSprint++;
            if (is3mo) md[author].prsAuthored3mo++;
            else if (is6mo) md[author].prsAuthored6mo++;
          }
        }
        if (prs.length < 100) break;
        skip += 100;
      }
    } catch(e) { console.warn(`[TeamPulse] PR fetch failed for repo ${repo.name}:`, e.message); }
  }

  for (const m of CFG.members) {
    const allPRs = reviewerPRList[m];
    md[m].prsReviewed6mo = allPRs.length;
    md[m].prsReviewed3mo = allPRs.filter(p=>p.closedDate>=threeMonthsAgo).length;
    md[m]._prList = allPRs;
    // prsAuthored6mo = 3mo count + 6mo-only bucket
    md[m].prsAuthored6mo = md[m].prsAuthored3mo + md[m].prsAuthored6mo;
    console.log(`[TeamPulse] ${m}: reviewed 6mo=${md[m].prsReviewed6mo}, 3mo=${md[m].prsReviewed3mo} | authored 6mo=${md[m].prsAuthored6mo}, 3mo=${md[m].prsAuthored3mo}, sprint=${md[m].prsAuthoredThisSprint}`);
  }
}

async function fetchHistoricalData(ctx) {
  const { md, historyIters, currentNorm, iters3moNorm, iters6moNorm } = ctx;
  setStep(`Loading history (${historyIters.length} sprints)…`);
  for (const iter of historyIters) {
    const key    = normPath(iter.path);
    const is3mo  = iters3moNorm.has(key);
    const is6mo  = iters6moNorm.has(key);
    const isCurrent = key === currentNorm;

    if (isCurrent) {
      for (const m of CFG.members) {
        md[m].history[key] = { effort:md[m].effortDone, hours:md[m].hoursThisSprint, itemCount:md[m].itemsDoneThisSprint, peerReviewCount:md[m].peerReviewTasksThisSprint, is3mo, is6mo, isCurrent:true, iterName:iter.name, doneItems:md[m].doneItems };
      }
      continue;
    }

    const iterStart  = new Date(iter.attributes.startDate);
    const iterEnd    = iter.attributes.finishDate ? new Date(iter.attributes.finishDate) : addDays(iterStart,SPRINT_DAYS);
    const iterEndStr = isoDate(addDays(iterEnd,1));

    let hTaskIterIds = [];
    if (CFG.sprintMode !== 'dates') {
      hTaskIterIds = await projectWiqlQuery(
        `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject]='${CFG.project}' AND [System.WorkItemType]='Task' AND [System.IterationPath] UNDER '${iter.path}'`
      );
    }
    const hTaskDateIds = await orgWiqlQuery(
      `SELECT [System.Id] FROM WorkItems WHERE ${assigneeClause()} AND [System.WorkItemType]='Task' AND [System.State]='Done' AND [Microsoft.VSTS.Common.ClosedDate] >= '${isoDate(iterStart)}' AND [Microsoft.VSTS.Common.ClosedDate] <= '${iterEndStr}'`
    );
    const hTaskIds = [...new Set([...hTaskIterIds, ...hTaskDateIds])];
    const hTasks = await fetchWIBatch(hTaskIds, TASK_FIELDS);

    let hPBIPrimaryIds = [];
    if (CFG.sprintMode !== 'dates') {
      hPBIPrimaryIds = await projectWiqlQuery(
        `SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject]='${CFG.project}' AND [System.WorkItemType] IN ('Product Backlog Item','Bug') AND [System.IterationPath] UNDER '${iter.path}' AND [System.State]='Done'`
      );
    }
    const hPBIOrgIds = await orgWiqlQuery(
      `SELECT [System.Id] FROM WorkItems WHERE ${assigneeClause()} AND [System.WorkItemType] IN ('Product Backlog Item','Bug') AND [System.State]='Done' AND [Microsoft.VSTS.Common.ClosedDate] >= '${isoDate(iterStart)}' AND [Microsoft.VSTS.Common.ClosedDate] <= '${iterEndStr}'`
    );
    const allHPBIIds = [...new Set([...hPBIPrimaryIds, ...hPBIOrgIds])];
    const allHPBIs   = await fetchWIBatch(allHPBIIds, PBI_FIELDS);

    const primaryIdSet = new Set(hPBIPrimaryIds);
    const hPBIs = allHPBIs.filter(wi => {
      if (primaryIdSet.has(wi.id)) return true;
      const closedDate = wi.fields['Microsoft.VSTS.Common.ClosedDate'];
      if (!closedDate) return false;
      const cd = new Date(closedDate);
      return cd >= iterStart && cd <= addDays(iterEnd, 1);
    });

    for (const m of CFG.members) {
      let hrs=0, eff=0, prCount=0, itemCount=0;
      const sprintDoneItems = [];
      for (const t of hTasks) {
        if (matchMember(t.fields['System.AssignedTo'])!==m) continue;
        const tClosed = t.fields['Microsoft.VSTS.Common.ClosedDate'];
        if (!tClosed) continue;
        const tcd = new Date(tClosed);
        if (tcd < iterStart || tcd > addDays(iterEnd, 1)) continue;
        hrs += t.fields['Microsoft.VSTS.Scheduling.CompletedWork']||0;
        if (/peer.?review/i.test(t.fields['System.Title']||'') && t.fields['System.State']==='Done') prCount++;
      }
      for (const p of hPBIs) {
        if (matchMember(p.fields['System.AssignedTo'])!==m) continue;
        eff += effortOf(p);
        itemCount++;
        sprintDoneItems.push({ id:p.id, title:p.fields['System.Title']||'', type:p.fields['System.WorkItemType'], pts:effortOf(p), project:projectOf(p), url:wiUrl(p) });
      }
      md[m].history[key] = { effort:eff, hours:hrs, itemCount, peerReviewCount:prCount, is3mo, is6mo, isCurrent:false, iterName:iter.name, doneItems:sprintDoneItems };
    }
  }
}

async function calculateCompletionTimes(ctx) {
  const { md, threeMonthsAgo } = ctx;
  setStep('Calculating completion times…');
  const recentDoneIds = await orgWiqlQuery(
    `SELECT [System.Id] FROM WorkItems WHERE ${assigneeClause()} AND [System.WorkItemType] IN ('Product Backlog Item','Bug') AND [System.State]='Done' AND [System.ChangedDate] >= '${isoDate(threeMonthsAgo)}' ORDER BY [System.ChangedDate] DESC`
  );
  for (let i=0; i<recentDoneIds.length; i+=COMPLETION_CONCURRENCY) {
    setStep(`Completion times… (${Math.min(i+COMPLETION_CONCURRENCY,recentDoneIds.length)}/${recentDoneIds.length})`);
    await Promise.all(recentDoneIds.slice(i,i+COMPLETION_CONCURRENCY).map(async id => {
      try {
        const updates = await fetchWIUpdates(id);
        let assignee=null, activeDate=null, doneDate=null;
        for (const update of updates) {
          const fields=update.fields||{};
          if (fields['System.AssignedTo']) { const candidate=matchMember(fields['System.AssignedTo'].newValue); if(candidate) assignee=candidate; }
          if (fields['System.State']) {
            const state=fields['System.State'].newValue, timestamp=new Date(update.revisedDate||update.authorizedDate);
            if ((state==='Committed'||state==='Active')&&!activeDate) activeDate=timestamp;
            if (state==='Done') doneDate=timestamp;
          }
        }
        if (assignee&&activeDate&&doneDate) {
          const days=(doneDate-activeDate)/MS_PER_DAY;
          if (days>=0&&days<365) md[assignee].completionDays.push(days);
        }
      } catch(e) { console.warn(`[TeamPulse] Completion time calc failed for WI ${id}:`, e.message); }
    }));
  }
  return recentDoneIds;
}

async function analyzeDesignReviews(ctx, recentDoneIds) {
  const { md } = ctx;
  setStep('Analysing Design Review tag cycling…');

  const currentSprintPBIIds = CFG.members.flatMap(m => md[m].allSprintPBIs.map(i => i.id));
  const allDRCandidateIds   = [...new Set([...recentDoneIds, ...currentSprintPBIIds])];

  const drItemMeta = {};
  CFG.members.forEach(m => {
    md[m].allSprintPBIs.forEach(i => { drItemMeta[i.id] = { title:i.title, url:i.url, project:i.project, member:m }; });
    md[m].doneItems.forEach(i => { if (!drItemMeta[i.id]) drItemMeta[i.id] = { title:i.title, url:i.url, project:i.project, member:m }; });
    Object.values(md[m].history).forEach(h => {
      (h.doneItems||[]).forEach(i => { if (!drItemMeta[i.id]) drItemMeta[i.id] = { title:i.title, url:i.url, project:i.project, member:m }; });
    });
  });

  const missingIds = allDRCandidateIds.filter(id => !drItemMeta[id]);
  if (missingIds.length > 0) {
    setStep(`Design Review: fetching metadata for ${missingIds.length} additional items…`);
    const missingItems = await fetchWIBatch(missingIds, PBI_FIELDS);
    for (const wi of missingItems) {
      const m = matchMember(wi.fields['System.AssignedTo']);
      if (!m) continue;
      drItemMeta[wi.id] = {
        title:   wi.fields['System.Title'] || '',
        url:     wiUrl(wi),
        project: projectOf(wi),
        member:  m,
      };
    }
  }

  console.log(`[TeamPulse] Design Review: scanning ${allDRCandidateIds.length} items (${missingIds.length} metadata fetched fresh)`);

  const drAdditionCounts = {};
  for (let i = 0; i < allDRCandidateIds.length; i += COMPLETION_CONCURRENCY) {
    setStep(`Design Review scan… (${Math.min(i+COMPLETION_CONCURRENCY, allDRCandidateIds.length)}/${allDRCandidateIds.length})`);
    await Promise.all(allDRCandidateIds.slice(i, i+COMPLETION_CONCURRENCY).map(async id => {
      try {
        const updates = await fetchWIUpdates(id);
        let addCount = 0;
        for (const u of updates) {
          const f = u.fields || {};
          if (!f['System.Tags']) continue;
          const oldTags = (f['System.Tags'].oldValue || '').toLowerCase();
          const newTags = (f['System.Tags'].newValue || '').toLowerCase();
          const wasPresent = oldTags.split(';').map(t => t.trim()).includes('design review');
          const isPresent  = newTags.split(';').map(t => t.trim()).includes('design review');
          if (isPresent && !wasPresent) addCount++;
        }
        if (addCount > 0) drAdditionCounts[id] = addCount;
      } catch(e) { console.warn(`[TeamPulse] DR tag scan failed for WI ${id}:`, e.message); }
    }));
  }

  console.log(`[TeamPulse] Design Review: ${Object.keys(drAdditionCounts).length} items had the tag added at least once`);

  for (const [idStr, addCount] of Object.entries(drAdditionCounts)) {
    const id   = parseInt(idStr, 10);
    const meta = drItemMeta[id];
    if (!meta || !meta.member || !md[meta.member]) continue;
    const item = { id, addCount, title: meta.title, url: meta.url, project: meta.project };
    md[meta.member].designReviewItems.push(item);
    if (addCount > 1) md[meta.member].designReviewFlagged.push(item);
  }

  console.log('[TeamPulse] Design Review scan complete',
    Object.fromEntries(CFG.members.map(m => [m, `${md[m].designReviewItems.length} items tracked, ${md[m].designReviewFlagged.length} flagged`]))
  );
}

// ── MAIN DATA BUILD ───────────────────────────────────────────────────────────
async function buildDashboard() {
  const now            = new Date();
  const threeMonthsAgo = subMonths(now, 3);
  const sixMonthsAgo   = subMonths(now, 6);
  const twelveMonthsAgo= subMonths(now, 12);

  setStep('Fetching iterations…');
  const { currentIter, sprintStart, sprintEnd, historyIters, iters3moNorm, iters6moNorm } =
    await resolveIterations(now, threeMonthsAgo, sixMonthsAgo, twelveMonthsAgo);

  const sprintPath  = currentIter.path;
  const currentNorm = normPath(sprintPath);
  const md = initMemberBuckets();
  const ctx = { md, now, threeMonthsAgo, sixMonthsAgo, sprintStart, sprintEnd, sprintPath, currentNorm, historyIters, iters3moNorm, iters6moNorm };

  await fetchChangedPBIsAndBugs(ctx);
  await fetchChangedFeatures(ctx);
  await fetchDoneItems(ctx);
  await fetchAllSprintPBIs(ctx);
  await fetchSprintTasks(ctx);
  await fetchCreatedItems(ctx);
  await fetchPeerReviewTasks(ctx);
  if (CFG.relatedProjects?.length) await fetchPRData(ctx);
  await fetchHistoricalData(ctx);
  const recentDoneIds = await calculateCompletionTimes(ctx);
  if (CFG.designReviewEnabled) await analyzeDesignReviews(ctx, recentDoneIds);

  setStep('Rendering…');
  return { md, currentIter, sprintStart, sprintEnd, historyIters, iters3moNorm, iters6moNorm };
}


// ── RENDER HELPERS ────────────────────────────────────────────────────────────
const avg      = arr     => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : null;
const fmt      = (n,d=1) => n===null||n===undefined ? '—' : Number(n).toFixed(d);
const fmtInt   = n       => n===null||n===undefined ? '—' : String(Math.round(n));
const esc      = s       => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const projBadge = p => p ? `<span class="proj-badge">${esc(p)}</span>` : '';

function toggleDrill(id, triggerEl) {
  const el = document.getElementById(id);
  if (!el) return;
  let isOpen;
  if (el.classList.contains('hist-drill-row')) {
    // History table rows toggle via display style
    el.style.display = el.style.display === 'none' ? 'table-row' : 'none';
    isOpen = el.style.display === 'table-row';
  } else if (el.classList.contains('psb-comments-list')) {
    // PR comment lists toggle via display style
    const wasOpen = el.style.display !== 'none';
    el.style.display = wasOpen ? 'none' : 'block';
    isOpen = !wasOpen;
    if (triggerEl) {
      const span = triggerEl.querySelector('span');
      if (span) span.textContent = isOpen ? '▼ Hide individual comments' : '▶ View individual comments';
    }
  } else if (el.classList.contains('drill-panel') && el.style.display !== undefined && !el.closest('table')) {
    // Standalone drill panels (e.g. team DR flagged list) outside tables —
    // toggle display style directly since .open only works inside table contexts
    el.style.display = el.style.display === 'none' ? 'block' : 'none';
    isOpen = el.style.display === 'block';
  } else {
    // In-table drill panels use the .open class (CSS handles display)
    el.classList.toggle('open');
    isOpen = el.classList.contains('open');
  }
  if (triggerEl && triggerEl.hasAttribute('aria-expanded')) {
    triggerEl.setAttribute('aria-expanded', String(isOpen));
  }
}

function fill(id, rows) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = rows.length ? rows.join('') : '<div class="drill-empty">No items found</div>';
}

const dr = (label, id, val, cls='') =>
  `<tr class="data-row drillable" tabindex="0" role="button" aria-expanded="false" onclick="toggleDrill('${id}',this)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleDrill('${id}',this)}">
    <td class="metric-label">${label} <span class="drill-icon">▾</span></td>
    <td class="metric-value ${cls}">${val}</td>
   </tr>
   <tr><td colspan="2" style="padding:0;"><div class="drill-panel" id="${id}"></div></td></tr>`;

const diRow = (i, typeLabel, typeClass, valHtml) =>
  `<div class="drill-item">
    <div class="drill-item-meta">
      <a href="${i.url}" target="_blank">#${i.id}<span class="sr-only"> (opens in new tab)</span></a>
      ${projBadge(i.project)}
      <span class="di-type ${typeClass}">${typeLabel}</span>
      ${valHtml}
    </div>
    <span class="di-title">${esc(i.title)}</span>
   </div>`;

// ── CHART BUILDERS ────────────────────────────────────────────────────────────
function buildBarChart(data, color, unit='pts', height=120) {
  if (!data.length) return '<div style="color:var(--muted2);font-family:DM Mono,monospace;font-size:0.75rem;padding:0.5rem 0;">No data</div>';
  const W = CHART_WIDTH, BAR_GAP = CHART_BAR_GAP;
  const validData = data.map(d => ({ ...d, value: d.value ?? 0 }));
  const maxVal = Math.max(...validData.map(d => d.value), 1);
  const barW = Math.floor((W - BAR_GAP * (validData.length + 1)) / validData.length);
  const chartH = height;
  const labelH = 44;
  const totalH  = chartH + labelH;

  const bars = validData.map((d, i) => {
    const x    = BAR_GAP + i * (barW + BAR_GAP);
    const barH = Math.max(2, Math.round((d.value / maxVal) * chartH * CHART_SCALE));
    const y    = chartH - barH;
    const op   = d.isCurrent ? '1' : '0.4';
    const valY = y - 4;
    const valStr = unit === 'h' ? Number(d.value).toFixed(1) : Math.round(d.value);
    return `
      <rect class="chart-bar" x="${x}" y="${y}" width="${barW}" height="${barH}"
            fill="var(${color})" opacity="${op}" rx="1"/>
      ${d.value > 0 ? `<text class="chart-value" x="${x + barW/2}" y="${valY}" text-anchor="middle">${valStr}</text>` : ''}
      <text class="chart-label" x="${x + barW/2}" y="${chartH + 14}" text-anchor="end"
            transform="rotate(-40, ${x + barW/2}, ${chartH + 14})">${esc(d.label)}</text>
    `;
  }).join('');

  const summaryText = validData.map(d => `${d.label}: ${unit === 'h' ? Number(d.value).toFixed(1) : Math.round(d.value)}`).join(', ');
  return `<svg class="chart-svg" viewBox="0 0 ${W} 180" style="height:190px;" role="img" aria-label="Bar chart: ${summaryText}">
    <line class="chart-axis" x1="0" y1="${chartH}" x2="${W}" y2="${chartH}"/>
    ${bars}
  </svg>`;
}

function buildSparkline(values, color=null, W=72, H=20) {
  if (!values.length) return '';
  const strokeColor = !color ? 'var(--accent)' : color.startsWith('#') ? color : `var(${color})`;
  const dotColor    = strokeColor;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => {
    const x = values.length === 1 ? W/2 : Math.round(i * W / (values.length - 1));
    const y = H - Math.round((v / max) * H * CHART_SCALE) - 1;
    return `${x},${y}`;
  });
  return `<svg class="sparkline-svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="vertical-align:middle;" role="img" aria-label="Sparkline trend: ${values.join(', ')}">
    <polyline class="spark-line" points="${pts.join(' ')}" stroke="${strokeColor}" opacity="0.6"/>
    ${pts.map((p, i) => {
      const [x, y] = p.split(',');
      const isCur = i === pts.length - 1;
      return `<circle cx="${x}" cy="${y}" r="${isCur?2.8:1.5}" fill="${dotColor}" opacity="${isCur?1:0.5}"/>`;
    }).join('')}
  </svg>`;
}

// ── TEAM TAB ──────────────────────────────────────────────────────────────────
function renderTeamTab(md, currentIter, historyIters, iters3moNorm, iters6moNorm) {
  const members = CFG.members;

  const teamEffortDone    = members.reduce((s,m)=>s+md[m].effortDone, 0);
  const teamItemsDone     = members.reduce((s,m)=>s+md[m].itemsDoneThisSprint, 0);
  const teamHours         = members.reduce((s,m)=>s+md[m].hoursThisSprint, 0);
  const teamPBIs          = members.reduce((s,m)=>s+md[m].pbisChanged.size, 0);
  const teamBugs          = members.reduce((s,m)=>s+md[m].bugsChanged.size, 0);
  const teamPRReviews3mo  = members.reduce((s,m)=>s+md[m].prsReviewed3mo, 0);
  const teamPRsAuthored3mo= members.reduce((s,m)=>s+md[m].prsAuthored3mo, 0);
  const allCompletionDays = members.flatMap(m=>md[m].completionDays);
  const teamAvgTurnaround = avg(allCompletionDays);

  const keys    = historyIters.map(i=>normPath(i.path));
  const lastKey = keys[keys.length-1]||'';
  const keys6mo = keys.filter(k=>iters6moNorm.has(k)||k===lastKey);
  const keys3mo = keys.filter(k=>iters3moNorm.has(k)||k===lastKey);

  const teamEffortPerSprint = (ks) => avg(ks.map(k => members.reduce((s,m)=>s+(md[m].history[k]?.effort??0),0)));
  const teamItemsPerSprint  = (ks) => avg(ks.map(k => members.reduce((s,m)=>s+(md[m].history[k]?.itemCount??0),0)));
  const vel3mo   = teamEffortPerSprint(keys3mo);
  const vel6mo   = teamEffortPerSprint(keys6mo);
  const items3mo = teamItemsPerSprint(keys3mo);
  const items6mo = teamItemsPerSprint(keys6mo);
  let html = '';

  // Design review team stats
  const drEnabled = CFG.designReviewEnabled;
  const allDRItems = drEnabled ? members.flatMap(m => md[m].designReviewItems) : [];
  const teamDRAvg  = drEnabled && allDRItems.length ? avg(allDRItems.map(i => i.addCount)) : null;
  const teamDRFlagged = drEnabled ? members.reduce((s,m) => s + md[m].designReviewFlagged.length, 0) : 0;

  // ── Current sprint stats ─────────────────────────────────────────────────
  const teamPRsAuthoredThisSprint = CFG.relatedProjects?.length
    ? members.reduce((s,m) => s + (md[m].prsAuthoredThisSprint||0), 0) : null;

  html += `<h2 class="section-title">TEAM HEALTH — ${esc(currentIter.name)}</h2>`;
  html += `<div class="stat-grid">
    <div class="stat-cell"><div class="stat-label">Effort pts done</div><div class="stat-value accent">${fmtInt(teamEffortDone)}</div></div>
    <div class="stat-cell"><div class="stat-label">Items done</div><div class="stat-value accent">${teamItemsDone}</div><div class="stat-sub">PBIs + Bugs closed</div></div>
    <div class="stat-cell"><div class="stat-label">Hours logged</div><div class="stat-value">${fmt(teamHours)}</div></div>
    <div class="stat-cell"><div class="stat-label">PBIs touched</div><div class="stat-value accent4">${teamPBIs}</div></div>
    <div class="stat-cell"><div class="stat-label">Bugs touched</div><div class="stat-value accent2">${teamBugs}</div></div>
    ${teamPRsAuthoredThisSprint !== null ? `<div class="stat-cell"><div class="stat-label">PRs authored</div><div class="stat-value accent4">${teamPRsAuthoredThisSprint}</div><div class="stat-sub">this sprint</div></div>` : ''}
  </div>`;

  // ── Team averages + historical metrics ───────────────────────────────────
  html += `<h2 class="section-title" style="margin-top:2rem;">TEAM AVERAGES</h2>`;
  html += `<div class="stat-grid">
    <div class="stat-cell"><div class="stat-label">Avg pts / sprint (3mo)</div><div class="stat-value">${vel3mo!==null?fmt(vel3mo,1)+' pts':'—'}</div></div>
    <div class="stat-cell"><div class="stat-label">Avg pts / sprint (6mo)</div><div class="stat-value">${vel6mo!==null?fmt(vel6mo,1)+' pts':'—'}</div></div>
    <div class="stat-cell"><div class="stat-label">Avg items / sprint (3mo)</div><div class="stat-value accent4">${items3mo!==null?fmt(items3mo,1):'—'}</div></div>
    <div class="stat-cell"><div class="stat-label">Avg items / sprint (6mo)</div><div class="stat-value accent4">${items6mo!==null?fmt(items6mo,1):'—'}</div></div>
    <div class="stat-cell"><div class="stat-label">Avg turnaround</div><div class="stat-value accent3">${teamAvgTurnaround!==null?fmt(teamAvgTurnaround,1)+' days':'—'}</div><div class="stat-sub">PBI start→done, 3mo</div></div>
    ${CFG.relatedProjects?.length ? `<div class="stat-cell"><div class="stat-label">PRs reviewed (3mo)</div><div class="stat-value">${teamPRReviews3mo}</div></div>` : ''}
    ${CFG.relatedProjects?.length ? `<div class="stat-cell"><div class="stat-label">PRs authored (3mo)</div><div class="stat-value accent4">${teamPRsAuthored3mo}</div></div>` : ''}
    ${drEnabled ? `<div class="stat-cell"><div class="stat-label">Avg Design Reviews / Item</div><div class="stat-value ${teamDRAvg!==null&&teamDRAvg>1?'accent2':''}">${teamDRAvg!==null?fmt(teamDRAvg,1):'—'}</div><div class="stat-sub">target: 1.0 · 3mo</div></div>` : ''}
    ${drEnabled ? `<div class="stat-cell"><div class="stat-label">Items w/ Repeated Design Reviews</div><div class="stat-value ${teamDRFlagged>0?'accent2':''}">${teamDRFlagged}</div><div class="stat-sub">across team · 3mo</div></div>` : ''}
  </div>`;

  // DR flagged items — own section with an explicit show/hide button
  if (drEnabled) {
    const allFlagged = members
      .flatMap(m => md[m].designReviewFlagged.map(i => ({ ...i, member: m })))
      .sort((a,b) => b.addCount - a.addCount);

    html += `<h2 class="section-title" style="margin-top:2rem;display:flex;align-items:center;justify-content:space-between;">
      <span>ITEMS WITH REPEATED DESIGN REVIEWS</span>
      ${allFlagged.length > 0
        ? `<button aria-label="Show items with repeated design reviews (${allFlagged.length})" onclick="
            var p=document.getElementById('team-dr-list');
            var b=this;
            if(p.style.display==='none'){p.style.display='block';b.textContent='Hide list';b.setAttribute('aria-label','Hide items with repeated design reviews');}
            else{p.style.display='none';b.textContent='Show list (${allFlagged.length})';b.setAttribute('aria-label','Show items with repeated design reviews (${allFlagged.length})');}
           " style="font-family:'DM Mono',monospace;font-size:0.72rem;background:none;border:1px solid var(--border);color:var(--accent4);padding:0.25rem 0.7rem;border-radius:2px;cursor:pointer;">Show list (${allFlagged.length})</button>`
        : ''
      }
    </h2>`;

    if (allFlagged.length > 0) {
      html += `<div id="team-dr-list" style="display:none;background:var(--surface);border:1px solid var(--border);">`;
      let lastMember = null;
      allFlagged.forEach(i => {
        if (i.member !== lastMember) {
          html += `<div style="padding:0.4rem 0.75rem 0.15rem;font-family:'DM Mono',monospace;font-size:0.68rem;letter-spacing:0.08em;text-transform:uppercase;color:var(--label);border-top:1px solid var(--border);">${esc(i.member)}</div>`;
          lastMember = i.member;
        }
        html += `<div class="drill-item">
          <div class="drill-item-meta">
            <a href="${i.url}" target="_blank">#${i.id}<span class="sr-only"> (opens in new tab)</span></a>
            ${projBadge(i.project)}
            <span class="di-type di-type-pbi" style="background:rgba(196,82,82,0.15);color:var(--accent2);">DR ×${i.addCount}</span>
          </div>
          <span class="di-title">${esc(i.title)}</span>
        </div>`;
      });
      html += `</div>`;
    } else {
      html += `<div style="background:var(--surface);border:1px solid var(--border);padding:0.85rem 1rem;font-family:'DM Mono',monospace;font-size:0.78rem;color:var(--muted);">No items required more than one Design Review in the last 3 months.</div>`;
    }
  }

  const teamEffortBySprintData = historyIters.map(iter => ({
    label: iter.name.replace(/^[^\d]*(\d)/, '$1'),
    value: members.reduce((s,m) => s + (md[m].history[normPath(iter.path)]?.effort ?? 0), 0),
    isCurrent: normPath(iter.path) === lastKey,
  }));
  const teamHoursBySprintData = historyIters.map(iter => ({
    label: iter.name.replace(/^[^\d]*(\d)/, '$1'),
    value: members.reduce((s,m) => s + (md[m].history[normPath(iter.path)]?.hours ?? 0), 0),
    isCurrent: normPath(iter.path) === lastKey,
  }));

  html += `<h2 class="section-title" style="margin-top:2rem;">TEAM VELOCITY — EFFORT POINTS PER SPRINT</h2>`;
  html += `<div class="chart-wrap">${buildBarChart(teamEffortBySprintData, '--accent', 'pts')}</div>`;
  html += `<h2 class="section-title" style="margin-top:1.5rem;">TEAM VELOCITY — HOURS LOGGED PER SPRINT</h2>`;
  html += `<div class="chart-wrap">${buildBarChart(teamHoursBySprintData, '--accent4', 'h')}</div>`;

  html += `<h2 class="section-title" style="margin-top:2rem;">MEMBER VELOCITY TRENDS</h2>`;
  html += `<div style="background:var(--surface);border:1px solid var(--border);padding:1.25rem;">`;
  html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:1.25rem 2rem;">`;
  members.forEach((m, idx) => {
    const d = md[m];
    const color = MEMBER_COLORS[idx % MEMBER_COLORS.length];
    const effortVals = historyIters.map(i => d.history[normPath(i.path)]?.effort ?? 0);
    const avgV = avg(keys3mo.map(k => d.history[k]?.effort ?? 0));
    html += `<div>
      <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.5rem;">
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};flex-shrink:0;"></span>
        <span style="font-family:'DM Sans',sans-serif;font-size:0.85rem;font-weight:500;">${esc(m)}</span>
        <span style="font-family:'DM Mono',monospace;font-size:0.72rem;color:var(--muted2);margin-left:auto;">${avgV!==null?fmt(avgV,0)+' pts avg':''}</span>
      </div>
      ${buildSparkline(effortVals, color.startsWith('#') ? null : color)}
    </div>`;
  });
  html += `</div></div>`;

  html += `<h2 class="section-title" style="margin-top:2rem;">MEMBER OVERVIEW — click to view full profile</h2>`;
  html += '<div class="members-grid">';
  members.forEach((m,idx) => {
    const d = md[m], color = MEMBER_COLORS[idx%MEMBER_COLORS.length];
    const avgComp = avg(d.completionDays);
    const vel3 = avg(keys3mo.map(k=>d.history[k]?.effort??0));
    html += `<div class="member-card" style="--member-color:${color}" role="button" tabindex="0" aria-label="View ${esc(m)} full profile" onclick="switchToMember(${idx})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();switchToMember(${idx})}">
      <div class="member-card-name">${esc(m)}</div>
      <div class="member-card-hint">Click for full profile →</div>
      <div class="member-card-stats">
        <div class="mcs-item"><div class="mcs-label">Effort done</div><div class="mcs-value accent">${fmtInt(d.effortDone)} pts</div></div>
        <div class="mcs-item"><div class="mcs-label">Items done</div><div class="mcs-value accent">${d.itemsDoneThisSprint}</div></div>
        <div class="mcs-item"><div class="mcs-label">Hours</div><div class="mcs-value">${fmt(d.hoursThisSprint)} h</div></div>
        <div class="mcs-item"><div class="mcs-label">PBIs touched</div><div class="mcs-value accent4">${d.pbisChanged.size}</div></div>
        ${CFG.relatedProjects?.length ? `<div class="mcs-item"><div class="mcs-label">PRs reviewed (3mo)</div><div class="mcs-value">${d.prsReviewed3mo}</div></div>` : ''}
        ${CFG.relatedProjects?.length ? `<div class="mcs-item"><div class="mcs-label">PRs authored (3mo)</div><div class="mcs-value accent4">${d.prsAuthored3mo}</div></div>` : ''}
        <div class="mcs-item"><div class="mcs-label">Avg velocity (3mo)</div><div class="mcs-value">${vel3!==null?fmt(vel3,1)+' pts':'—'}</div></div>
        <div class="mcs-item"><div class="mcs-label">Avg turnaround</div><div class="mcs-value accent3">${avgComp!==null?fmt(avgComp,1)+' d':'—'}</div></div>
      </div>
    </div>`;
  });
  html += '</div>';

  return html;
}

// ── MEMBER TAB ────────────────────────────────────────────────────────────────
function renderMemberTab(m, md, currentIter, historyIters, iters3moNorm, iters6moNorm) {
  const d    = md[m];
  const slug = m.replace(/\s+/g,'-').replace(/[^a-zA-Z0-9-]/g,'');
  const keys = historyIters.map(i=>normPath(i.path));
  const lastKey = keys[keys.length-1]||'';
  const keys3mo = keys.filter(k=>iters3moNorm.has(k)||k===lastKey);
  const keys6mo = keys.filter(k=>iters6moNorm.has(k)||k===lastKey);

  const vel3mo  = avg(keys3mo.map(k=>d.history[k]?.effort??0));
  const vel6mo  = avg(keys6mo.map(k=>d.history[k]?.effort??0));
  const items3moAvg = avg(keys3mo.map(k=>d.history[k]?.itemCount??0));
  const items6moAvg = avg(keys6mo.map(k=>d.history[k]?.itemCount??0));
  const hrs3mo  = avg(keys3mo.map(k=>d.history[k]?.hours??0));
  const hrs6mo  = avg(keys6mo.map(k=>d.history[k]?.hours??0));
  const pr3mo   = avg(keys3mo.map(k=>d.history[k]?.peerReviewCount??0));
  const pr6mo   = avg(keys6mo.map(k=>d.history[k]?.peerReviewCount??0));
  const avgComp = avg(d.completionDays);
  const totalItems = d.pbisChanged.size + d.bugsChanged.size;
  const hoursPerItem = totalItems > 0 ? d.hoursThisSprint / totalItems : null;

  let html = `<div class="member-layout">`;

  // ── Left sidebar ────────────────────────────────────────────────────────
  html += `<div class="member-sidebar">`;
  html += `<h2 class="section-title">CURRENT SPRINT — ${esc(currentIter.name)}</h2>`;
  html += `<div style="background:var(--surface);border:1px solid var(--muted2);padding:1.25rem;border-radius:12px;">
    <table class="metrics-table"><caption class="sr-only">Current sprint metrics for ${esc(m)}</caption>
      <tr class="metric-section-row"><td colspan="2">EFFORT</td></tr>
      ${dr('Effort pts marked Done', `drill-done-${slug}`, fmtInt(d.effortDone), 'accent')}
      ${dr('Assigned effort pts', `drill-assigned-${slug}`, fmtInt(d.effortThisSprint), '')}

      <tr class="metric-section-row"><td colspan="2">ACTIVITY</td></tr>
      <tr class="data-row"><td class="metric-label">Items done (PBIs + Bugs)</td><td class="metric-value accent">${d.itemsDoneThisSprint}</td></tr>
      ${dr('PBIs touched', `drill-pbis-${slug}`, d.pbisChanged.size, 'accent4')}
      ${dr('Bugs touched', `drill-bugs-${slug}`, d.bugsChanged.size, 'accent2')}
      ${dr('Features touched', `drill-feats-${slug}`, d.featuresChanged.size, '')}
      <tr class="data-row"><td class="metric-label">PRs linked to PBIs</td><td class="${d.prCount>0?'metric-value pr-yes':'metric-value pr-no'}">${d.prCount>0?'✓ '+d.prCount:'—'}</td></tr>
      ${CFG.relatedProjects?.length ? `<tr class="data-row"><td class="metric-label">PRs authored this sprint</td><td class="metric-value accent4">${d.prsAuthoredThisSprint||'—'}</td></tr>` : ''}
      <tr class="data-row"><td class="metric-label">Peer review tasks done</td><td class="metric-value accent3">${d.peerReviewTasksThisSprint||'—'}</td></tr>

      <tr class="metric-section-row"><td colspan="2">HOURS</td></tr>
      ${dr('Hours logged', `drill-hours-${slug}`, fmt(d.hoursThisSprint), 'accent')}
      <tr class="data-row"><td class="metric-label">Avg hours per item</td><td class="metric-value">${hoursPerItem!==null?fmt(hoursPerItem):'—'}</td></tr>
    </table>
  </div>`;

  html += `<h2 class="section-title" style="margin-top:2rem;">AVERAGES OVER TIME</h2>`;
  html += `<div style="background:var(--surface);border:1px solid var(--muted2);padding:1.25rem;border-radius:12px;">
    <table class="metrics-table"><caption class="sr-only">Historical averages for ${esc(m)}</caption>
      <tr class="metric-section-row"><td colspan="2">VELOCITY (effort pts)</td></tr>
      <tr class="data-row"><td class="metric-label">Avg / sprint (3mo)</td><td class="metric-value accent">${vel3mo!==null?fmt(vel3mo,1)+' pts':'—'}</td></tr>
      <tr class="data-row"><td class="metric-label">Avg / sprint (6mo)</td><td class="metric-value">${vel6mo!==null?fmt(vel6mo,1)+' pts':'—'}</td></tr>

      <tr class="metric-section-row"><td colspan="2">ITEMS DONE (PBIs + Bugs)</td></tr>
      <tr class="data-row"><td class="metric-label">Avg items / sprint (3mo)</td><td class="metric-value accent">${items3moAvg!==null?fmt(items3moAvg,1):'—'}</td></tr>
      <tr class="data-row"><td class="metric-label">Avg items / sprint (6mo)</td><td class="metric-value">${items6moAvg!==null?fmt(items6moAvg,1):'—'}</td></tr>

      <tr class="metric-section-row"><td colspan="2">HOURS</td></tr>
      <tr class="data-row"><td class="metric-label">Avg hrs / sprint (3mo)</td><td class="metric-value">${hrs3mo!==null?fmt(hrs3mo)+' h':'—'}</td></tr>
      <tr class="data-row"><td class="metric-label">Avg hrs / sprint (6mo)</td><td class="metric-value">${hrs6mo!==null?fmt(hrs6mo)+' h':'—'}</td></tr>

      <tr class="metric-section-row"><td colspan="2">COMPLETION TIME</td></tr>
      <tr class="data-row"><td class="metric-label">Avg start → done (3mo)</td><td class="metric-value accent3">${avgComp!==null?fmt(avgComp,1)+' days':'—'}</td></tr>

      ${CFG.designReviewEnabled ? `
      <tr class="metric-section-row"><td colspan="2">DESIGN REVIEW CYCLING (3mo)</td></tr>
      <tr class="data-row">
        <td class="metric-label">Avg Design Reviews / Item</td>
        <td class="metric-value ${d.designReviewItems.length && avg(d.designReviewItems.map(i=>i.addCount))>1?'accent2':'accent'}">
          ${d.designReviewItems.length ? fmt(avg(d.designReviewItems.map(i=>i.addCount)),1) : '—'}
        </td>
      </tr>
      <tr class="data-row drillable" tabindex="0" role="button" aria-expanded="false" onclick="toggleDrill('drill-dr-all-${slug}',this)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleDrill('drill-dr-all-${slug}',this)}">
        <td class="metric-label">Items that entered Design Review <span class="drill-icon">▾</span></td>
        <td class="metric-value">${d.designReviewItems.length||'0'}</td>
      </tr>
      <tr><td colspan="2" style="padding:0;"><div class="drill-panel" id="drill-dr-all-${slug}"></div></td></tr>
      <tr class="data-row drillable" tabindex="0" role="button" aria-expanded="false" onclick="toggleDrill('drill-dr-flagged-${slug}',this)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleDrill('drill-dr-flagged-${slug}',this)}">
        <td class="metric-label">Items w/ Repeated Design Reviews <span class="drill-icon">▾</span></td>
        <td class="metric-value ${d.designReviewFlagged.length>0?'accent2':''}">${d.designReviewFlagged.length||'0'}</td>
      </tr>
      <tr><td colspan="2" style="padding:0;"><div class="drill-panel" id="drill-dr-flagged-${slug}"></div></td></tr>
      ` : ''}

      ${CFG.relatedProjects?.length ? `<tr class="metric-section-row"><td colspan="2">PULL REQUESTS</td></tr>
      <tr class="data-row"><td class="metric-label">PRs authored (3mo)</td><td class="metric-value accent4">${d.prsAuthored3mo}</td></tr>
      <tr class="data-row"><td class="metric-label">PRs authored (6mo)</td><td class="metric-value">${d.prsAuthored6mo}</td></tr>
      <tr class="data-row"><td class="metric-label">PRs reviewed (3mo)</td><td class="metric-value accent4">${d.prsReviewed3mo}</td></tr>
      <tr class="data-row"><td class="metric-label">PRs reviewed (6mo)</td><td class="metric-value">${d.prsReviewed6mo}</td></tr>` : ''}
      <tr class="data-row"><td class="metric-label">Peer review tasks / sprint (3mo avg)</td><td class="metric-value">${pr3mo!==null?fmt(pr3mo,1):'—'}</td></tr>
      <tr class="data-row"><td class="metric-label">Peer review tasks / sprint (6mo avg)</td><td class="metric-value">${pr6mo!==null?fmt(pr6mo,1):'—'}</td></tr>
      <tr class="data-row"><td class="metric-label">Avg hrs per review task (3mo)</td><td class="metric-value accent3">${d.peerReviewHoursPerTask3mo!==null?fmt(d.peerReviewHoursPerTask3mo)+' h':'—'}</td></tr>

      <tr class="metric-section-row"><td colspan="2">ITEMS CREATED (3mo)</td></tr>
      <tr class="data-row"><td class="metric-label">PBIs created</td><td class="metric-value">${d.pbisCreated3mo}</td></tr>
      <tr class="data-row"><td class="metric-label">Bugs created</td><td class="metric-value accent2">${d.bugsCreated3mo}</td></tr>
    </table>
  </div>`;

  html += `</div>`; // end sidebar

  // ── Right main ──────────────────────────────────────────────────────────
  html += `<div class="member-main">`;

  // PR Comments box
  if (CFG.relatedProjects?.length) {
    html += `<h2 class="section-title">CODE REVIEW FOCUS</h2>
    <div class="pr-summary-box">
      <div class="psb-header">
        <span class="psb-title">PR Review Comments (3mo)</span>
        <button class="btn-summarize" id="btn-sum-${slug}" onclick="fetchComments('${slug}','${m.replace(/'/g, "\\'")}')">
          &#8595; Load Comments
        </button>
      </div>
      <div class="psb-comment-count">${d.prsReviewed3mo} PRs reviewed · comments fetched on demand</div>
      <button type="button" class="psb-comments-toggle" id="psb-comments-toggle-${slug}" style="display:none;"
           aria-expanded="false"
           onclick="toggleDrill('psb-comments-${slug}', this)"
           onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleDrill('psb-comments-${slug}', this)}">
        <span>&#9654; View individual comments</span>
      </button>
      <div class="psb-comments-list" id="psb-comments-${slug}" style="display:none;"></div>
    </div>`;
  }

  // Sprint history
  html += `<h2 class="section-title" style="margin-top:2rem;">SPRINT HISTORY — EFFORT & HOURS</h2>`;
  html += buildMemberHistoryTable(d, historyIters, slug);

  const effortChartData = [...historyIters].map(iter => ({
    label: iter.name.replace(/^.*?(\d)/, '$1'),
    value: d.history[normPath(iter.path)]?.effort ?? 0,
    isCurrent: normPath(iter.path) === normPath(historyIters[historyIters.length-1]?.path||''),
  }));
  const hoursChartData = [...historyIters].map(iter => ({
    label: iter.name.replace(/^.*?(\d)/, '$1'),
    value: d.history[normPath(iter.path)]?.hours ?? 0,
    isCurrent: normPath(iter.path) === normPath(historyIters[historyIters.length-1]?.path||''),
  }));

  html += `<h2 class="section-title" style="margin-top:2rem;">VELOCITY TREND — EFFORT POINTS</h2>`;
  html += `<div class="chart-wrap">${buildBarChart(effortChartData, '--accent', 'pts')}</div>`;
  html += `<h2 class="section-title" style="margin-top:1.5rem;">VELOCITY TREND — HOURS LOGGED</h2>`;
  html += `<div class="chart-wrap">${buildBarChart(hoursChartData, '--accent4', 'h')}</div>`;

  if (d.completionDays.length > 0) {
    const buckets = [
      { label:'<1d',  value: d.completionDays.filter(x=>x<1).length,        isCurrent:false },
      { label:'1-3d', value: d.completionDays.filter(x=>x>=1&&x<3).length,  isCurrent:false },
      { label:'3-7d', value: d.completionDays.filter(x=>x>=3&&x<7).length,  isCurrent:false },
      { label:'1-2w', value: d.completionDays.filter(x=>x>=7&&x<14).length, isCurrent:false },
      { label:'2-4w', value: d.completionDays.filter(x=>x>=14&&x<28).length,isCurrent:true  },
      { label:'>4w',  value: d.completionDays.filter(x=>x>=28).length,      isCurrent:false },
    ];
    html += `<h2 class="section-title" style="margin-top:1.5rem;">TURNAROUND DISTRIBUTION (3MO)</h2>`;
    html += `<div class="chart-wrap"><div class="chart-title">Number of PBIs by time-to-complete</div>${buildBarChart(buckets, '--accent3', 'items', 100)}</div>`;
  }

  html += `</div>`; // end main
  html += `</div>`; // end layout
  return html;
}

function buildMemberHistoryTable(d, historyIters, memberSlug) {
  const keys    = historyIters.map(i=>normPath(i.path));
  const lastKey = keys[keys.length-1]||'';
  const effortVals = historyIters.map(i => d.history[normPath(i.path)]?.effort ?? 0);

  let html = `<div class="full-table-wrap"><table class="history-table"><caption class="sr-only">Sprint history</caption><thead><tr>
    <th>Sprint</th>
    <th class="num">Items done</th>
    <th class="num">Effort pts done</th>
    <th class="num spark-cell">Trend</th>
    <th class="num">Hours</th>
    <th class="num">Peer reviews</th>
  </tr></thead><tbody>`;

  [...historyIters].reverse().forEach(iter => {
    const key   = normPath(iter.path);
    const h     = d.history[key];
    const isCur = key === lastKey;
    const eff   = h?.effort??0, hrs=h?.hours??0, prv=h?.peerReviewCount??0, cnt=h?.itemCount??0;
    const sprintItems = isCur ? d.doneItems : (h?.doneItems||[]);
    const drillId = `hist-drill-${memberSlug}-${key.replace(/[^a-z0-9]/g,'-')}`;
    const sparkHtml = isCur
      ? `<td class="num spark-cell">${buildSparkline(effortVals, '--accent')}</td>`
      : `<td class="num spark-cell"></td>`;

    const effortCell = eff > 0
      ? `<button type="button" class="hist-drill-trigger ${isCur?'cur':''}" onclick="toggleDrill('${drillId}',this)" aria-expanded="false" style="cursor:pointer;background:none;border:none;color:inherit;font:inherit;padding:0;text-decoration:underline;text-decoration-style:dotted;text-underline-offset:2px;">${fmtInt(eff)} pts <span style="font-size:0.65rem;" aria-hidden="true">▾</span></button>`
      : '<span style="color:var(--muted2)">—</span>';

    html += `<tr>
      <td class="${isCur?'cur':''}">${esc(iter.name)}</td>
      <td class="num${isCur?' cur-col':''}">${cnt>0?`<span class="${isCur?'cur':''}">${cnt}</span>`:'<span style="color:var(--muted2)">—</span>'}</td>
      <td class="num${isCur?' cur-col':''}">${effortCell}</td>
      ${sparkHtml}
      <td class="num${isCur?' cur-col':''}">${hrs>0?`<span class="${isCur?'cur':''}">${fmt(hrs)} h</span>`:'<span style="color:var(--muted2)">—</span>'}</td>
      <td class="num">${prv>0?prv:'—'}</td>
    </tr>
    <tr class="hist-drill-row" id="${drillId}" style="display:none;">
      <td colspan="6" style="padding:0 0 0 1rem;">
        <div style="padding:0.5rem 0;border-left:2px solid var(--border);">
          ${sprintItems.length > 0
            ? sprintItems.map(i=>`<div class="drill-item">
                <div class="drill-item-meta">
                  <a href="${i.url}" target="_blank" style="font-family:'DM Mono',monospace;font-size:0.73rem;color:var(--accent4);">#${i.id}<span class="sr-only"> (opens in new tab)</span></a>
                  ${projBadge(i.project)}
                  <span class="di-type ${i.type==='Bug'?'di-type-bug':'di-type-pbi'}">${i.type==='Bug'?'Bug':'PBI'}</span>
                  <span class="di-pts">${i.pts} pts</span>
                </div>
                <span class="di-title">${esc(i.title)}</span>
              </div>`).join('')
            : '<div class="drill-empty">No items tracked for this sprint</div>'}
        </div>
      </td>
    </tr>`;
  });

  return html + '</tbody></table></div>';
}

// ── PR COMMENTS ───────────────────────────────────────────────────────────────
async function fetchComments(slug, memberName) {
  const btn = document.getElementById(`btn-sum-${slug}`);
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = '…fetching';

  const d = RENDER_DATA?.md?.[memberName];
  if (!d) { btn.textContent = '↓ Load Comments'; btn.disabled=false; return; }

  const prList3mo = (d._prList||[]).filter(p=>p.closedDate>=new Date(Date.now()-THREE_MONTHS_DAYS*MS_PER_DAY));
  if (!prList3mo.length) {
    const dropEl = document.getElementById(`psb-comments-${slug}`);
    if (dropEl) dropEl.innerHTML = '<div class="drill-empty">No PR reviews found in the last 3 months.</div>';
    const toggle = document.getElementById(`psb-comments-toggle-${slug}`);
    if (toggle) toggle.style.display = 'flex';
    btn.textContent = '↓ Reload'; btn.disabled=false;
    return;
  }

  const allComments = [];
  for (let i=0; i<prList3mo.length; i+=PR_COMMENT_BATCH) {
    const batch = prList3mo.slice(i,i+PR_COMMENT_BATCH);
    const results = await Promise.all(batch.map(p => fetchPRCommentsByMember(p.repoId, p.repoName, p.repoProject, p.prId)));
    for (const byMember of results) {
      if (byMember[memberName]) allComments.push(...byMember[memberName]);
    }
    btn.textContent = `…fetching (${Math.min(i+PR_COMMENT_BATCH,prList3mo.length)}/${prList3mo.length})`;
  }

  const dropEl = document.getElementById(`psb-comments-${slug}`);
  if (dropEl) {
    const listHtml = allComments.length
      ? allComments.map((c,i) =>
          `<div class="psb-comment-item">
            <span class="psb-comment-num">${i+1}</span>
            <span class="psb-comment-text">${esc(c.text)}</span>
            <a class="psb-comment-link" href="${c.prUrl}" target="_blank" aria-label="Open PR (opens in new tab)">↗</a>
          </div>`
        ).join('')
      : '<div class="drill-empty">No comments found in these PRs.</div>';
    dropEl.innerHTML = `<div class="psb-comments-inner">${listHtml}</div>`;
  }

  const toggle = document.getElementById(`psb-comments-toggle-${slug}`);
  if (toggle) {
    toggle.style.display = 'flex';
    const commentsEl = document.getElementById(`psb-comments-${slug}`);
    if (commentsEl) commentsEl.style.display = 'block';
    const span = toggle.querySelector('span');
    if (span) span.textContent = '▼ Hide individual comments';
  }

  btn.textContent = '↓ Reload';
  btn.disabled = false;
}

// ── TAB MANAGEMENT ────────────────────────────────────────────────────────────
let RENDER_DATA = null;

function buildTabs(members) {
  const bar = document.getElementById('tab-bar');
  if (!bar) return;
  bar.setAttribute('role', 'tablist');
  bar.innerHTML = `<button class="tab-btn active" role="tab" aria-selected="true" aria-controls="panel-team" id="tab-team" tabindex="0" onclick="switchTab('team', this)">Team Overview</button>`
    + members.map((m,i) => {
        const color = MEMBER_COLORS[i%MEMBER_COLORS.length];
        return `<button class="tab-btn" role="tab" aria-selected="false" aria-controls="panel-member-${i}" id="tab-member-${i}" tabindex="-1" onclick="switchTab('member-${i}', this)">
          <span class="member-dot" style="background:${color}"></span>${esc(m)}
        </button>`;
      }).join('');
  // Arrow key navigation between tabs
  bar.addEventListener('keydown', function(e) {
    const tabs = [...bar.querySelectorAll('[role="tab"]')];
    const idx = tabs.indexOf(document.activeElement);
    if (idx < 0) return;
    let newIdx;
    if (e.key === 'ArrowRight') newIdx = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') newIdx = (idx - 1 + tabs.length) % tabs.length;
    else return;
    e.preventDefault();
    tabs[newIdx].focus();
    tabs[newIdx].click();
  });
}

function switchTab(id, btn) {
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
    b.setAttribute('tabindex', '-1');
  });
  document.querySelectorAll('.tab-panel').forEach(p=>p.classList.remove('active'));
  if (btn) {
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    btn.setAttribute('tabindex', '0');
  }
  const panel = document.getElementById('panel-'+id);
  if (panel) panel.classList.add('active');
}

function switchToMember(idx) {
  const btn = document.querySelector(`.tab-btn:nth-child(${idx+2})`);
  switchTab(`member-${idx}`, btn);
  window.scrollTo({top:0,behavior:'smooth'});
}

// ── RENDER ────────────────────────────────────────────────────────────────────
function render({ md, currentIter, sprintStart, sprintEnd, historyIters, iters3moNorm, iters6moNorm }) {
  RENDER_DATA = { md, currentIter, historyIters, iters3moNorm, iters6moNorm };

  const sStart = sprintStart.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  const sEnd   = sprintEnd.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  document.getElementById('sprint-label').innerHTML =
    CFG.sprintMode === 'dates'
      ? `Sprint window: <span>${sStart} – ${sEnd}</span>`
      : `Current Sprint: <span>${currentIter.name}</span> &nbsp;·&nbsp; <span>${sStart} – ${sEnd}</span>`;

  buildTabs(CFG.members);

  const panelsEl = document.getElementById('tab-panels');

  const teamPanel = document.createElement('div');
  teamPanel.className = 'tab-panel active';
  teamPanel.id = 'panel-team';
  teamPanel.setAttribute('role', 'tabpanel');
  teamPanel.setAttribute('aria-labelledby', 'tab-team');
  teamPanel.innerHTML = `<div class="panel-content">${renderTeamTab(md, currentIter, historyIters, iters3moNorm, iters6moNorm)}</div>`;
  panelsEl.appendChild(teamPanel);

  CFG.members.forEach((m, idx) => {
    const panel = document.createElement('div');
    panel.className = 'tab-panel';
    panel.id = `panel-member-${idx}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `tab-member-${idx}`);
    panel.innerHTML = `<div class="panel-content">${renderMemberTab(m, md, currentIter, historyIters, iters3moNorm, iters6moNorm)}</div>`;
    panelsEl.appendChild(panel);
  });

  // Populate drill-down panels
  CFG.members.forEach(m => {
    const d    = md[m];
    const slug = m.replace(/\s+/g,'-').replace(/[^a-zA-Z0-9-]/g,'');
    fill(`drill-done-${slug}`,  d.doneItems.map(i=>diRow(i,i.type==='Bug'?'Bug':'PBI',i.type==='Bug'?'di-type-bug':'di-type-pbi',`<span class="di-pts">${i.pts} pts</span>`)));
    fill(`drill-assigned-${slug}`, (d.allSprintPBIs||[]).map(i=>
      diRow(i, i.type==='Bug'?'Bug':'PBI', i.type==='Bug'?'di-type-bug':'di-type-pbi',
        `<span class="di-pts">${i.pts||0} pts</span><span style="font-size:0.7rem;color:var(--muted);margin-left:0.2rem;">${esc(i.state||'')}</span>`)));
    fill(`drill-pbis-${slug}`,  d.changedPBIs.map(i=>diRow(i,'PBI','di-type-pbi',`<span style="color:var(--muted);font-size:0.73rem;">${esc(i.state)}</span>`+(i.pts?`<span class="di-pts">${i.pts} pts</span>`:''))))
    fill(`drill-bugs-${slug}`,  d.changedBugs.map(i=>diRow(i,'Bug','di-type-bug',`<span style="color:var(--muted);font-size:0.73rem;">${esc(i.state)}</span>`)));
    fill(`drill-feats-${slug}`, d.changedFeatures.map(i=>
      `<div class="drill-item"><div class="drill-item-meta"><a href="${i.url}" target="_blank">#${i.id}<span class="sr-only"> (opens in new tab)</span></a>${projBadge(i.project)}</div><span class="di-title">${esc(i.title)}</span></div>`));
    fill(`drill-hours-${slug}`, d.sprintTasks.map(i=>diRow(i,'Task','di-type-task',`<span class="di-hrs">${fmt(i.hours)} h</span>`)));

    // Design Review drill panels (only rendered when DR enabled)
    if (CFG.designReviewEnabled) {
      const drItemRow = i =>
        `<div class="drill-item">
          <div class="drill-item-meta">
            <a href="${i.url}" target="_blank">#${i.id}<span class="sr-only"> (opens in new tab)</span></a>
            ${projBadge(i.project)}
            <span class="di-type di-type-pbi" style="${i.addCount>1?'background:rgba(196,82,82,0.15);color:var(--accent2);':''}">DR ×${i.addCount}</span>
          </div>
          <span class="di-title">${esc(i.title)}</span>
        </div>`;

      fill(`drill-dr-all-${slug}`,
        d.designReviewItems.length
          ? [...d.designReviewItems].sort((a,b)=>b.addCount-a.addCount).map(drItemRow)
          : []);

      fill(`drill-dr-flagged-${slug}`,
        d.designReviewFlagged.length
          ? [...d.designReviewFlagged].sort((a,b)=>b.addCount-a.addCount).map(drItemRow)
          : []);
    }
  });

  document.getElementById('loading-screen').style.display = 'none';
  // Move focus to the active tab for screen reader users
  const activeTab = document.querySelector('.tab-btn.active');
  if (activeTab) activeTab.focus();
}

// ── FLOW CONTROL ──────────────────────────────────────────────────────────────
function startDashboard() {
  const org            = document.getElementById('org-url').value.trim().replace(/\/+$/,'');
  const project        = document.getElementById('project').value.trim();
  const pat            = document.getElementById('pat').value.trim();
  const members        = document.getElementById('members').value.trim().split('\n').map(s=>s.trim()).filter(Boolean);
  const relatedProjects= document.getElementById('related-projects').value.trim().split('\n').map(s=>s.trim()).filter(Boolean);
  const sprintMode     = document.querySelector('input[name="sprint-mode"]:checked')?.value || 'iterations';
  const errEl          = document.getElementById('config-error');
  errEl.style.display  = 'none';
  // Clear previous aria-invalid states
  ['org-url','project','pat','members','team','sprint-start-date'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.removeAttribute('aria-invalid');
  });

  if (!org||!project||!pat||!members.length) {
    errEl.textContent='Organization URL, Project, PAT, and at least one team member are required.';
    errEl.style.display='block';
    if (!org) document.getElementById('org-url')?.setAttribute('aria-invalid','true');
    if (!project) document.getElementById('project')?.setAttribute('aria-invalid','true');
    if (!pat) document.getElementById('pat')?.setAttribute('aria-invalid','true');
    if (!members.length) document.getElementById('members')?.setAttribute('aria-invalid','true');
    return;
  }

  let team = '', sprintStartDate = null, iterationCount = 12, sprintCount = 12;

  if (sprintMode === 'iterations') {
    team = document.getElementById('team').value.trim();
    iterationCount = parseInt(document.getElementById('iteration-count').value, 10) || 12;
    if (!team) { errEl.textContent='Team Name is required in Iteration mode.'; errEl.style.display='block'; document.getElementById('team')?.setAttribute('aria-invalid','true'); return; }
  } else {
    const rawDate = document.getElementById('sprint-start-date').value;
    if (!rawDate) { errEl.textContent='Sprint Start Date is required in Date-Based mode.'; errEl.style.display='block'; document.getElementById('sprint-start-date')?.setAttribute('aria-invalid','true'); return; }
    sprintStartDate = new Date(rawDate + 'T00:00:00'); // local midnight
    sprintCount = parseInt(document.getElementById('sprint-count').value, 10) || 12;
  }

  // Toggle switch uses aria-checked (button role=switch) instead of .checked
  const drToggle = document.getElementById('design-review-enabled');
  const designReviewEnabled = drToggle?.getAttribute('aria-checked') === 'true';
  CFG = Object.freeze({ org, project, team, pat, members, relatedProjects, sprintMode, sprintStartDate, iterationCount, sprintCount, designReviewEnabled });

  document.getElementById('config-screen').style.display    = 'none';
  document.getElementById('dashboard-screen').style.display = 'block';
  document.getElementById('loading-screen').style.display   = 'flex';
  document.getElementById('error-area').innerHTML            = '';

  buildDashboard()
    .then(data=>render(data))
    .catch(err=>{
      document.getElementById('loading-screen').style.display='none';
      document.getElementById('error-area').innerHTML=`<div class="error-banner"><strong>Something went wrong</strong>\n${err.message}</div>`;
    });
}

function resetToConfig() {
  RENDER_DATA = null;
  document.getElementById('dashboard-screen').style.display = 'none';
  document.getElementById('config-screen').style.display    = 'flex';
  document.getElementById('tab-panels').innerHTML            = '';
  document.getElementById('tab-bar').innerHTML               = '';
  document.getElementById('error-area').innerHTML            = '';
  // Return focus to the config form
  const firstInput = document.getElementById('org-url');
  if (firstInput) firstInput.focus();
}
