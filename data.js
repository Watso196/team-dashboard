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
      completionDays: [], completionDaysRange: [],
      prsReviewed3mo: 0, prsReviewed6mo: 0, prsReviewedRange: 0,
      prsAuthoredThisSprint: 0, prsAuthored3mo: 0, prsAuthored6mo: 0, prsAuthoredRange: 0,
      prComments: [],
      pbisCreated3mo: 0, bugsCreated3mo: 0,
      pbisCreatedRange: 0, bugsCreatedRange: 0,
      peerReviewTasksThisSprint: 0,
      peerReviewTaskCount3mo: 0, peerReviewTaskCount6mo: 0, peerReviewTaskCountRange: 0,
      peerReviewHours3mo: 0, peerReviewHoursPerTask3mo: null,
      peerReviewHoursRange: 0, peerReviewHoursPerTaskRange: null,
      designReviewItems: [],
      designReviewFlagged: [],
    };
  }
  return md;
}

async function resolveIterations(now, threeMonthsAgo, sixMonthsAgo) {
  let currentIter, sprintStart, sprintEnd, allIters, historyIters;

  if (CFG.sprintMode === 'dates') {
    const count = CFG.sprintCount || 12;
    allIters = buildDateBasedSprints(CFG.sprintStartDate, count);
    currentIter = allIters[allIters.length - 1];
    sprintStart = new Date(currentIter.attributes.startDate);
    sprintEnd   = new Date(currentIter.attributes.finishDate);
    historyIters = allIters;
  } else {
    currentIter = await fetchCurrentIteration();
    sprintStart = new Date(currentIter.attributes.startDate);
    sprintEnd   = currentIter.attributes.finishDate ? new Date(currentIter.attributes.finishDate) : addDays(sprintStart,SPRINT_DAYS);
    allIters = await fetchAllIterations();
    // Take the N most recent iterations that have already started. Previously
    // this was also clamped to the last 12 months, which silently capped large
    // requests (e.g. 20 iterations) at whatever fit inside a year.
    const started = allIters
      .filter(i => new Date(i.attributes.startDate) <= now)
      .sort((a,b)=>new Date(a.attributes.startDate)-new Date(b.attributes.startDate));
    const maxHistory = CFG.iterationCount || DEFAULT_HISTORY;
    historyIters = started.slice(-maxHistory);
  }

  // 3mo/6mo presets are subsets of whatever ended up in the history window.
  const inWindow = cutoff => new Set(
    historyIters.filter(i => new Date(i.attributes.startDate) >= cutoff).map(i => normPath(i.path))
  );
  const iters3moNorm = inWindow(threeMonthsAgo);
  const iters6moNorm = inWindow(sixMonthsAgo);
  const range = describeRange(historyIters);

  console.group('[TeamPulse] Iterations');
  console.log('Mode:', CFG.sprintMode);
  console.log('Current:', currentIter.name, normPath(currentIter.path));
  console.log('History window:', historyIters.length, 'sprints —', range.label);
  console.log('Requested:', CFG.sprintMode === 'dates' ? (CFG.sprintCount||12) : (CFG.iterationCount||DEFAULT_HISTORY));
  historyIters.forEach(i=>console.log(' ',i.name, normPath(i.path)));
  console.groupEnd();

  return { currentIter, sprintStart, sprintEnd, historyIters, iters3moNorm, iters6moNorm, range };
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
  const { md, threeMonthsAgo, fetchStart, inRange } = ctx;
  setStep('Querying created items…');
  const createdIds = await orgWiqlQuery(
    `SELECT [System.Id] FROM WorkItems WHERE ${assigneeClause('System.CreatedBy')} AND [System.WorkItemType] IN ('Product Backlog Item','Bug') AND [System.CreatedDate] >= '${isoDate(fetchStart)}'`
  );
  const createdItems = await fetchWIBatch(createdIds, PBI_FIELDS);
  for (const wi of createdItems) {
    const m = matchMember(wi.fields['System.CreatedBy']); if (!m) continue;
    const created = new Date(wi.fields['System.CreatedDate']);
    const is3mo   = created >= threeMonthsAgo;
    const isRange = inRange(created);
    const type    = wi.fields['System.WorkItemType'];
    if (type === 'Product Backlog Item') {
      if (is3mo)   md[m].pbisCreated3mo++;
      if (isRange) md[m].pbisCreatedRange++;
    } else if (type === 'Bug') {
      if (is3mo)   md[m].bugsCreated3mo++;
      if (isRange) md[m].bugsCreatedRange++;
    }
  }
}

