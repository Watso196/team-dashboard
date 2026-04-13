/**
 * @jest-environment jsdom
 */

const { readFileSync } = require('node:fs');
const { join } = require('node:path');

// ── Load source files ─────────────────────────────────────────────────────────
const htmlSource = readFileSync(join(__dirname, 'ado-dashboard.html'), 'utf-8');
const jsFiles = ['state.js', 'constants.js', 'api.js', 'data.js', 'ui.js'];
const jsSources = jsFiles.map(f => readFileSync(join(__dirname, f), 'utf-8'));

// ── Helper: Transform top-level declarations to globalThis assignments ────────
// We scan the source line-by-line, tracking brace depth to identify truly
// top-level declarations (depth 0) and convert them to globalThis.xxx = ...
function transformToGlobal(src) {
  const lines = src.split('\n');
  let depth = 0;
  const result = [];
  for (const line of lines) {
    let transformed = line;
    if (depth === 0) {
      // Defensive semicolon: prevent ASI issues where ( starts a line after
      // a function expression assignment (e.g. IIFE after globalThis.fn = function(){})
      if (/^\(/.test(transformed)) {
        transformed = ';' + transformed;
      }
      // const/let name = ... → globalThis.name = ...
      transformed = transformed.replace(/^(const|let) (\w+)(\s*=)/, 'globalThis.$2$3');
      // function name( → globalThis.name = function name(
      transformed = transformed.replace(/^function (\w+)\s*\(/, 'globalThis.$1 = function $1(');
      // async function name( → globalThis.name = async function name(
      transformed = transformed.replace(/^async function (\w+)\s*\(/, 'globalThis.$1 = async function $1(');
    }
    // Track brace depth (rough but sufficient for well-formatted source)
    for (const ch of line) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    result.push(transformed);
  }
  return result.join('\n');
}

// ── Helper: run the dashboard JS in the current global context ────────────────
let jsLoaded = false;
function ensureJSLoaded() {
  if (jsLoaded) return;
  // Stub DOM methods the IIFE (prefillFromEnv) tries to call on load
  const origGetById = document.getElementById.bind(document);
  const origQuerySelector = document.querySelector.bind(document);
  const mockEl = { value: '', type: '', style: { display: '' }, setAttribute: () => {}, checked: false };
  document.getElementById = () => mockEl;
  document.querySelector = () => mockEl;

  // Load each source file in order, just like the browser's <script> tags
  const indirectEval = eval;
  for (const src of jsSources) {
    const transformed = transformToGlobal(src);
    indirectEval(transformed);
  }

  document.getElementById = origGetById;
  document.querySelector = origQuerySelector;
  jsLoaded = true;
}

// ── Helper to load the HTML into the DOM ──────────────────────────────────────
function loadHTML() {
  document.documentElement.innerHTML = new DOMParser().parseFromString(htmlSource, 'text/html').documentElement.innerHTML;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SECTION 1: SECURITY — XSS & INJECTION PREVENTION
// ═══════════════════════════════════════════════════════════════════════════════

describe('Security', () => {
  beforeAll(() => {
    ensureJSLoaded();
  });

  test('esc() prevents XSS by escaping HTML special characters', () => {
    expect(esc('<script>alert("xss")</script>')).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
    expect(esc('A & B')).toBe('A &amp; B');
  });

  test('diRow() escapes user-supplied title text to prevent XSS', () => {
    const item = { id: 1, url: '#', title: '<img onerror="alert(1)">', project: '' };
    const html = diRow(item, 'PBI', 'di-type-pbi', '');
    expect(html).not.toContain('<img onerror');
    expect(html).toContain('&lt;img onerror');
  });

  test('projBadge() escapes project name to prevent XSS', () => {
    const html = projBadge('<script>alert(1)</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  test('assigneeClause() escapes single quotes to prevent WIQL injection', () => {
    globalThis.CFG = { members: ["O'Brien"] };
    const clause = assigneeClause();
    expect(clause).toContain("O''Brien");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  SECTION 2: DATA PROCESSING — SPRINT GENERATION & MEMBER RESOLUTION
// ═══════════════════════════════════════════════════════════════════════════════

describe('Data Processing', () => {
  beforeAll(() => {
    ensureJSLoaded();
  });

  describe('buildDateBasedSprints()', () => {
    test('generates correct number of 14-day sprints', () => {
      const start = new Date('2026-04-06T00:00:00');
      const sprints = buildDateBasedSprints(start, 3);
      expect(sprints).toHaveLength(3);
      for (const s of sprints) {
        const sDate = new Date(s.attributes.startDate);
        const eDate = new Date(s.attributes.finishDate);
        expect((eDate - sDate) / 86400000).toBe(13); // 14-day span, inclusive
      }
    });

    test('returns sprints in chronological order (oldest first)', () => {
      const start = new Date('2026-04-06T00:00:00');
      const sprints = buildDateBasedSprints(start, 3);
      const dates = sprints.map(s => new Date(s.attributes.startDate).getTime());
      expect(dates[0]).toBeLessThan(dates[1]);
      expect(dates[1]).toBeLessThan(dates[2]);
    });

    test('last sprint starts on the given start date', () => {
      const start = new Date('2026-04-06T00:00:00');
      const sprints = buildDateBasedSprints(start, 3);
      const lastStart = new Date(sprints[2].attributes.startDate);
      expect(lastStart.toISOString().split('T')[0]).toBe('2026-04-06');
    });
  });

  describe('Member resolution', () => {
    beforeEach(() => {
      globalThis.CFG = { members: ['Alice Smith', 'Bob Jones'] };
    });

    test('extractName() parses display names from ADO string and object formats', () => {
      expect(extractName(null)).toBeNull();
      expect(extractName('  Jane Doe  ')).toBe('Jane Doe');
      expect(extractName('Jane Doe <jane@example.com>')).toBe('Jane Doe');
      expect(extractName({ displayName: 'John Smith', uniqueName: 'jsmith' })).toBe('John Smith');
    });

    test('matchMember() resolves team members case-insensitively', () => {
      expect(matchMember('Alice Smith')).toBe('Alice Smith');
      expect(matchMember('alice smith')).toBe('Alice Smith');
      expect(matchMember({ displayName: 'Bob Jones' })).toBe('Bob Jones');
    });

    test('matchMember() returns null for non-members and invalid input', () => {
      expect(matchMember('Charlie Brown')).toBeNull();
      expect(matchMember(null)).toBeNull();
    });
  });

  describe('effortOf()', () => {
    test('extracts StoryPoints with Effort as fallback, defaulting to 0', () => {
      expect(effortOf({ fields: { 'Microsoft.VSTS.Scheduling.StoryPoints': 5, 'Microsoft.VSTS.Scheduling.Effort': 3 } })).toBe(5);
      expect(effortOf({ fields: { 'Microsoft.VSTS.Scheduling.Effort': 8 } })).toBe(8);
      expect(effortOf({ fields: {} })).toBe(0);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  SECTION 3: PAGE ACCESSIBILITY — STATIC HTML STRUCTURE
// ═══════════════════════════════════════════════════════════════════════════════

describe('Page Accessibility', () => {
  beforeAll(() => {
    loadHTML();
  });

  describe('Landmark regions & navigation', () => {
    test('config screen uses <main>', () => {
      expect(document.getElementById('config-screen').tagName).toBe('MAIN');
    });

    test('dashboard has <header> with role=banner', () => {
      const header = document.querySelector('#dashboard-screen header');
      expect(header).not.toBeNull();
      expect(header.getAttribute('role')).toBe('banner');
    });

    test('tab bar uses <nav> with aria-label', () => {
      const nav = document.querySelector('#tab-bar');
      expect(nav.tagName).toBe('NAV');
      expect(nav.getAttribute('aria-label')).toBeTruthy();
    });

    test('tab panels container uses <main>', () => {
      expect(document.getElementById('tab-panels').tagName).toBe('MAIN');
    });

    test('skip link exists with sr-only class and points to main content', () => {
      const skipLink = document.querySelector('a[href="#tab-panels"]');
      expect(skipLink).not.toBeNull();
      expect(skipLink.textContent).toContain('Skip to content');
      expect(skipLink.classList.contains('sr-only')).toBe(true);
    });

    test('both screens have h1 headings', () => {
      expect(document.querySelector('#config-screen h1')).not.toBeNull();
      expect(document.querySelector('#dashboard-screen h1')).not.toBeNull();
    });
  });

  describe('Config form structure', () => {
    test('config card is a <form> with novalidate', () => {
      const form = document.querySelector('.config-card');
      expect(form.tagName).toBe('FORM');
      expect(form.hasAttribute('novalidate')).toBe(true);
    });

    test('submit button has type="submit"', () => {
      expect(document.querySelector('.btn-primary').getAttribute('type')).toBe('submit');
    });
  });

  describe('Label associations', () => {
    const expectedPairs = [
      ['org-url', 'Organization URL'],
      ['project', 'Project Name'],
      ['team', 'Team Name'],
      ['iteration-count', 'Past Iterations to Load'],
      ['sprint-start-date', 'Sprint Start Date'],
      ['sprint-count', 'Past Sprints to Load'],
      ['pat', 'Personal Access Token'],
      ['members', 'Team Members'],
      ['related-projects', 'Related Projects'],
    ];

    test.each(expectedPairs)('#%s has a label containing "%s" and a matching input', (id, labelText) => {
      const label = document.querySelector(`label[for="${id}"]`);
      expect(label).not.toBeNull();
      expect(label.textContent).toContain(labelText);
      expect(document.getElementById(id)).not.toBeNull();
    });
  });

  describe('Required field indicators', () => {
    const requiredIds = ['org-url', 'project', 'team', 'sprint-start-date', 'pat', 'members'];

    test.each(requiredIds)('#%s has aria-required and visual * indicator', (id) => {
      const input = document.getElementById(id);
      expect(input.getAttribute('aria-required')).toBe('true');
      const label = document.querySelector(`label[for="${id}"]`);
      expect(label.textContent).toContain('*');
    });
  });

  describe('Hint text associations', () => {
    const fieldsWithHints = [
      'project', 'team', 'iteration-count', 'sprint-start-date',
      'sprint-count', 'pat', 'members', 'related-projects',
    ];

    test.each(fieldsWithHints)('#%s has aria-describedby pointing to existing hint', (id) => {
      const input = document.getElementById(id);
      const describedBy = input.getAttribute('aria-describedby');
      expect(describedBy).toBeTruthy();
      const hintEl = document.getElementById(describedBy);
      expect(hintEl).not.toBeNull();
      expect(hintEl.textContent.length).toBeGreaterThan(0);
    });
  });

  describe('Sprint mode radio group', () => {
    test('radios are in a fieldset with a legend', () => {
      const fieldset = document.querySelector('fieldset.field-group');
      expect(fieldset).not.toBeNull();
      expect(fieldset.querySelectorAll('input[type="radio"]').length).toBe(2);
      const legend = fieldset.querySelector('legend');
      expect(legend).not.toBeNull();
      expect(legend.textContent).toContain('Sprint Mode');
    });
  });

  describe('Error & loading regions', () => {
    test('config-error has role="alert" and aria-live="assertive"', () => {
      const err = document.getElementById('config-error');
      expect(err.getAttribute('role')).toBe('alert');
      expect(err.getAttribute('aria-live')).toBe('assertive');
    });

    test('error-area has role="alert" and aria-live="assertive"', () => {
      const err = document.getElementById('error-area');
      expect(err.getAttribute('role')).toBe('alert');
      expect(err.getAttribute('aria-live')).toBe('assertive');
    });

    test('loading spinner has role="status" and loading step has aria-live', () => {
      const loader = document.querySelector('.loader-ring');
      expect(loader.getAttribute('role')).toBe('status');
      expect(loader.getAttribute('aria-label')).toBeTruthy();
      expect(document.getElementById('loading-step').getAttribute('aria-live')).toBe('polite');
    });
  });

  describe('Design review toggle switch', () => {
    test('has role="switch" with aria-checked and aria-labelledby', () => {
      const toggle = document.getElementById('design-review-enabled');
      expect(toggle.getAttribute('role')).toBe('switch');
      expect(toggle.getAttribute('aria-checked')).toBe('false');
      const labelId = toggle.getAttribute('aria-labelledby');
      expect(labelId).toBeTruthy();
      const label = document.getElementById(labelId);
      expect(label).not.toBeNull();
      expect(label.textContent).toContain('Design Review');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  SECTION 4: GENERATED CONTENT ACCESSIBILITY
// ═══════════════════════════════════════════════════════════════════════════════

describe('Generated Content Accessibility', () => {
  beforeAll(() => {
    ensureJSLoaded();
  });

  describe('dr() drillable rows', () => {
    test('are keyboard-accessible with ARIA attributes', () => {
      const html = dr('Test Label', 'test-drill', '42', 'accent');
      expect(html).toContain('tabindex="0"');
      expect(html).toContain('role="button"');
      expect(html).toContain('aria-expanded="false"');
    });

    test('have keyboard handler for Enter and Space', () => {
      const html = dr('Test Label', 'test-drill', '42');
      expect(html).toContain("event.key==='Enter'");
      expect(html).toContain("event.key===' '");
    });
  });

  describe('diRow() drill items', () => {
    test('external links include sr-only "opens in new tab" text', () => {
      const item = { id: 123, url: 'https://example.com', title: 'Test', project: 'Proj' };
      const html = diRow(item, 'PBI', 'di-type-pbi', '<span>5 pts</span>');
      expect(html).toContain('(opens in new tab)');
      expect(html).toContain('sr-only');
    });
  });

  describe('Charts', () => {
    test('buildBarChart() shows accessible SVG or no-data message', () => {
      expect(buildBarChart([], '--accent', 'pts')).toContain('No data');
      const data = [{ label: 'Sprint 1', value: 10, isCurrent: false }, { label: 'Sprint 2', value: 20, isCurrent: true }];
      const html = buildBarChart(data, '--accent', 'pts');
      expect(html).toContain('role="img"');
      expect(html).toContain('Sprint 1: 10');
      expect(html).toContain('Sprint 2: 20');
    });

    test('buildSparkline() SVG has role="img" and aria-label', () => {
      expect(buildSparkline([])).toBe('');
      const html = buildSparkline([1, 2, 3]);
      expect(html).toContain('role="img"');
      expect(html).toContain('1, 2, 3');
    });
  });

  describe('Tab pattern', () => {
    beforeEach(() => {
      document.body.innerHTML = '<nav id="tab-bar"></nav>';
      globalThis.CFG = { members: ['Alice', 'Bob'] };
      globalThis.MEMBER_COLORS = ['#2ec98a', '#c45252', '#c9a040', '#4ea0d4', '#9b72cf'];
    });

    test('buildTabs() creates tablist with proper ARIA roles and state', () => {
      buildTabs(['Alice', 'Bob']);
      expect(document.getElementById('tab-bar').getAttribute('role')).toBe('tablist');
      const tabs = document.querySelectorAll('[role="tab"]');
      expect(tabs.length).toBe(3); // Team + Alice + Bob
      expect(tabs[0].getAttribute('aria-selected')).toBe('true');
      expect(tabs[1].getAttribute('aria-selected')).toBe('false');
      expect(tabs[1].getAttribute('tabindex')).toBe('-1');
      expect(tabs[0].getAttribute('aria-controls')).toBe('panel-team');
    });

    test('switchTab() updates ARIA state and activates correct panel', () => {
      document.body.innerHTML = `
        <nav id="tab-bar">
          <button class="tab-btn active" role="tab" aria-selected="true" tabindex="0" id="tab-team">Team</button>
          <button class="tab-btn" role="tab" aria-selected="false" tabindex="-1" id="tab-member-0">Alice</button>
        </nav>
        <div class="tab-panel active" id="panel-team" role="tabpanel"></div>
        <div class="tab-panel" id="panel-member-0" role="tabpanel"></div>
      `;
      const aliceBtn = document.getElementById('tab-member-0');
      switchTab('member-0', aliceBtn);
      expect(aliceBtn.getAttribute('aria-selected')).toBe('true');
      expect(document.getElementById('tab-team').getAttribute('aria-selected')).toBe('false');
      expect(document.getElementById('panel-member-0').classList.contains('active')).toBe(true);
      expect(document.getElementById('panel-team').classList.contains('active')).toBe(false);
    });
  });

  describe('Drill toggle interactions', () => {
    test('toggleDrill() opens/closes drill panels and updates aria-expanded', () => {
      document.body.innerHTML = `
        <table>
          <tr class="drillable" aria-expanded="false" id="trigger1"><td>Row</td></tr>
          <tr><td><div class="drill-panel" id="dp1"></div></td></tr>
        </table>
      `;
      const trigger = document.getElementById('trigger1');
      toggleDrill('dp1', trigger);
      expect(document.getElementById('dp1').classList.contains('open')).toBe(true);
      expect(trigger.getAttribute('aria-expanded')).toBe('true');
      toggleDrill('dp1', trigger);
      expect(document.getElementById('dp1').classList.contains('open')).toBe(false);
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });

    test('toggleDrill() toggles history table drill rows via display style', () => {
      document.body.innerHTML = `<table><tr class="hist-drill-row" id="hdr1" style="display:none;"><td>Details</td></tr></table>`;
      toggleDrill('hdr1');
      expect(document.getElementById('hdr1').style.display).toBe('table-row');
      toggleDrill('hdr1');
      expect(document.getElementById('hdr1').style.display).toBe('none');
    });

    test('toggleDrill() toggles PR comment lists with label update', () => {
      document.body.innerHTML = `
        <div class="psb-comments-toggle" id="trigger" aria-expanded="false"><span>▶ View individual comments</span></div>
        <div class="psb-comments-list" id="comments" style="display:none;"></div>
      `;
      const trigger = document.getElementById('trigger');
      toggleDrill('comments', trigger);
      expect(document.getElementById('comments').style.display).toBe('block');
      expect(trigger.querySelector('span').textContent).toContain('Hide');
      toggleDrill('comments', trigger);
      expect(document.getElementById('comments').style.display).toBe('none');
      expect(trigger.querySelector('span').textContent).toContain('View');
    });
  });

  describe('fill()', () => {
    test('displays empty message when no drill items exist', () => {
      document.body.innerHTML = '<div id="fill-test"></div>';
      fill('fill-test', []);
      expect(document.getElementById('fill-test').textContent).toContain('No items found');
    });

    test('renders provided rows into the container', () => {
      document.body.innerHTML = '<div id="fill-test"></div>';
      fill('fill-test', ['<div>A</div>', '<div>B</div>']);
      expect(document.getElementById('fill-test').children.length).toBe(2);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  SECTION 5: RENDERED OUTPUT ACCESSIBILITY
// ═══════════════════════════════════════════════════════════════════════════════

describe('Rendered Output Accessibility', () => {
  const mockMd = {};
  const mockIter = { name: 'Sprint 1', path: 'proj/sprint-1', attributes: { startDate: '2026-04-06T00:00:00Z', finishDate: '2026-04-19T23:59:59Z' } };

  beforeAll(() => {
    ensureJSLoaded();
    globalThis.CFG = {
      org: 'https://dev.azure.com/test',
      project: 'TestProj',
      team: 'Team',
      members: ['Alice'],
      relatedProjects: [],
      sprintMode: 'iterations',
      designReviewEnabled: false,
    };

    mockMd['Alice'] = {
      effortDone: 10, effortThisSprint: 15, itemsDoneThisSprint: 3,
      pbisChanged: new Set([1, 2]), bugsChanged: new Set([3]), featuresChanged: new Set(),
      hoursThisSprint: 20, prCount: 1,
      doneItems: [{ id: 1, title: 'PBI 1', type: 'Product Backlog Item', pts: 5, project: 'TestProj', url: '#' }],
      changedPBIs: [], changedBugs: [], changedFeatures: [], sprintTasks: [],
      allSprintPBIs: [],
      history: {
        'proj/sprint-1': {
          effort: 10, hours: 20, itemCount: 3, peerReviewCount: 1,
          is3mo: true, is6mo: true, isCurrent: true, iterName: 'Sprint 1',
          doneItems: [{ id: 1, title: 'PBI 1', type: 'Product Backlog Item', pts: 5, project: 'TestProj', url: '#' }],
        },
      },
      completionDays: [2, 5, 8],
      prsReviewed3mo: 0, prsReviewed6mo: 0,
      prsAuthoredThisSprint: 0, prsAuthored3mo: 0, prsAuthored6mo: 0,
      prComments: [],
      pbisCreated3mo: 1, bugsCreated3mo: 0,
      peerReviewTasksThisSprint: 1,
      peerReviewTaskCount3mo: 2, peerReviewTaskCount6mo: 3,
      peerReviewHours3mo: 4, peerReviewHoursPerTask3mo: 2,
      designReviewItems: [], designReviewFlagged: [],
    };
  });

  describe('renderTeamTab()', () => {
    let html;
    beforeAll(() => {
      html = renderTeamTab(mockMd, mockIter, [mockIter], new Set(['proj/sprint-1']), new Set(['proj/sprint-1']));
    });

    test('uses semantic <h2> headings for section titles', () => {
      expect(html).toMatch(/<h2\s+class="section-title"/);
      expect(html).not.toContain('<div class="section-title">');
    });

    test('member cards are keyboard-accessible', () => {
      expect(html).toContain('role="button"');
      expect(html).toContain('tabindex="0"');
      expect(html).toContain('onkeydown=');
    });
  });

  describe('renderMemberTab()', () => {
    let html;
    beforeAll(() => {
      html = renderMemberTab('Alice', mockMd, mockIter, [mockIter], new Set(['proj/sprint-1']), new Set(['proj/sprint-1']));
    });

    test('uses semantic <h2> headings and sr-only table captions', () => {
      expect(html).toMatch(/<h2\s+class="section-title"/);
      expect(html).toContain('<caption class="sr-only">');
    });

    test('drillable rows are keyboard-accessible with ARIA', () => {
      expect(html).toContain('role="button"');
      expect(html).toContain('aria-expanded="false"');
    });
  });

  describe('buildMemberHistoryTable()', () => {
    let html;
    beforeAll(() => {
      html = buildMemberHistoryTable(mockMd['Alice'], [mockIter], 'alice');
    });

    test('history table has sr-only caption', () => {
      expect(html).toContain('<caption class="sr-only">');
      expect(html).toContain('Sprint history');
    });

    test('effort drill triggers are accessible buttons', () => {
      expect(html).toContain('<button type="button" class="hist-drill-trigger');
      expect(html).toContain('aria-expanded="false"');
    });

    test('drill item links announce they open in a new tab', () => {
      expect(html).toContain('(opens in new tab)');
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  SECTION 6: FORM VALIDATION & ERROR DISPLAY
// ═══════════════════════════════════════════════════════════════════════════════

describe('Form Validation & Error Display', () => {
  beforeEach(() => {
    ensureJSLoaded();
    loadHTML();
  });

  test('shows error when required fields are empty', () => {
    startDashboard();
    const err = document.getElementById('config-error');
    expect(err.style.display).toBe('block');
    expect(err.textContent).toContain('required');
  });

  test('shows error when team is empty in iteration mode', () => {
    document.getElementById('org-url').value = 'https://dev.azure.com/test';
    document.getElementById('project').value = 'TestProject';
    document.getElementById('pat').value = 'test-pat';
    document.getElementById('members').value = 'Alice';
    document.getElementById('team').value = '';
    startDashboard();
    const err = document.getElementById('config-error');
    expect(err.style.display).toBe('block');
    expect(err.textContent).toContain('Team Name');
  });

  test('shows error when date is empty in date-based mode', () => {
    document.getElementById('org-url').value = 'https://dev.azure.com/test';
    document.getElementById('project').value = 'TestProject';
    document.getElementById('pat').value = 'test-pat';
    document.getElementById('members').value = 'Alice';
    document.getElementById('mode-dates').checked = true;
    onSprintModeChange();
    document.getElementById('sprint-start-date').value = '';
    startDashboard();
    const err = document.getElementById('config-error');
    expect(err.style.display).toBe('block');
    expect(err.textContent).toContain('Sprint Start Date');
  });

  test('sets aria-invalid on empty required fields', () => {
    startDashboard();
    expect(document.getElementById('org-url').getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('project').getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('pat').getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('members').getAttribute('aria-invalid')).toBe('true');
  });

  test('sets aria-invalid only on the fields that are empty', () => {
    document.getElementById('org-url').value = 'https://dev.azure.com/test';
    document.getElementById('project').value = '';
    document.getElementById('pat').value = 'my-pat';
    document.getElementById('members').value = '';
    startDashboard();
    expect(document.getElementById('org-url').hasAttribute('aria-invalid')).toBe(false);
    expect(document.getElementById('project').getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById('pat').hasAttribute('aria-invalid')).toBe(false);
    expect(document.getElementById('members').getAttribute('aria-invalid')).toBe('true');
  });

  test('clears aria-invalid on subsequent validation attempt', () => {
    startDashboard();
    expect(document.getElementById('org-url').getAttribute('aria-invalid')).toBe('true');
    // Fill fields and re-submit
    document.getElementById('org-url').value = 'https://dev.azure.com/test';
    document.getElementById('project').value = 'Proj';
    document.getElementById('pat').value = 'pat';
    document.getElementById('members').value = 'Alice';
    document.getElementById('team').value = '';
    startDashboard();
    expect(document.getElementById('org-url').hasAttribute('aria-invalid')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
//  SECTION 7: USER NAVIGATION & SCREEN TRANSITIONS
// ═══════════════════════════════════════════════════════════════════════════════

describe('User Navigation', () => {
  beforeEach(() => {
    ensureJSLoaded();
    loadHTML();
  });

  test('sprint mode toggle shows/hides the correct field groups', () => {
    const iterFields = document.getElementById('iter-fields');
    const dateFields = document.getElementById('date-fields');

    document.getElementById('mode-iterations').checked = true;
    onSprintModeChange();
    expect(iterFields.style.display).toBe('');
    expect(dateFields.style.display).toBe('none');

    document.getElementById('mode-dates').checked = true;
    onSprintModeChange();
    expect(iterFields.style.display).toBe('none');
    expect(dateFields.style.display).toBe('');
  });

  test('resetToConfig returns to config screen and clears dashboard', () => {
    document.getElementById('config-screen').style.display = 'none';
    document.getElementById('dashboard-screen').style.display = 'block';
    resetToConfig();
    expect(document.getElementById('config-screen').style.display).toBe('flex');
    expect(document.getElementById('dashboard-screen').style.display).toBe('none');
  });
});
