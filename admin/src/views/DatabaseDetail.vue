<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import AppLayout from "../components/layout/AppLayout.vue";
import GithubBadge from "../components/ui/GithubBadge.vue";
import Drawer from "../components/ui/Drawer.vue";
import { useSidebar } from "../composables/useSidebar";

const router = useRouter();
const { toggleSidebar } = useSidebar();

const activeTab = ref("data");
const showAddRecordDrawer = ref(false);
const selectedTable = ref("crawler_sources");

const tables = [
  { name: "crawler_sources", count: 40, active: true },
  { name: "jobs", count: 1248, active: false },
  { name: "users", count: 89, active: false },
];

const columns = [
  { key: "id", label: "id", type: "integer", sortable: true },
  { key: "name", label: "name", type: "text", sortable: true },
  { key: "url", label: "url", type: "text", sortable: true },
  { key: "job_selector", label: "job_selector", type: "text", sortable: true },
  { key: "title_selector", label: "title_selector", type: "text", sortable: true },
  { key: "link_selector", label: "link_selector", type: "text", sortable: true },
];

const rows = [
  { id: 1, name: "TDCX", url: "https://www.tdcx.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 2, name: "Concentrix", url: "https://jobs.concentrix.com", job_selector: "script#jobsData", title_selector: null, link_selector: null },
  { id: 3, name: "Teleperformance", url: "https://www.tp.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 4, name: "Sutherland", url: "https://www.jobs.sutherland.com", job_selector: null, title_selector: null, link_selector: null },
  { id: 5, name: "Foundever", url: "https://jobs.foundever.com", job_selector: "tr.data-row", title_selector: "a.jobTitle-link", link_selector: "a.jobTitle-link" },
  { id: 6, name: "TaskUs", url: "https://jobs.taskus.com", job_selector: null, title_selector: null, link_selector: null },
  { id: 7, name: "Accenture", url: "https://www.accenture.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 8, name: "Alorica", url: "https://jobs.alorica.com", job_selector: null, title_selector: null, link_selector: null },
  { id: 9, name: "Webhelp", url: "https://jobs.webhelp.com", job_selector: null, title_selector: null, link_selector: null },
  { id: 10, name: "Genpact", url: "https://www.genpact.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 11, name: "IBM Services", url: "https://www.ibm.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 12, name: "WNS Global", url: "https://www.wns.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 13, name: "Firstsource", url: "https://www.firstsource.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 14, name: "Hinduja Global", url: "https://www.hgs.cx/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 15, name: "Transcom", url: "https://www.transcom.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 16, name: "VXI Global", url: "https://www.vxiglobal.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 17, name: "24-7 Intouch", url: "https://www.24-7intouch.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 18, name: "Qualfon", url: "https://www.qualfon.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 19, name: "Startek", url: "https://www.startek.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 20, name: "Sitel Group", url: "https://www.sitel.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 21, name: "Arvato", url: "https://www.arvato.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 22, name: "EXL Service", url: "https://www.exlservice.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 23, name: "Infosys BPM", url: "https://www.infosys.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 24, name: "Wipro BPO", url: "https://careers.wipro.com", job_selector: null, title_selector: null, link_selector: null },
  { id: 25, name: "Tech Mahindra", url: "https://www.techmahindra.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 26, name: "Cognizant", url: "https://www.cognizant.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 27, name: "Capita", url: "https://www.capita.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 28, name: "CGI Group", url: "https://www.cgi.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 29, name: "Atento", url: "https://www.atento.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 30, name: "Comdata", url: "https://www.comdata.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 31, name: "Minacs", url: "https://www.minacs.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 32, name: "Iberia Inf", url: "https://www.iberia.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 33, name: "Stream Global", url: "https://www.stream.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 34, name: "Amdocs", url: "https://www.amdocs.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 35, name: "Epam Systems", url: "https://www.epam.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 36, name: "Majorel", url: "https://www.majorel.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 37, name: "Salesforce", url: "https://www.salesforce.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 38, name: "SAP", url: "https://www.sap.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 39, name: "Oracle", url: "https://www.oracle.com/careers", job_selector: null, title_selector: null, link_selector: null },
  { id: 40, name: "Microsoft", url: "https://www.microsoft.com/careers", job_selector: null, title_selector: null, link_selector: null },
];

const tabs = [
  { id: "data", label: "Data", icon: "M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" },
  { id: "sql", label: "SQL Console", icon: "M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { id: "schema", label: "Schema", icon: "M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" },
  { id: "queries", label: "Top Queries", icon: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" },
  { id: "settings", label: "Settings", icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065zM15 12a3 3 0 11-6 0 3 3 0 016 0z" },
];

const topQueries = [
  { query: "SELECT * FROM crawler_sources WHERE status = 'active'", count: 12453 },
  { query: "INSERT INTO jobs (title, url, company) VALUES (?, ?, ?)", count: 8921 },
  { query: "UPDATE crawler_sources SET last_crawled = ? WHERE id = ?", count: 6543 },
  { query: "DELETE FROM jobs WHERE posted_at < ?", count: 2341 },
  { query: "SELECT COUNT(*) FROM jobs WHERE status = 'open'", count: 1876 },
];

const schemaInfo = [
  { table: "crawler_sources", columns: [
    { name: "id", type: "integer" },
    { name: "name", type: "text" },
    { name: "url", type: "text" },
    { name: "job_selector", type: "text" },
    { name: "title_selector", type: "text" },
    { name: "link_selector", type: "text" },
    { name: "created_at", type: "datetime" },
  ]},
  { table: "jobs", columns: [
    { name: "id", type: "integer" },
    { name: "title", type: "text" },
    { name: "url", type: "text" },
    { name: "company", type: "text" },
    { name: "status", type: "text" },
    { name: "posted_at", type: "datetime" },
  ]},
  { table: "users", columns: [
    { name: "id", type: "integer" },
    { name: "email", type: "text" },
    { name: "role", type: "text" },
    { name: "created_at", type: "datetime" },
  ]},
];
</script>

<template>
  <AppLayout>
    <header class="h-14 border-b border-border-default flex items-center justify-between px-4 sm:px-6 bg-bolt-base/80 backdrop-blur-sm sticky top-0 z-30">
      <div class="flex items-center gap-2 text-sm">
        <button class="md:hidden p-1 text-text-muted hover:text-text-primary transition-colors" @click="toggleSidebar">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
          </svg>
        </button>
        <a href="/databases" class="text-text-muted hover:text-text-primary transition-colors">Databases</a>
        <span class="text-text-muted">/</span>
        <span class="text-text-primary">callcenterninja</span>
        <span class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-green-500/10 text-green-400 border border-green-500/20">Active</span>
      </div>
      <div class="flex items-center gap-3">
        <span class="text-xs text-text-muted hidden sm:inline">14.79 MB \u00b7 528M rows read \u00b7 9.8K rows written</span>
      </div>
    </header>

    <div class="p-4 sm:p-6 max-w-6xl mx-auto">
      <!-- Tabs -->
      <div class="border-b border-border-default mb-6 flex items-center justify-between">
        <div>
          <a
            v-for="tab in tabs"
            :key="tab.id"
            href="#"
            class="nav-tab"
            :class="{ active: activeTab === tab.id }"
            @click.prevent="activeTab = tab.id"
          >
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="tab.icon"/>
            </svg>
            {{ tab.label }}
          </a>
        </div>
        <div class="flex items-center gap-2 text-[10px] text-text-muted pb-1">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4"/>
          </svg>
          SQLite 3.42.0 \u00b7 17ms
        </div>
      </div>

      <!-- Data Panel -->
      <div v-show="activeTab === 'data'" class="flex flex-col md:flex-row gap-4">
        <!-- Table List -->
        <div class="w-56 shrink-0">
          <div class="flex items-center gap-2 mb-3">
            <input type="text" class="input-field text-xs py-2" placeholder="Search tables..." style="font-family:Inter" />
          </div>
          <div class="space-y-0.5">
            <div
              v-for="table in tables"
              :key="table.name"
              class="flex items-center gap-2 px-2 py-1.5 rounded text-xs cursor-pointer transition-colors"
              :class="table.name === selectedTable ? 'text-text-primary bg-bolt-hover' : 'text-text-secondary hover:bg-bolt-hover'"
              @click="selectedTable = table.name"
            >
              <svg class="w-3.5 h-3.5 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
              </svg>
              {{ table.name }}
              <span class="ml-auto text-[10px] text-text-muted">{{ table.count.toLocaleString() }}</span>
            </div>
          </div>
        </div>

        <!-- Data Viewer -->
        <div class="flex-1 min-w-0">
          <!-- Toolbar -->
          <div class="flex items-center gap-2 mb-3 flex-wrap">
            <div class="flex-1"></div>
            <div class="flex items-center gap-1">
              <button class="btn-ghost btn-sm flex items-center gap-1">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 21h7a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v11m0 5l4.879-4.879m0 0a3 3 0 104.243-4.242 3 3 0 00-4.243 4.242z"/>
                </svg>
                Filters
              </button>
              <button class="btn-ghost btn-sm flex items-center gap-1">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/>
                </svg>
                Sort
              </button>
              <button class="btn-ghost btn-sm flex items-center gap-1">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 12h16M4 18h16"/>
                </svg>
                Columns
              </button>
              <button class="btn-primary btn-sm flex items-center gap-1" @click="showAddRecordDrawer = true">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                </svg>
                Add Record
              </button>
            </div>
          </div>

          <!-- Data Table -->
          <div class="border border-border-default rounded-lg overflow-hidden bg-bolt-card mb-4">
            <div class="overflow-x-auto table-scrollable">
              <table class="data-table">
                <thead>
                  <tr>
                    <th class="w-8">
                      <input type="checkbox" class="w-3.5 h-3.5 rounded border-border-default bg-bolt-input accent-accent-600" />
                    </th>
                    <th
                      v-for="col in columns"
                      :key="col.key"
                      class="sortable"
                    >
                      {{ col.label }}
                      <span class="schema-col">{{ col.type }}</span>
                      <svg class="sort-icon w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
                      </svg>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in rows" :key="row.id">
                    <td>
                      <input type="checkbox" class="row-check w-3.5 h-3.5 rounded border-border-default bg-bolt-input accent-accent-600" />
                    </td>
                    <td class="font-mono text-xs">{{ row.id }}</td>
                    <td>{{ row.name }}</td>
                    <td>{{ row.url }}</td>
                    <td>
                      <span v-if="row.job_selector === null" class="text-text-muted italic">null</span>
                      <span v-else>{{ row.job_selector }}</span>
                    </td>
                    <td>
                      <span v-if="row.title_selector === null" class="text-text-muted italic">null</span>
                      <span v-else>{{ row.title_selector }}</span>
                    </td>
                    <td>
                      <span v-if="row.link_selector === null" class="text-text-muted italic">null</span>
                      <span v-else>{{ row.link_selector }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div class="flex items-center justify-between px-4 py-2 border-t border-border-default bg-bolt-elevated/50">
              <div class="flex items-center gap-2 text-xs text-text-muted">
                1 \u2013 40 of 40
              </div>
              <div class="flex items-center gap-2">
                <button class="btn-ghost btn-sm flex items-center gap-1">
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                  </svg>
                </button>
                <button class="btn-secondary btn-sm opacity-50 cursor-not-allowed">Previous</button>
                <button class="btn-secondary btn-sm opacity-50 cursor-not-allowed">Next</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- SQL Console Panel -->
      <div v-show="activeTab === 'sql'" class="space-y-4">
        <div class="bg-bolt-card border border-border-default rounded-lg p-4">
          <textarea
            class="w-full h-32 bg-bolt-elevated border border-border-default rounded-lg p-3 text-sm text-text-primary font-mono resize-none focus:outline-none focus:border-accent-600"
            placeholder="-- Enter your SQL query here\nSELECT * FROM crawler_sources WHERE status = 'active';"
          ></textarea>
          <div class="flex items-center justify-end mt-3">
            <button class="btn-primary flex items-center gap-1.5">
              <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z"/>
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
              </svg>
              Run Query
            </button>
          </div>
        </div>
        <div class="bg-bolt-card border border-border-default rounded-lg p-4">
          <div class="text-sm text-text-muted mb-2">Results</div>
          <div class="text-xs text-text-muted">Run a query to see results here.</div>
        </div>
      </div>

      <!-- Schema Panel -->
      <div v-show="activeTab === 'schema'" class="space-y-4">
        <div
          v-for="schema in schemaInfo"
          :key="schema.table"
          class="bg-bolt-card border border-border-default rounded-lg p-4"
        >
          <div class="flex items-center gap-2 mb-3">
            <svg class="w-4 h-4 text-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M3 14h18m-9-4v8m-7 0h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>
            </svg>
            <span class="text-sm font-medium text-text-primary">{{ schema.table }}</span>
          </div>
          <div class="overflow-x-auto">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Type</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="col in schema.columns" :key="col.name">
                  <td class="text-text-primary">{{ col.name }}</td>
                  <td>
                    <span class="schema-col">{{ col.type }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Top Queries Panel -->
      <div v-show="activeTab === 'queries'" class="space-y-4">
        <div class="bg-bolt-card border border-border-default rounded-lg overflow-hidden">
          <div class="px-5 py-4 border-b border-border-default">
            <div class="text-sm font-medium text-text-primary">Top Queries</div>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-border-default">
                  <th class="text-left px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Query</th>
                  <th class="text-right px-5 py-3 text-xs font-medium text-text-muted uppercase tracking-wider bg-bolt-elevated">Executions</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="q in topQueries"
                  :key="q.query"
                  class="border-b border-border-subtle hover:bg-bolt-hover transition-colors"
                >
                  <td class="px-5 py-3 text-text-secondary font-mono text-xs">{{ q.query }}</td>
                  <td class="px-5 py-3 text-right text-text-secondary">{{ q.count.toLocaleString() }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- Settings Panel -->
      <div v-show="activeTab === 'settings'" class="max-w-2xl">
        <div class="bg-bolt-card border border-border-default rounded-lg p-5 space-y-4">
          <div>
            <label class="form-group label">Database Name</label>
            <input type="text" class="input-field" value="callcenterninja" />
          </div>
          <div>
            <label class="form-group label">Group</label>
            <select class="input-field appearance-none" style="font-family:Inter">
              <option>default</option>
              <option>production</option>
              <option>staging</option>
            </select>
          </div>
          <div>
            <label class="form-group label">Region</label>
            <select class="input-field appearance-none" style="font-family:Inter">
              <option>Auto (closest)</option>
              <option>US East (N. Virginia)</option>
              <option>EU West (Ireland)</option>
              <option>Asia Pacific (Tokyo)</option>
            </select>
          </div>
        </div>

        <div class="bg-bolt-card border border-red-500/75 rounded-lg p-5 mt-6">
          <h3 class="text-sm font-medium text-red-400 mb-4">Danger Zone</h3>
          <div class="flex items-center justify-between p-3 border border-red-500/20 rounded-md bg-red-500/5">
            <div>
              <div class="text-xs font-medium text-red-400">Delete Database</div>
              <div class="form-group hint">This will permanently delete all tables and data. This action cannot be undone.</div>
            </div>
            <button class="btn-danger btn-sm">Delete</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Add Record Drawer -->
    <Drawer :show="showAddRecordDrawer" @close="showAddRecordDrawer = false">
      <template #header>
        <div class="text-sm font-medium text-text-primary">Add Record</div>
      </template>
      <div class="space-y-4">
        <div v-for="col in columns" :key="col.key" class="form-group">
          <label>{{ col.label }}</label>
          <input type="text" class="input-field" :placeholder="col.type" />
        </div>
        <div class="flex items-center justify-end gap-3 pt-4 border-t border-border-default">
          <button class="btn-secondary" @click="showAddRecordDrawer = false">Cancel</button>
          <button class="btn-primary">Save</button>
        </div>
      </div>
    </Drawer>

    <GithubBadge />
  </AppLayout>
</template>