async function fetchPeerReviewTasks(ctx) {
  const { md, now, threeMonthsAgo, sixMonthsAgo, fetchStart, inRange } = ctx;
  setStep('Querying peer review tasks…');
  const prTaskIds = await orgWiqlQuery(
    `SELECT [System.Id] FROM WorkItems WHERE ${assigneeClause()} AND [System.WorkItemType]='Task' AND [System.Title] CONTAINS 'peer review' AND [System.State]='Done' AND [System.ChangedDate] >= '${isoDate(fetchStart)}'`
  );
  const prTasks = await fetchWIBatch(prTaskIds, TASK_FIELDS);
  for (const t of prTasks) {
    const m = matchMember(t.fields['System.AssignedTo']); if (!m) continue;
    const changed  = new Date(t.fields['System.ChangedDate']||t.fields['System.CreatedDate']||now);
    const hours    = t.fields['Microsoft.VSTS.Scheduling.CompletedWork']||0;
    if (changed >= threeMonthsAgo) {
      md[m].peerReviewTaskCount3mo++;
      md[m].peerReviewHours3mo += hours;
    }
    if (changed >= sixMonthsAgo) md[m].peerReviewTaskCount6mo++;
    if (inRange(changed)) {
      md[m].peerReviewTaskCountRange++;
      md[m].peerReviewHoursRange += hours;
    }
  }
  for (const m of CFG.members) {
    md[m].peerReviewHoursPerTask3mo = md[m].peerReviewTaskCount3mo > 0
      ? md[m].peerReviewHours3mo / md[m].peerReviewTaskCount3mo : null;
    md[m].peerReviewHoursPerTaskRange = md[m].peerReviewTaskCountRange > 0
      ? md[m].peerReviewHoursRange / md[m].peerReviewTaskCountRange : null;
  }
}

async function fetchPRData(ctx) {
  const { md, sprintStart, sprintEnd, threeMonthsAgo, sixMonthsAgo, fetchStart, inRange, range } = ctx;
  setStep(`Fetching PR data (${range.short})…`);
  const repos = await fetchAllRepos();
  console.log(`[TeamPulse] Found ${repos.length} repos`);

  const reviewerPRMap  = {};
  const reviewerPRList = {};
  for (const m of CFG.members) { reviewerPRMap[m] = new Set(); reviewerPRList[m] = []; }

  for (const repo of repos) {
    try {
      let skip=0;
      while (true) {
        const url = `${CFG.org}/_apis/git/repositories/${repo.id}/pullrequests?searchCriteria.status=completed&searchCriteria.minTime=${fetchStart.toISOString()}&$top=100&$skip=${skip}&api-version=7.0`;
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
            if (closedDate >= sprintStart && closedDate <= addDays(sprintEnd, 1)) md[author].prsAuthoredThisSprint++;
            if (closedDate >= threeMonthsAgo) md[author].prsAuthored3mo++;
            if (closedDate >= sixMonthsAgo)   md[author].prsAuthored6mo++;
            if (inRange(closedDate))          md[author].prsAuthoredRange++;
          }
        }
        if (prs.length < 100) break;
        skip += 100;
      }
    } catch(e) { console.warn(`[TeamPulse] PR fetch failed for repo ${repo.name}:`, e.message); }
  }

  for (const m of CFG.members) {
    const allPRs = reviewerPRList[m];
    md[m].prsReviewed6mo   = allPRs.filter(p=>p.closedDate>=sixMonthsAgo).length;
    md[m].prsReviewed3mo   = allPRs.filter(p=>p.closedDate>=threeMonthsAgo).length;
    md[m].prsReviewedRange = allPRs.filter(p=>inRange(p.closedDate)).length;
    md[m]._prList = allPRs;
    console.log(`[TeamPulse] ${m}: reviewed 6mo=${md[m].prsReviewed6mo}, 3mo=${md[m].prsReviewed3mo}, range=${md[m].prsReviewedRange} | authored 6mo=${md[m].prsAuthored6mo}, 3mo=${md[m].prsAuthored3mo}, range=${md[m].prsAuthoredRange}, sprint=${md[m].prsAuthoredThisSprint}`);
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
  const { md, threeMonthsAgo, fetchStart, inRange, range } = ctx;
  setStep('Calculating completion times…');
  const recentDoneIds = await orgWiqlQuery(
    `SELECT [System.Id] FROM WorkItems WHERE ${assigneeClause()} AND [System.WorkItemType] IN ('Product Backlog Item','Bug') AND [System.State]='Done' AND [System.ChangedDate] >= '${isoDate(fetchStart)}' ORDER BY [System.ChangedDate] DESC`
  );
  // Done-date per item, reused by the Design Review scan so it can split its
  // counts into the 3mo preset vs the selected sprint range.
  const doneDateById = {};
  for (let i=0; i<recentDoneIds.length; i+=COMPLETION_CONCURRENCY) {
    setStep(`Completion times, ${range.short}… (${Math.min(i+COMPLETION_CONCURRENCY,recentDoneIds.length)}/${recentDoneIds.length})`);
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
        if (doneDate) doneDateById[id] = doneDate;
        if (assignee&&activeDate&&doneDate) {
          const days=(doneDate-activeDate)/MS_PER_DAY;
          if (days>=0&&days<365) {
            if (doneDate >= threeMonthsAgo) md[assignee].completionDays.push(days);
            if (inRange(doneDate))          md[assignee].completionDaysRange.push(days);
          }
        }
      } catch(e) { console.warn(`[TeamPulse] Completion time calc failed for WI ${id}:`, e.message); }
    }));
  }
  return { recentDoneIds, doneDateById };
}

