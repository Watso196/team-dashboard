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
function buildDateBasedSprints(startDate, count) {
  const sprints = [];
  for (let i = 0; i < count; i++) {
    const s = addDays(startDate, -(i * SPRINT_DAYS));
    const e = addDays(s, SPRINT_DAYS - 1);
    const label = `Sprint ${isoDate(s)}`;
    sprints.unshift({
      name: label,
      path: `date-sprint/${isoDate(s)}`,
      attributes: { startDate: s.toISOString(), finishDate: e.toISOString() },
      _synthetic: true,
    });
  }
  return sprints;
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
