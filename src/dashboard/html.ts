export function getDashboardHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Beecork Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      theme: {
        extend: {
          colors: {
            honey: { 50: '#fefce8', 100: '#fef9c3', 200: '#fef08a', 300: '#fde047', 400: '#facc15', 500: '#eab308', 600: '#ca8a04', 700: '#a16207' },
            bee: { 900: '#1a1a1a', 800: '#262626', 700: '#333333', 600: '#444444' }
          }
        }
      }
    }
  </script>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
    .msg-user { background: #2d2d2d; border-left: 3px solid #facc15; }
    .msg-assistant { background: #1f1f1f; border-left: 3px solid #666; }
    .tab-active { background: #facc1520; border-left: 3px solid #facc15; }
    .cost-bar { background: linear-gradient(to top, #facc15, #eab308); border-radius: 2px 2px 0 0; }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: #1a1a1a; }
    ::-webkit-scrollbar-thumb { background: #444; border-radius: 3px; }
  </style>
</head>
<body class="bg-bee-900 text-gray-200 min-h-screen">

  <!-- Header -->
  <header class="bg-bee-800 border-b border-bee-600 px-6 py-3 flex items-center justify-between">
    <div class="flex items-center gap-3">
      <span class="text-2xl">🐝</span>
      <h1 class="text-lg font-semibold text-white">Beecork</h1>
      <span id="version" class="text-xs text-gray-500 font-mono"></span>
      <span id="update-badge" class="hidden text-xs bg-honey-500 text-black px-2 py-0.5 rounded-full font-medium"></span>
    </div>
    <div class="flex items-center gap-4">
      <div class="flex items-center gap-2">
        <span id="daemon-dot" class="w-2.5 h-2.5 rounded-full bg-gray-600"></span>
        <span id="daemon-status" class="text-sm text-gray-400">checking...</span>
      </div>
      <div class="text-xs text-gray-500 font-mono" id="stats"></div>
    </div>
  </header>

  <!-- Navigation -->
  <nav class="bg-bee-800 border-b border-bee-700 px-6">
    <div class="flex gap-1">
      <button onclick="showPanel('tabs')" data-panel="tabs" class="nav-btn px-4 py-2 text-sm rounded-t border-b-2 border-transparent hover:text-white text-gray-400">Tabs</button>
      <button onclick="showPanel('memories')" data-panel="memories" class="nav-btn px-4 py-2 text-sm rounded-t border-b-2 border-transparent hover:text-white text-gray-400">Memories</button>
      <button onclick="showPanel('crons')" data-panel="crons" class="nav-btn px-4 py-2 text-sm rounded-t border-b-2 border-transparent hover:text-white text-gray-400">Cron Jobs</button>
      <button onclick="showPanel('costs')" data-panel="costs" class="nav-btn px-4 py-2 text-sm rounded-t border-b-2 border-transparent hover:text-white text-gray-400">Costs</button>
    </div>
  </nav>

  <!-- Main content -->
  <main class="p-6">

    <!-- Tabs Panel -->
    <div id="panel-tabs" class="panel">
      <div class="grid grid-cols-12 gap-6">
        <!-- Tab list -->
        <div class="col-span-4 bg-bee-800 rounded-lg border border-bee-700 overflow-hidden">
          <div class="px-4 py-3 border-b border-bee-700 flex items-center justify-between">
            <h2 class="text-sm font-semibold text-gray-300">Tabs</h2>
            <span id="tab-count" class="text-xs text-gray-500"></span>
          </div>
          <div id="tab-list" class="max-h-[calc(100vh-220px)] overflow-y-auto"></div>
        </div>
        <!-- Messages -->
        <div class="col-span-8 bg-bee-800 rounded-lg border border-bee-700 overflow-hidden">
          <div class="px-4 py-3 border-b border-bee-700 flex items-center justify-between">
            <h2 class="text-sm font-semibold text-gray-300" id="msg-title">Select a tab</h2>
            <span id="msg-count" class="text-xs text-gray-500"></span>
          </div>
          <div id="msg-list" class="max-h-[calc(100vh-220px)] overflow-y-auto p-4 space-y-3">
            <p class="text-gray-500 text-sm text-center py-8">Click a tab to view messages</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Memories Panel -->
    <div id="panel-memories" class="panel hidden">
      <div class="bg-bee-800 rounded-lg border border-bee-700 overflow-hidden">
        <div class="px-4 py-3 border-b border-bee-700 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-gray-300">Memories</h2>
          <div class="flex items-center gap-3">
            <input id="memory-search" type="text" placeholder="Search memories..."
              class="bg-bee-900 border border-bee-600 rounded px-3 py-1 text-sm text-gray-300 w-64 focus:outline-none focus:border-honey-500"
              oninput="debounceMemorySearch()">
            <span id="memory-count" class="text-xs text-gray-500"></span>
          </div>
        </div>
        <div id="memory-list" class="max-h-[calc(100vh-220px)] overflow-y-auto"></div>
      </div>
    </div>

    <!-- Cron Panel -->
    <div id="panel-crons" class="panel hidden">
      <div class="bg-bee-800 rounded-lg border border-bee-700 overflow-hidden">
        <div class="px-4 py-3 border-b border-bee-700">
          <h2 class="text-sm font-semibold text-gray-300">Cron Jobs</h2>
        </div>
        <div id="cron-list" class="max-h-[calc(100vh-220px)] overflow-y-auto"></div>
      </div>
    </div>

    <!-- Costs Panel -->
    <div id="panel-costs" class="panel hidden">
      <div class="bg-bee-800 rounded-lg border border-bee-700 overflow-hidden">
        <div class="px-4 py-3 border-b border-bee-700 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-gray-300">API Costs (Last 30 Days)</h2>
          <span id="total-cost" class="text-sm font-mono text-honey-400"></span>
        </div>
        <div id="cost-chart" class="p-6"></div>
      </div>
    </div>

  </main>

<script>
  // State
  let selectedTab = null;
  let memorySearchTimer = null;

  // API helper
  async function api(path) {
    const res = await fetch(path);
    return res.json();
  }

  // Time formatting
  function timeAgo(iso) {
    if (!iso) return 'never';
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + 'm ago';
    const hours = Math.floor(mins / 60);
    if (hours < 24) return hours + 'h ago';
    return Math.floor(hours / 24) + 'd ago';
  }

  // Panel switching
  function showPanel(name) {
    document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
    document.getElementById('panel-' + name).classList.remove('hidden');
    document.querySelectorAll('.nav-btn').forEach(b => {
      b.classList.remove('border-honey-500', 'text-white');
      b.classList.add('border-transparent', 'text-gray-400');
    });
    const btn = document.querySelector('[data-panel="' + name + '"]');
    btn.classList.add('border-honey-500', 'text-white');
    btn.classList.remove('border-transparent', 'text-gray-400');

    if (name === 'memories') loadMemories();
    if (name === 'crons') loadCrons();
    if (name === 'costs') loadCosts();
  }

  // Status polling
  async function loadStatus() {
    try {
      const s = await api('/api/status');
      document.getElementById('version').textContent = 'v' + s.version;
      const dot = document.getElementById('daemon-dot');
      const status = document.getElementById('daemon-status');
      if (s.daemonPid) {
        dot.className = 'w-2.5 h-2.5 rounded-full bg-green-500';
        status.textContent = 'running (PID ' + s.daemonPid + ')';
      } else {
        dot.className = 'w-2.5 h-2.5 rounded-full bg-red-500';
        status.textContent = 'stopped';
      }
      document.getElementById('stats').textContent =
        s.tabs + ' tabs | ' + s.cronJobs + ' crons | ' + s.memories + ' memories';
    } catch {}
  }

  // Tabs
  async function loadTabs() {
    const tabs = await api('/api/tabs');
    const list = document.getElementById('tab-list');
    document.getElementById('tab-count').textContent = tabs.length + ' tabs';

    if (tabs.length === 0) {
      list.innerHTML = '<p class="text-gray-500 text-sm text-center py-8">No tabs</p>';
      return;
    }

    list.innerHTML = tabs.map(t => {
      const statusColors = { idle: 'text-gray-500', running: 'text-green-400', error: 'text-red-400', stopped: 'text-gray-600' };
      const isActive = selectedTab === t.name ? 'tab-active' : '';
      const cost = t.total_cost > 0 ? '$' + t.total_cost.toFixed(4) : '';
      return '<div class="px-4 py-3 border-b border-bee-700 cursor-pointer hover:bg-bee-700 ' + isActive + '" onclick="selectTab(\\''+t.name+'\\')">' +
        '<div class="flex items-center justify-between">' +
          '<span class="text-sm font-medium text-white">' + esc(t.name) + '</span>' +
          '<span class="text-xs ' + (statusColors[t.status] || 'text-gray-500') + '">' + t.status + '</span>' +
        '</div>' +
        '<div class="flex items-center justify-between mt-1">' +
          '<span class="text-xs text-gray-500">' + t.message_count + ' msgs' + (cost ? ' | ' + cost : '') + '</span>' +
          '<span class="text-xs text-gray-600">' + timeAgo(t.last_activity_at) + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  async function selectTab(name) {
    selectedTab = name;
    document.getElementById('msg-title').textContent = name;
    loadTabs(); // refresh active highlight

    const data = await api('/api/tabs/' + encodeURIComponent(name) + '/messages?limit=100');
    const list = document.getElementById('msg-list');
    document.getElementById('msg-count').textContent = data.total + ' messages';

    if (data.messages.length === 0) {
      list.innerHTML = '<p class="text-gray-500 text-sm text-center py-8">No messages in this tab</p>';
      return;
    }

    list.innerHTML = data.messages.map(m => {
      const cls = m.role === 'user' ? 'msg-user' : 'msg-assistant';
      const label = m.role === 'user' ? 'You' : 'Claude';
      const meta = [];
      if (m.cost_usd > 0) meta.push('$' + m.cost_usd.toFixed(4));
      if (m.tokens_in) meta.push(m.tokens_in.toLocaleString() + ' in');
      if (m.tokens_out) meta.push(m.tokens_out.toLocaleString() + ' out');
      const metaStr = meta.length ? '<span class="text-xs text-gray-600 ml-2">' + meta.join(' | ') + '</span>' : '';

      // Truncate very long messages
      const content = m.content.length > 2000 ? m.content.slice(0, 2000) + '\\n\\n... (' + m.content.length.toLocaleString() + ' chars total)' : m.content;

      return '<div class="' + cls + ' rounded p-3">' +
        '<div class="flex items-center justify-between mb-1">' +
          '<span class="text-xs font-semibold ' + (m.role === 'user' ? 'text-honey-400' : 'text-gray-400') + '">' + label + metaStr + '</span>' +
          '<span class="text-xs text-gray-600">' + timeAgo(m.created_at) + '</span>' +
        '</div>' +
        '<pre class="text-sm text-gray-300 whitespace-pre-wrap break-words font-sans">' + esc(content) + '</pre>' +
      '</div>';
    }).join('');

    list.scrollTop = list.scrollHeight;
  }

  // Memories
  async function loadMemories(query) {
    const q = query || document.getElementById('memory-search').value || '';
    const data = await api('/api/memories?limit=100&q=' + encodeURIComponent(q));
    const list = document.getElementById('memory-list');
    document.getElementById('memory-count').textContent = data.total + ' memories';

    if (data.memories.length === 0) {
      list.innerHTML = '<p class="text-gray-500 text-sm text-center py-8">No memories' + (q ? ' matching "' + esc(q) + '"' : '') + '</p>';
      return;
    }

    list.innerHTML = data.memories.map(m => {
      const scope = m.tab_name ? 'tab:' + m.tab_name : 'global';
      return '<div class="px-4 py-3 border-b border-bee-700">' +
        '<div class="flex items-center justify-between mb-1">' +
          '<div class="flex items-center gap-2">' +
            '<span class="text-xs px-1.5 py-0.5 rounded ' + (m.source === 'auto' ? 'bg-blue-900 text-blue-300' : 'bg-purple-900 text-purple-300') + '">' + m.source + '</span>' +
            '<span class="text-xs text-gray-500">' + scope + '</span>' +
          '</div>' +
          '<span class="text-xs text-gray-600">' + timeAgo(m.created_at) + '</span>' +
        '</div>' +
        '<p class="text-sm text-gray-300">' + esc(m.content) + '</p>' +
      '</div>';
    }).join('');
  }

  function debounceMemorySearch() {
    clearTimeout(memorySearchTimer);
    memorySearchTimer = setTimeout(() => loadMemories(), 300);
  }

  // Crons
  async function loadCrons() {
    const crons = await api('/api/crons');
    const list = document.getElementById('cron-list');

    if (crons.length === 0) {
      list.innerHTML = '<p class="text-gray-500 text-sm text-center py-8">No cron jobs</p>';
      return;
    }

    list.innerHTML = crons.map(c => {
      const enabled = c.enabled === 1;
      return '<div class="px-4 py-3 border-b border-bee-700">' +
        '<div class="flex items-center justify-between">' +
          '<div class="flex items-center gap-2">' +
            '<span class="w-2 h-2 rounded-full ' + (enabled ? 'bg-green-500' : 'bg-gray-600') + '"></span>' +
            '<span class="text-sm font-medium text-white">' + esc(c.name) + '</span>' +
          '</div>' +
          '<span class="text-xs font-mono text-gray-400">' + c.schedule_type + ': ' + esc(c.schedule) + '</span>' +
        '</div>' +
        '<div class="flex items-center justify-between mt-1 pl-4">' +
          '<span class="text-xs text-gray-500">tab: ' + esc(c.tab_name) + ' | message: ' + esc((c.message || '').slice(0, 60)) + '</span>' +
          '<span class="text-xs text-gray-600">last: ' + timeAgo(c.last_run_at) + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  // Costs
  async function loadCosts() {
    const costs = await api('/api/costs');
    const chart = document.getElementById('cost-chart');

    if (costs.length === 0) {
      chart.innerHTML = '<p class="text-gray-500 text-sm text-center py-8">No cost data yet</p>';
      document.getElementById('total-cost').textContent = '';
      return;
    }

    const total = costs.reduce((s, c) => s + c.total_cost, 0);
    document.getElementById('total-cost').textContent = 'Total: $' + total.toFixed(4);

    const maxCost = Math.max(...costs.map(c => c.total_cost));

    chart.innerHTML =
      '<div class="flex items-end gap-1 h-48">' +
        costs.map(c => {
          const pct = maxCost > 0 ? (c.total_cost / maxCost * 100) : 0;
          const day = c.day.slice(5); // MM-DD
          return '<div class="flex-1 flex flex-col items-center gap-1">' +
            '<span class="text-xs text-gray-500 font-mono">$' + c.total_cost.toFixed(3) + '</span>' +
            '<div class="w-full cost-bar" style="height:' + Math.max(pct, 2) + '%" title="' + c.day + ': $' + c.total_cost.toFixed(4) + ' (' + c.message_count + ' msgs)"></div>' +
            '<span class="text-xs text-gray-600 font-mono">' + day + '</span>' +
          '</div>';
        }).join('') +
      '</div>';
  }

  // HTML escaping
  function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // Init
  showPanel('tabs');
  loadStatus();
  loadTabs();
  setInterval(loadStatus, 5000);
</script>
</body>
</html>`;
}