async function analyzeDesignReviews(ctx, recentDoneIds, doneDateById) {
  const { md, threeMonthsAgo } = ctx;
  setStep('Analysing Design Review tag cycling…');

  const currentSprintPBIIds = CFG.members.flatMap(m => md[m].allSprintPBIs.map(i => i.id));
  const currentSprintIdSet  = new Set(currentSprintPBIIds);
  const allDRCandidateIds   = [...new Set([...recentDoneIds, ...currentSprintPBIIds])];

  // Items in the current sprint are inside both windows; everything else is
  // placed by its Done date. Unknown dates fall back to the 3mo bucket so the
  // preset never under-reports relative to its previous behaviour.
  const isIn3mo = id => currentSprintIdSet.has(id) || !doneDateById?.[id] || doneDateById[id] >= threeMonthsAgo;

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
    const item = { id, addCount, title: meta.title, url: meta.url, project: meta.project, in3mo: isIn3mo(id) };
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

  setStep('Fetching iterations…');
  const { currentIter, sprintStart, sprintEnd, historyIters, iters3moNorm, iters6moNorm, range } =
    await resolveIterations(now, threeMonthsAgo, sixMonthsAgo);

  // Every windowed query pulls from the earlier of (selected range, 6 months)
  // so the 3mo/6mo presets stay correct for short ranges while long ranges get
  // the full span of data they asked for.
  const rangeStart = range.start || sprintStart;
  const rangeEnd   = addDays(range.end || sprintEnd, 1);
  const fetchStart = earliest(rangeStart, sixMonthsAgo);
  const inRange    = d => d >= rangeStart && d <= rangeEnd;

  const sprintPath  = currentIter.path;
  const currentNorm = normPath(sprintPath);
  const md = initMemberBuckets();
  const ctx = { md, now, threeMonthsAgo, sixMonthsAgo, sprintStart, sprintEnd, sprintPath, currentNorm,
                historyIters, iters3moNorm, iters6moNorm, range, rangeStart, rangeEnd, fetchStart, inRange };

  await fetchChangedPBIsAndBugs(ctx);
  await fetchChangedFeatures(ctx);
  await fetchDoneItems(ctx);
  await fetchAllSprintPBIs(ctx);
  await fetchSprintTasks(ctx);
  await fetchCreatedItems(ctx);
  await fetchPeerReviewTasks(ctx);
  if (CFG.relatedProjects?.length) await fetchPRData(ctx);
  await fetchHistoricalData(ctx);
  const { recentDoneIds, doneDateById } = await calculateCompletionTimes(ctx);
  if (CFG.designReviewEnabled) await analyzeDesignReviews(ctx, recentDoneIds, doneDateById);

  setStep('Rendering…');
  return { md, currentIter, sprintStart, sprintEnd, historyIters, iters3moNorm, iters6moNorm, range };
}
