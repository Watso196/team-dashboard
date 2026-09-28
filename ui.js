// ── CONFIG SCREEN UI HELPERS ───────────────────────────────────────────────────
function onSprintModeChange() {
  const mode = document.querySelector('input[name="sprint-mode"]:checked')?.value;
  document.getElementById('iter-fields').style.display = mode === 'iterations' ? '' : 'none';
  document.getElementById('date-fields').style.display = mode === 'dates'      ? '' : 'none';
}

// ── ENV PRE-FILL ──────────────────────────────────────────────────────────────
;(function prefillFromEnv() {
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
function renderTeamTab(md, currentIter, historyIters, iters3moNorm, iters6moNorm, range) {
  const members = CFG.members;
  const rng = range || describeRange(historyIters);

  const sum = key => members.reduce((s,m)=>s+(md[m][key]||0), 0);

  const teamEffortDone    = members.reduce((s,m)=>s+md[m].effortDone, 0);
  const teamItemsDone     = members.reduce((s,m)=>s+md[m].itemsDoneThisSprint, 0);
  const teamHours         = members.reduce((s,m)=>s+md[m].hoursThisSprint, 0);
  const teamPBIs          = members.reduce((s,m)=>s+md[m].pbisChanged.size, 0);
  const teamBugs          = members.reduce((s,m)=>s+md[m].bugsChanged.size, 0);
  const teamPRReviews3mo  = sum('prsReviewed3mo');
  const teamPRsAuthored3mo= sum('prsAuthored3mo');
  const teamPRReviewsRange  = sum('prsReviewedRange');
  const teamPRsAuthoredRange= sum('prsAuthoredRange');
  const teamPeerReviewRange = sum('peerReviewTaskCountRange');
  const teamPBIsCreatedRange= sum('pbisCreatedRange');
  const teamBugsCreatedRange= sum('bugsCreatedRange');
  const allCompletionDays = members.flatMap(m=>md[m].completionDays);
  const teamAvgTurnaround = avg(allCompletionDays);
  const teamAvgTurnaroundRange = avg(members.flatMap(m=>md[m].completionDaysRange||[]));

  const keys    = historyIters.map(i=>normPath(i.path));
  const lastKey = keys[keys.length-1]||'';
  const keys6mo = keys.filter(k=>iters6moNorm.has(k)||k===lastKey);
  const keys3mo = keys.filter(k=>iters3moNorm.has(k)||k===lastKey);
  const keysRange = keys; // every sprint the user asked for

  const teamEffortPerSprint = (ks) => avg(ks.map(k => members.reduce((s,m)=>s+(md[m].history[k]?.effort??0),0)));
  const teamItemsPerSprint  = (ks) => avg(ks.map(k => members.reduce((s,m)=>s+(md[m].history[k]?.itemCount??0),0)));
  const teamHoursPerSprint  = (ks) => avg(ks.map(k => members.reduce((s,m)=>s+(md[m].history[k]?.hours??0),0)));
  const vel3mo   = teamEffortPerSprint(keys3mo);
  const vel6mo   = teamEffortPerSprint(keys6mo);
  const items3mo = teamItemsPerSprint(keys3mo);
  const items6mo = teamItemsPerSprint(keys6mo);
  const velRange   = teamEffortPerSprint(keysRange);
  const itemsRange = teamItemsPerSprint(keysRange);
  const hoursRange = teamHoursPerSprint(keysRange);
  const totalEffortRange = keysRange.reduce((s,k)=>s+members.reduce((t,m)=>t+(md[m].history[k]?.effort??0),0), 0);
  const totalItemsRange  = keysRange.reduce((s,k)=>s+members.reduce((t,m)=>t+(md[m].history[k]?.itemCount??0),0), 0);
  const totalHoursRange  = keysRange.reduce((s,k)=>s+members.reduce((t,m)=>t+(md[m].history[k]?.hours??0),0), 0);
  let html = '';

  // Design review team stats. designReviewItems now spans the selected range,
  // so the 3mo preset reads off the per-item in3mo flag.
  const drEnabled = CFG.designReviewEnabled;
  const allDRItems     = drEnabled ? members.flatMap(m => md[m].designReviewItems) : [];
  const allDRItems3mo  = allDRItems.filter(i => i.in3mo !== false);
  const allDRFlagged   = drEnabled ? members.flatMap(m => md[m].designReviewFlagged) : [];
  const teamDRAvg      = allDRItems3mo.length ? avg(allDRItems3mo.map(i => i.addCount)) : null;
  const teamDRAvgRange = allDRItems.length    ? avg(allDRItems.map(i => i.addCount))    : null;
  const teamDRFlagged      = allDRFlagged.filter(i => i.in3mo !== false).length;
  const teamDRFlaggedRange = allDRFlagged.length;

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

  // ── Selected sprint range ────────────────────────────────────────────────
  // Same metrics, but over exactly the sprints the user asked to load rather
  // than a fixed 3/6 month preset.
  html += `<h2 class="section-title" style="margin-top:2rem;">SELECTED RANGE — ${esc(rng.label)}</h2>`;
  html += `<div class="stat-grid">
    <div class="stat-cell"><div class="stat-label">Total effort pts</div><div class="stat-value accent">${fmtInt(totalEffortRange)}</div><div class="stat-sub">${rng.short}</div></div>
    <div class="stat-cell"><div class="stat-label">Total items done</div><div class="stat-value accent4">${totalItemsRange}</div><div class="stat-sub">PBIs + Bugs closed</div></div>
    <div class="stat-cell"><div class="stat-label">Total hours logged</div><div class="stat-value">${fmt(totalHoursRange)}</div><div class="stat-sub">${rng.short}</div></div>
    <div class="stat-cell"><div class="stat-label">Avg pts / sprint</div><div class="stat-value">${velRange!==null?fmt(velRange,1)+' pts':'—'}</div><div class="stat-sub">${rng.short}</div></div>
    <div class="stat-cell"><div class="stat-label">Avg items / sprint</div><div class="stat-value accent4">${itemsRange!==null?fmt(itemsRange,1):'—'}</div><div class="stat-sub">${rng.short}</div></div>
    <div class="stat-cell"><div class="stat-label">Avg hrs / sprint</div><div class="stat-value">${hoursRange!==null?fmt(hoursRange,1)+' h':'—'}</div><div class="stat-sub">${rng.short}</div></div>
    <div class="stat-cell"><div class="stat-label">Avg turnaround</div><div class="stat-value accent3">${teamAvgTurnaroundRange!==null?fmt(teamAvgTurnaroundRange,1)+' days':'—'}</div><div class="stat-sub">PBI start→done</div></div>
    ${CFG.relatedProjects?.length ? `<div class="stat-cell"><div class="stat-label">PRs reviewed</div><div class="stat-value">${teamPRReviewsRange}</div><div class="stat-sub">${rng.short}</div></div>` : ''}
    ${CFG.relatedProjects?.length ? `<div class="stat-cell"><div class="stat-label">PRs authored</div><div class="stat-value accent4">${teamPRsAuthoredRange}</div><div class="stat-sub">${rng.short}</div></div>` : ''}
    <div class="stat-cell"><div class="stat-label">Peer review tasks</div><div class="stat-value accent3">${teamPeerReviewRange}</div><div class="stat-sub">${rng.short}</div></div>
    <div class="stat-cell"><div class="stat-label">PBIs created</div><div class="stat-value">${teamPBIsCreatedRange}</div><div class="stat-sub">${rng.short}</div></div>
    <div class="stat-cell"><div class="stat-label">Bugs created</div><div class="stat-value accent2">${teamBugsCreatedRange}</div><div class="stat-sub">${rng.short}</div></div>
    ${drEnabled ? `<div class="stat-cell"><div class="stat-label">Avg Design Reviews / Item</div><div class="stat-value ${teamDRAvgRange!==null&&teamDRAvgRange>1?'accent2':''}">${teamDRAvgRange!==null?fmt(teamDRAvgRange,1):'—'}</div><div class="stat-sub">target: 1.0</div></div>` : ''}
    ${drEnabled ? `<div class="stat-cell"><div class="stat-label">Items w/ Repeated Design Reviews</div><div class="stat-value ${teamDRFlaggedRange>0?'accent2':''}">${teamDRFlaggedRange}</div><div class="stat-sub">across team</div></div>` : ''}
  </div>`;

  // DR flagged items — own section with an explicit show/hide button
  if (drEnabled) {
    const allFlagged = members
      .flatMap(m => md[m].designReviewFlagged.map(i => ({ ...i, member: m })))
      .sort((a,b) => b.addCount - a.addCount);

    html += `<h2 class="section-title" style="margin-top:2rem;display:flex;align-items:center;justify-content:space-between;">
      <span>ITEMS WITH REPEATED DESIGN REVIEWS <span class="section-note">${esc(rng.label)}</span></span>
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
      html += `<div style="background:var(--surface);border:1px solid var(--border);padding:0.85rem 1rem;font-family:'DM Mono',monospace;font-size:0.78rem;color:var(--muted);">No items required more than one Design Review across ${esc(rng.label)}.</div>`;
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
function renderMemberTab(m, md, currentIter, historyIters, iters3moNorm, iters6moNorm, range) {
  const d    = md[m];
  const rng  = range || describeRange(historyIters);
  const slug = m.replace(/\s+/g,'-').replace(/[^a-zA-Z0-9-]/g,'');
  const keys = historyIters.map(i=>normPath(i.path));
  const lastKey = keys[keys.length-1]||'';
  const keys3mo = keys.filter(k=>iters3moNorm.has(k)||k===lastKey);
  const keys6mo = keys.filter(k=>iters6moNorm.has(k)||k===lastKey);
  const keysRange = keys; // every sprint the user asked for

  const hist  = (ks, field) => ks.map(k => d.history[k]?.[field] ?? 0);
  const total = (ks, field) => hist(ks, field).reduce((a,b)=>a+b, 0);

  const vel3mo  = avg(hist(keys3mo,'effort'));
  const vel6mo  = avg(hist(keys6mo,'effort'));
  const velRange = avg(hist(keysRange,'effort'));
  const items3moAvg = avg(hist(keys3mo,'itemCount'));
  const items6moAvg = avg(hist(keys6mo,'itemCount'));
  const itemsRangeAvg = avg(hist(keysRange,'itemCount'));
  const hrs3mo  = avg(hist(keys3mo,'hours'));
  const hrs6mo  = avg(hist(keys6mo,'hours'));
  const hrsRange = avg(hist(keysRange,'hours'));
  const pr3mo   = avg(hist(keys3mo,'peerReviewCount'));
  const pr6mo   = avg(hist(keys6mo,'peerReviewCount'));
  const prRange = avg(hist(keysRange,'peerReviewCount'));
  const totalEffortRange = total(keysRange,'effort');
  const totalItemsRange  = total(keysRange,'itemCount');
  const totalHoursRange  = total(keysRange,'hours');
  const avgComp = avg(d.completionDays);
  const avgCompRange = avg(d.completionDaysRange||[]);
  const totalItems = d.pbisChanged.size + d.bugsChanged.size;
  const hoursPerItem = totalItems > 0 ? d.hoursThisSprint / totalItems : null;

  const drItems      = d.designReviewItems || [];
  const drItems3mo   = drItems.filter(i => i.in3mo !== false);
  const drFlagged    = d.designReviewFlagged || [];
  const drFlagged3mo = drFlagged.filter(i => i.in3mo !== false);
  const drAvg3mo     = drItems3mo.length ? avg(drItems3mo.map(i=>i.addCount)) : null;
  const drAvgRange   = drItems.length    ? avg(drItems.map(i=>i.addCount))    : null;

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

  html += `<h2 class="section-title" style="margin-top:2rem;">AVERAGES OVER TIME <span class="section-note">selected range: ${esc(rng.label)}</span></h2>`;
  html += `<div style="background:var(--surface);border:1px solid var(--muted2);padding:1.25rem;border-radius:12px;">
    <table class="metrics-table"><caption class="sr-only">Historical averages for ${esc(m)}</caption>
      <tr class="metric-section-row"><td colspan="2">VELOCITY (effort pts)</td></tr>
      <tr class="data-row"><td class="metric-label">Avg / sprint (3mo)</td><td class="metric-value accent">${vel3mo!==null?fmt(vel3mo,1)+' pts':'—'}</td></tr>
      <tr class="data-row"><td class="metric-label">Avg / sprint (6mo)</td><td class="metric-value">${vel6mo!==null?fmt(vel6mo,1)+' pts':'—'}</td></tr>
      <tr class="data-row range-row"><td class="metric-label">Avg / sprint (${esc(rng.short)})</td><td class="metric-value accent4">${velRange!==null?fmt(velRange,1)+' pts':'—'}</td></tr>
      <tr class="data-row range-row"><td class="metric-label">Total (${esc(rng.short)})</td><td class="metric-value accent4">${fmtInt(totalEffortRange)} pts</td></tr>

      <tr class="metric-section-row"><td colspan="2">ITEMS DONE (PBIs + Bugs)</td></tr>
      <tr class="data-row"><td class="metric-label">Avg items / sprint (3mo)</td><td class="metric-value accent">${items3moAvg!==null?fmt(items3moAvg,1):'—'}</td></tr>
      <tr class="data-row"><td class="metric-label">Avg items / sprint (6mo)</td><td class="metric-value">${items6moAvg!==null?fmt(items6moAvg,1):'—'}</td></tr>
      <tr class="data-row range-row"><td class="metric-label">Avg items / sprint (${esc(rng.short)})</td><td class="metric-value accent4">${itemsRangeAvg!==null?fmt(itemsRangeAvg,1):'—'}</td></tr>
      <tr class="data-row range-row"><td class="metric-label">Total items (${esc(rng.short)})</td><td class="metric-value accent4">${totalItemsRange}</td></tr>

      <tr class="metric-section-row"><td colspan="2">HOURS</td></tr>
      <tr class="data-row"><td class="metric-label">Avg hrs / sprint (3mo)</td><td class="metric-value">${hrs3mo!==null?fmt(hrs3mo)+' h':'—'}</td></tr>
      <tr class="data-row"><td class="metric-label">Avg hrs / sprint (6mo)</td><td class="metric-value">${hrs6mo!==null?fmt(hrs6mo)+' h':'—'}</td></tr>
      <tr class="data-row range-row"><td class="metric-label">Avg hrs / sprint (${esc(rng.short)})</td><td class="metric-value accent4">${hrsRange!==null?fmt(hrsRange)+' h':'—'}</td></tr>
      <tr class="data-row range-row"><td class="metric-label">Total hrs (${esc(rng.short)})</td><td class="metric-value accent4">${fmt(totalHoursRange)} h</td></tr>

      <tr class="metric-section-row"><td colspan="2">COMPLETION TIME</td></tr>
      <tr class="data-row"><td class="metric-label">Avg start → done (3mo)</td><td class="metric-value accent3">${avgComp!==null?fmt(avgComp,1)+' days':'—'}</td></tr>
      <tr class="data-row range-row"><td class="metric-label">Avg start → done (${esc(rng.short)})</td><td class="metric-value accent3">${avgCompRange!==null?fmt(avgCompRange,1)+' days':'—'}</td></tr>

      ${CFG.designReviewEnabled ? `
      <tr class="metric-section-row"><td colspan="2">DESIGN REVIEW CYCLING</td></tr>
      <tr class="data-row">
        <td class="metric-label">Avg Design Reviews / Item (3mo)</td>
        <td class="metric-value ${drAvg3mo!==null&&drAvg3mo>1?'accent2':'accent'}">
          ${drAvg3mo!==null ? fmt(drAvg3mo,1) : '—'}
        </td>
      </tr>
      <tr class="data-row range-row">
        <td class="metric-label">Avg Design Reviews / Item (${esc(rng.short)})</td>
        <td class="metric-value ${drAvgRange!==null&&drAvgRange>1?'accent2':'accent4'}">
          ${drAvgRange!==null ? fmt(drAvgRange,1) : '—'}
        </td>
      </tr>
      <tr class="data-row drillable" tabindex="0" role="button" aria-expanded="false" onclick="toggleDrill('drill-dr-all-${slug}',this)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleDrill('drill-dr-all-${slug}',this)}">
        <td class="metric-label">Items that entered Design Review <span class="drill-icon">▾</span></td>
        <td class="metric-value">${drItems3mo.length||'0'} <span class="range-inline">· ${drItems.length} in ${esc(rng.short)}</span></td>
      </tr>
      <tr><td colspan="2" style="padding:0;"><div class="drill-panel" id="drill-dr-all-${slug}"></div></td></tr>
      <tr class="data-row drillable" tabindex="0" role="button" aria-expanded="false" onclick="toggleDrill('drill-dr-flagged-${slug}',this)" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();toggleDrill('drill-dr-flagged-${slug}',this)}">
        <td class="metric-label">Items w/ Repeated Design Reviews <span class="drill-icon">▾</span></td>
        <td class="metric-value ${drFlagged3mo.length>0?'accent2':''}">${drFlagged3mo.length||'0'} <span class="range-inline">· ${drFlagged.length} in ${esc(rng.short)}</span></td>
      </tr>
      <tr><td colspan="2" style="padding:0;"><div class="drill-panel" id="drill-dr-flagged-${slug}"></div></td></tr>
      ` : ''}

      ${CFG.relatedProjects?.length ? `<tr class="metric-section-row"><td colspan="2">PULL REQUESTS</td></tr>
      <tr class="data-row"><td class="metric-label">PRs authored (3mo)</td><td class="metric-value accent4">${d.prsAuthored3mo}</td></tr>
      <tr class="data-row"><td class="metric-label">PRs authored (6mo)</td><td class="metric-value">${d.prsAuthored6mo}</td></tr>
      <tr class="data-row range-row"><td class="metric-label">PRs authored (${esc(rng.short)})</td><td class="metric-value accent4">${d.prsAuthoredRange??'—'}</td></tr>
      <tr class="data-row"><td class="metric-label">PRs reviewed (3mo)</td><td class="metric-value accent4">${d.prsReviewed3mo}</td></tr>
      <tr class="data-row"><td class="metric-label">PRs reviewed (6mo)</td><td class="metric-value">${d.prsReviewed6mo}</td></tr>
      <tr class="data-row range-row"><td class="metric-label">PRs reviewed (${esc(rng.short)})</td><td class="metric-value accent4">${d.prsReviewedRange??'—'}</td></tr>` : ''}
      <tr class="data-row"><td class="metric-label">Peer review tasks / sprint (3mo avg)</td><td class="metric-value">${pr3mo!==null?fmt(pr3mo,1):'—'}</td></tr>
      <tr class="data-row"><td class="metric-label">Peer review tasks / sprint (6mo avg)</td><td class="metric-value">${pr6mo!==null?fmt(pr6mo,1):'—'}</td></tr>
      <tr class="data-row range-row"><td class="metric-label">Peer review tasks / sprint (${esc(rng.short)} avg)</td><td class="metric-value accent4">${prRange!==null?fmt(prRange,1):'—'}</td></tr>
      <tr class="data-row range-row"><td class="metric-label">Peer review tasks total (${esc(rng.short)})</td><td class="metric-value accent4">${d.peerReviewTaskCountRange??'—'}</td></tr>
      <tr class="data-row"><td class="metric-label">Avg hrs per review task (3mo)</td><td class="metric-value accent3">${d.peerReviewHoursPerTask3mo!==null?fmt(d.peerReviewHoursPerTask3mo)+' h':'—'}</td></tr>
      <tr class="data-row range-row"><td class="metric-label">Avg hrs per review task (${esc(rng.short)})</td><td class="metric-value accent3">${d.peerReviewHoursPerTaskRange!==null&&d.peerReviewHoursPerTaskRange!==undefined?fmt(d.peerReviewHoursPerTaskRange)+' h':'—'}</td></tr>

      <tr class="metric-section-row"><td colspan="2">ITEMS CREATED</td></tr>
      <tr class="data-row"><td class="metric-label">PBIs created (3mo)</td><td class="metric-value">${d.pbisCreated3mo}</td></tr>
      <tr class="data-row range-row"><td class="metric-label">PBIs created (${esc(rng.short)})</td><td class="metric-value accent4">${d.pbisCreatedRange??'—'}</td></tr>
      <tr class="data-row"><td class="metric-label">Bugs created (3mo)</td><td class="metric-value accent2">${d.bugsCreated3mo}</td></tr>
      <tr class="data-row range-row"><td class="metric-label">Bugs created (${esc(rng.short)})</td><td class="metric-value accent2">${d.bugsCreatedRange??'—'}</td></tr>
    </table>
  </div>`;

  html += `</div>`; // end sidebar

  // ── Right main ──────────────────────────────────────────────────────────
  html += `<div class="member-main">`;

  // PR Comments box
  if (CFG.relatedProjects?.length) {
    // One API call per PR, so surface the cost on the button before they click.
    const prsInRange = d.prsReviewedRange ?? d.prsReviewed3mo;
    html += `<h2 class="section-title">CODE REVIEW FOCUS</h2>
    <div class="pr-summary-box">
      <div class="psb-header">
        <span class="psb-title">PR Review Comments <span class="section-note">${esc(rng.label)}</span></span>
        <span class="psb-actions">
          <button class="btn-summarize" id="btn-sum-${slug}" onclick="fetchComments('${slug}','${m.replace(/'/g, "\\'")}')">
            &#8595; Load Comments${prsInRange ? ` (${prsInRange} PRs)` : ''}
          </button>
          <button class="btn-summarize btn-cancel-fetch" id="btn-cancel-${slug}" style="display:none;" onclick="cancelComments('${slug}')">
            Stop
          </button>
        </span>
      </div>
      <div class="psb-comment-count" id="psb-count-${slug}">${prsInRange} PRs reviewed in range · comments fetched on demand</div>
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

  const turnaroundBuckets = days => [
    { label:'<1d',  value: days.filter(x=>x<1).length,        isCurrent:false },
    { label:'1-3d', value: days.filter(x=>x>=1&&x<3).length,  isCurrent:false },
    { label:'3-7d', value: days.filter(x=>x>=3&&x<7).length,  isCurrent:false },
    { label:'1-2w', value: days.filter(x=>x>=7&&x<14).length, isCurrent:false },
    { label:'2-4w', value: days.filter(x=>x>=14&&x<28).length,isCurrent:true  },
    { label:'>4w',  value: days.filter(x=>x>=28).length,      isCurrent:false },
  ];

  if (d.completionDays.length > 0) {
    html += `<h2 class="section-title" style="margin-top:1.5rem;">TURNAROUND DISTRIBUTION (3MO)</h2>`;
    html += `<div class="chart-wrap"><div class="chart-title">Number of PBIs by time-to-complete</div>${buildBarChart(turnaroundBuckets(d.completionDays), '--accent3', 'items', 100)}</div>`;
  }

  // Only worth a second chart when the selected range holds items the 3mo
  // preset doesn't already cover.
  const rangeDays = d.completionDaysRange || [];
  if (rangeDays.length > 0 && rangeDays.length !== d.completionDays.length) {
    html += `<h2 class="section-title" style="margin-top:1.5rem;">TURNAROUND DISTRIBUTION — ${esc(rng.short.toUpperCase())}</h2>`;
    html += `<div class="chart-wrap"><div class="chart-title">Number of PBIs by time-to-complete · ${esc(rng.label)}</div>${buildBarChart(turnaroundBuckets(rangeDays), '--accent4', 'items', 100)}</div>`;
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
// Comments are fetched over the full selected sprint range. That is one API
// call per PR, so a long range means a long fetch — hence the live progress
// counter, the cancel button, and incremental rendering as results land.
const COMMENT_FETCH = {};   // slug → { cancelled: bool }

function prListForRange(d) {
  const range = RENDER_DATA?.range;
  const prs = d._prList || [];
  // Fallback matches the 3mo preset used everywhere else (calendar months, not
  // a flat 90 days) so the comment list can't disagree with the PR counts.
  const inRange = range?.start
    ? p => p.closedDate >= range.start && p.closedDate <= addDays(range.end, 1)
    : p => p.closedDate >= subMonths(new Date(), 3);
  return prs.filter(inRange).sort((a,b) => b.closedDate - a.closedDate);
}

function cancelComments(slug) {
  const state = COMMENT_FETCH[slug];
  if (state) state.cancelled = true;
}

function renderCommentList(slug, comments, prCount, truncated) {
  const dropEl = document.getElementById(`psb-comments-${slug}`);
  if (!dropEl) return;
  if (!comments.length) {
    dropEl.innerHTML = '<div class="drill-empty">No comments found in these PRs.</div>';
    return;
  }
  const sorted = [...comments].sort((a,b) => (b.date?.getTime()||0) - (a.date?.getTime()||0));
  const rows = sorted.map((c,i) => {
    const when = c.date ? c.date.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '';
    return `<div class="psb-comment-item">
      <span class="psb-comment-num">${i+1}</span>
      <div class="psb-comment-body">
        <div class="psb-comment-meta">
          <a href="${c.prUrl}" target="_blank">PR !${c.prId}<span class="sr-only"> (opens in new tab)</span></a>
          ${c.repoName ? `<span class="proj-badge">${esc(c.repoName)}</span>` : ''}
          ${when ? `<span class="psb-comment-date">${esc(when)}</span>` : ''}
        </div>
        <span class="psb-comment-text">${esc(c.text)}</span>
      </div>
      <a class="psb-comment-link" href="${c.prUrl}" target="_blank" aria-label="Open PR ${c.prId} (opens in new tab)">↗</a>
    </div>`;
  }).join('');
  const note = truncated ? `<div class="drill-empty">Cancelled — showing comments from the ${prCount} PRs fetched so far.</div>` : '';
  dropEl.innerHTML = `<div class="psb-comments-inner">${note}${rows}</div>`;
}

function setCommentSummary(slug, text) {
  const el = document.getElementById(`psb-count-${slug}`);
  if (el) el.textContent = text;
}

function showCommentToggle(slug) {
  const toggle = document.getElementById(`psb-comments-toggle-${slug}`);
  if (!toggle) return;
  toggle.style.display = 'flex';
  toggle.setAttribute('aria-expanded', 'true');
  const commentsEl = document.getElementById(`psb-comments-${slug}`);
  if (commentsEl) commentsEl.style.display = 'block';
  const span = toggle.querySelector('span');
  if (span) span.textContent = '▼ Hide individual comments';
}

async function fetchComments(slug, memberName) {
  const btn = document.getElementById(`btn-sum-${slug}`);
  if (!btn) return;
  const cancelBtn = document.getElementById(`btn-cancel-${slug}`);
  const d = RENDER_DATA?.md?.[memberName];
  if (!d) return;

  const prList = prListForRange(d);
  if (!prList.length) {
    const dropEl = document.getElementById(`psb-comments-${slug}`);
    if (dropEl) dropEl.innerHTML = '<div class="drill-empty">No PR reviews found in the selected range.</div>';
    showCommentToggle(slug);
    return;
  }

  const state = { cancelled: false };
  COMMENT_FETCH[slug] = state;
  btn.disabled = true;
  if (cancelBtn) cancelBtn.style.display = '';

  const allComments = [];
  let done = 0, batchNo = 0;
  for (let i = 0; i < prList.length; i += PR_COMMENT_BATCH) {
    if (state.cancelled) break;
    const batch = prList.slice(i, i + PR_COMMENT_BATCH);
    const results = await Promise.all(
      batch.map(p => fetchPRCommentsByMember(p.repoId, p.repoName, p.repoProject, p.prId))
    );
    for (const byMember of results) {
      if (byMember[memberName]) allComments.push(...byMember[memberName]);
    }
    done += batch.length;
    batchNo++;
    btn.textContent = `…${done}/${prList.length} PRs`;
    setCommentSummary(slug, `${allComments.length} comments from ${done} of ${prList.length} PRs…`);
    // Paint as we go so long fetches show something useful immediately, but
    // not every batch — re-rendering a growing list each time gets quadratic.
    if (batchNo === 1 || batchNo % 5 === 0) {
      renderCommentList(slug, allComments, done, false);
      if (batchNo === 1) showCommentToggle(slug);
    }
  }

  const cancelled = state.cancelled;
  delete COMMENT_FETCH[slug];
  renderCommentList(slug, allComments, done, cancelled);
  setCommentSummary(slug,
    `${allComments.length} comment${allComments.length===1?'':'s'} across ${done} PR${done===1?'':'s'}`
    + (cancelled ? ` (cancelled — ${prList.length - done} not fetched)` : ''));
  showCommentToggle(slug);

  if (cancelBtn) cancelBtn.style.display = 'none';
  btn.textContent = '↓ Reload';
  btn.disabled = false;
}

// ── TAB MANAGEMENT ────────────────────────────────────────────────────────────
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
function render({ md, currentIter, sprintStart, sprintEnd, historyIters, iters3moNorm, iters6moNorm, range }) {
  const rng = range || describeRange(historyIters);
  RENDER_DATA = { md, currentIter, historyIters, iters3moNorm, iters6moNorm, range: rng };

  const sStart = sprintStart.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  const sEnd   = sprintEnd.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  const current = CFG.sprintMode === 'dates'
    ? `Sprint window: <span>${sStart} – ${sEnd}</span>`
    : `Current Sprint: <span>${currentIter.name}</span> &nbsp;·&nbsp; <span>${sStart} – ${sEnd}</span>`;
  document.getElementById('sprint-label').innerHTML =
    `${current} &nbsp;·&nbsp; Loaded: <span>${esc(rng.label)}</span>`;

  buildTabs(CFG.members);

  const panelsEl = document.getElementById('tab-panels');

  const teamPanel = document.createElement('div');
  teamPanel.className = 'tab-panel active';
  teamPanel.id = 'panel-team';
  teamPanel.setAttribute('role', 'tabpanel');
  teamPanel.setAttribute('aria-labelledby', 'tab-team');
  teamPanel.innerHTML = `<div class="panel-content">${renderTeamTab(md, currentIter, historyIters, iters3moNorm, iters6moNorm, rng)}</div>`;
  panelsEl.appendChild(teamPanel);

  CFG.members.forEach((m, idx) => {
    const panel = document.createElement('div');
    panel.className = 'tab-panel';
    panel.id = `panel-member-${idx}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', `tab-member-${idx}`);
    panel.innerHTML = `<div class="panel-content">${renderMemberTab(m, md, currentIter, historyIters, iters3moNorm, iters6moNorm, rng)}</div>`;
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
