export function getDashboardHtml(token: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Beecork Dashboard</title>
  <style>
    /* Compiled Tailwind CSS (v4.2.2) — generated via: npx tailwindcss --content src/dashboard/html.ts --minify */
    /*! tailwindcss v4.2.2 | MIT License | https://tailwindcss.com */@layer properties{@supports (((-webkit-hyphens:none)) and (not (margin-trim:inline))) or ((-moz-orient:inline) and (not (color:rgb(from red r g b)))){*,:before,:after,::backdrop{--tw-rotate-x:initial;--tw-rotate-y:initial;--tw-rotate-z:initial;--tw-skew-x:initial;--tw-skew-y:initial;--tw-space-y-reverse:0;--tw-border-style:solid;--tw-leading:initial;--tw-font-weight:initial;--tw-tracking:initial;--tw-outline-style:solid;--tw-blur:initial;--tw-brightness:initial;--tw-contrast:initial;--tw-grayscale:initial;--tw-hue-rotate:initial;--tw-invert:initial;--tw-opacity:initial;--tw-saturate:initial;--tw-sepia:initial;--tw-drop-shadow:initial;--tw-drop-shadow-color:initial;--tw-drop-shadow-alpha:100%;--tw-drop-shadow-size:initial}}}@layer theme{:root,:host{--font-sans:ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";--font-mono:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;--color-red-200:oklch(88.5% .062 18.334);--color-red-400:oklch(70.4% .191 22.216);--color-red-900:oklch(39.6% .141 25.723);--color-green-200:oklch(92.5% .084 155.995);--color-green-400:oklch(79.2% .209 151.711);--color-green-900:oklch(39.3% .095 152.535);--color-blue-400:oklch(70.7% .165 254.624);--color-blue-900:oklch(37.9% .146 265.522);--color-purple-400:oklch(71.4% .203 305.504);--color-purple-900:oklch(38.1% .176 304.987);--color-gray-200:oklch(92.8% .006 264.531);--color-gray-300:oklch(87.2% .01 258.338);--color-gray-400:oklch(70.7% .022 261.325);--color-gray-500:oklch(55.1% .027 264.364);--color-gray-600:oklch(44.6% .03 256.802);--color-gray-700:oklch(37.3% .034 259.733);--color-black:#000;--color-white:#fff;--spacing:.25rem;--container-lg:32rem;--text-xs:.75rem;--text-xs--line-height:calc(1 / .75);--text-sm:.875rem;--text-sm--line-height:calc(1.25 / .875);--text-base:1rem;--text-base--line-height:calc(1.5 / 1);--text-xl:1.25rem;--text-xl--line-height:calc(1.75 / 1.25);--font-weight-medium:500;--font-weight-semibold:600;--tracking-wider:.05em;--leading-relaxed:1.625;--radius-lg:.5rem;--default-transition-duration:.15s;--default-transition-timing-function:cubic-bezier(.4, 0, .2, 1);--default-font-family:var(--font-sans);--default-mono-font-family:var(--font-mono);--color-honey-400:#facc15;--color-honey-500:#eab308;--color-honey-600:#ca8a04;--color-bee-900:#111;--color-bee-850:#181818;--color-bee-800:#1e1e1e;--color-bee-750:#252525;--color-bee-700:#2e2e2e}}@layer base{*,:after,:before,::backdrop{box-sizing:border-box;border:0 solid;margin:0;padding:0}::file-selector-button{box-sizing:border-box;border:0 solid;margin:0;padding:0}html,:host{-webkit-text-size-adjust:100%;tab-size:4;line-height:1.5;font-family:var(--default-font-family,ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji");font-feature-settings:var(--default-font-feature-settings,normal);font-variation-settings:var(--default-font-variation-settings,normal);-webkit-tap-highlight-color:transparent}hr{height:0;color:inherit;border-top-width:1px}abbr:where([title]){-webkit-text-decoration:underline dotted;text-decoration:underline dotted}h1,h2,h3,h4,h5,h6{font-size:inherit;font-weight:inherit}a{color:inherit;-webkit-text-decoration:inherit;text-decoration:inherit}b,strong{font-weight:bolder}code,kbd,samp,pre{font-family:var(--default-mono-font-family,ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace);font-feature-settings:var(--default-mono-font-feature-settings,normal);font-variation-settings:var(--default-mono-font-variation-settings,normal);font-size:1em}small{font-size:80%}sub,sup{vertical-align:baseline;font-size:75%;line-height:0;position:relative}sub{bottom:-.25em}sup{top:-.5em}table{text-indent:0;border-color:inherit;border-collapse:collapse}:-moz-focusring{outline:auto}progress{vertical-align:baseline}summary{display:list-item}ol,ul,menu{list-style:none}img,svg,video,canvas,audio,iframe,embed,object{vertical-align:middle;display:block}img,video{max-width:100%;height:auto}button,input,select,optgroup,textarea{font:inherit;font-feature-settings:inherit;font-variation-settings:inherit;letter-spacing:inherit;color:inherit;opacity:1;background-color:#0000;border-radius:0}::file-selector-button{font:inherit;font-feature-settings:inherit;font-variation-settings:inherit;letter-spacing:inherit;color:inherit;opacity:1;background-color:#0000;border-radius:0}:where(select:is([multiple],[size])) optgroup{font-weight:bolder}:where(select:is([multiple],[size])) optgroup option{padding-inline-start:20px}::file-selector-button{margin-inline-end:4px}::placeholder{opacity:1}@supports (not ((-webkit-appearance:-apple-pay-button))) or (contain-intrinsic-size:1px){::placeholder{color:currentColor}@supports (color:color-mix(in lab, red, red)){::placeholder{color:color-mix(in oklab, currentcolor 50%, transparent)}}}textarea{resize:vertical}::-webkit-search-decoration{-webkit-appearance:none}::-webkit-date-and-time-value{min-height:1lh;text-align:inherit}::-webkit-datetime-edit{display:inline-flex}::-webkit-datetime-edit-fields-wrapper{padding:0}::-webkit-datetime-edit{padding-block:0}::-webkit-datetime-edit-year-field{padding-block:0}::-webkit-datetime-edit-month-field{padding-block:0}::-webkit-datetime-edit-day-field{padding-block:0}::-webkit-datetime-edit-hour-field{padding-block:0}::-webkit-datetime-edit-minute-field{padding-block:0}::-webkit-datetime-edit-second-field{padding-block:0}::-webkit-datetime-edit-millisecond-field{padding-block:0}::-webkit-datetime-edit-meridiem-field{padding-block:0}::-webkit-calendar-picker-indicator{line-height:1}:-moz-ui-invalid{box-shadow:none}button,input:where([type=button],[type=reset],[type=submit]){appearance:button}::file-selector-button{appearance:button}::-webkit-inner-spin-button{height:auto}::-webkit-outer-spin-button{height:auto}[hidden]:where(:not([hidden=until-found])){display:none!important}}@layer components;@layer utilities{.absolute{position:absolute}.fixed{position:fixed}.relative{position:relative}.start{inset-inline-start:var(--spacing)}.end{inset-inline-end:var(--spacing)}.right-4{right:calc(var(--spacing) * 4)}.bottom-4{bottom:calc(var(--spacing) * 4)}.z-50{z-index:50}.container{width:100%}@media (min-width:40rem){.container{max-width:40rem}}@media (min-width:48rem){.container{max-width:48rem}}@media (min-width:64rem){.container{max-width:64rem}}@media (min-width:80rem){.container{max-width:80rem}}@media (min-width:96rem){.container{max-width:96rem}}.mt-0\.5{margin-top:calc(var(--spacing) * .5)}.mt-1{margin-top:calc(var(--spacing) * 1)}.mt-5{margin-top:calc(var(--spacing) * 5)}.mb-1{margin-bottom:calc(var(--spacing) * 1)}.mb-4{margin-bottom:calc(var(--spacing) * 4)}.ml-2{margin-left:calc(var(--spacing) * 2)}.block{display:block}.contents{display:contents}.flex{display:flex}.grid{display:grid}.hidden{display:none}.table{display:table}.h-20{height:calc(var(--spacing) * 20)}.h-24{height:calc(var(--spacing) * 24)}.h-48{height:calc(var(--spacing) * 48)}.h-\[var\(--header-height\)\]{height:var(--header-height)}.h-full{height:100%}.max-h-48{max-height:calc(var(--spacing) * 48)}.max-h-\[calc\(100vh-240px\)\]{max-height:calc(100vh - 240px)}.w-full{width:100%}.max-w-lg{max-width:var(--container-lg)}.min-w-0{min-width:calc(var(--spacing) * 0)}.flex-1{flex:1}.shrink-0{flex-shrink:0}.grow{flex-grow:1}.transform{transform:var(--tw-rotate-x,) var(--tw-rotate-y,) var(--tw-rotate-z,) var(--tw-skew-x,) var(--tw-skew-y,)}.cursor-pointer{cursor:pointer}.resize-none{resize:none}.grid-cols-2{grid-template-columns:repeat(2,minmax(0,1fr))}.flex-col{flex-direction:column}.items-center{align-items:center}.items-end{align-items:flex-end}.items-start{align-items:flex-start}.justify-between{justify-content:space-between}.justify-end{justify-content:flex-end}.gap-1{gap:calc(var(--spacing) * 1)}.gap-2{gap:calc(var(--spacing) * 2)}.gap-3{gap:calc(var(--spacing) * 3)}.gap-4{gap:calc(var(--spacing) * 4)}:where(.space-y-3>:not(:last-child)){--tw-space-y-reverse:0;margin-block-start:calc(calc(var(--spacing) * 3) * var(--tw-space-y-reverse));margin-block-end:calc(calc(var(--spacing) * 3) * calc(1 - var(--tw-space-y-reverse)))}.truncate{text-overflow:ellipsis;white-space:nowrap;overflow:hidden}.overflow-hidden{overflow:hidden}.overflow-y-auto{overflow-y:auto}.rounded{border-radius:.25rem}.rounded-lg{border-radius:var(--radius-lg)}.border{border-style:var(--tw-border-style);border-width:1px}.border-t{border-top-style:var(--tw-border-style);border-top-width:1px}.border-r{border-right-style:var(--tw-border-style);border-right-width:1px}.border-b{border-bottom-style:var(--tw-border-style);border-bottom-width:1px}.border-b-2{border-bottom-style:var(--tw-border-style);border-bottom-width:2px}.border-bee-700{border-color:var(--color-bee-700)}.border-honey-500{border-color:var(--color-honey-500)}.border-transparent{border-color:#0000}.bg-bee-800{background-color:var(--color-bee-800)}.bg-bee-850{background-color:var(--color-bee-850)}.bg-bee-900{background-color:var(--color-bee-900)}.bg-blue-900\/50{background-color:#1c398e80}@supports (color:color-mix(in lab, red, red)){.bg-blue-900\/50{background-color:color-mix(in oklab, var(--color-blue-900) 50%, transparent)}}.bg-green-900\/90{background-color:#0d542be6}@supports (color:color-mix(in lab, red, red)){.bg-green-900\/90{background-color:color-mix(in oklab, var(--color-green-900) 90%, transparent)}}.bg-honey-600{background-color:var(--color-honey-600)}.bg-purple-900\/50{background-color:#59168b80}@supports (color:color-mix(in lab, red, red)){.bg-purple-900\/50{background-color:color-mix(in oklab, var(--color-purple-900) 50%, transparent)}}.bg-red-900\/90{background-color:#82181ae6}@supports (color:color-mix(in lab, red, red)){.bg-red-900\/90{background-color:color-mix(in oklab, var(--color-red-900) 90%, transparent)}}.p-3{padding:calc(var(--spacing) * 3)}.p-4{padding:calc(var(--spacing) * 4)}.p-6{padding:calc(var(--spacing) * 6)}.px-1\.5{padding-inline:calc(var(--spacing) * 1.5)}.px-2{padding-inline:calc(var(--spacing) * 2)}.px-3{padding-inline:calc(var(--spacing) * 3)}.px-4{padding-inline:calc(var(--spacing) * 4)}.py-0\.5{padding-block:calc(var(--spacing) * .5)}.py-1{padding-block:calc(var(--spacing) * 1)}.py-1\.5{padding-block:calc(var(--spacing) * 1.5)}.py-2{padding-block:calc(var(--spacing) * 2)}.py-2\.5{padding-block:calc(var(--spacing) * 2.5)}.py-3{padding-block:calc(var(--spacing) * 3)}.py-8{padding-block:calc(var(--spacing) * 8)}.py-16{padding-block:calc(var(--spacing) * 16)}.pl-5{padding-left:calc(var(--spacing) * 5)}.text-center{text-align:center}.font-mono{font-family:var(--font-mono)}.font-sans{font-family:var(--font-sans)}.text-base{font-size:var(--text-base);line-height:var(--tw-leading,var(--text-base--line-height))}.text-sm{font-size:var(--text-sm);line-height:var(--tw-leading,var(--text-sm--line-height))}.text-xl{font-size:var(--text-xl);line-height:var(--tw-leading,var(--text-xl--line-height))}.text-xs{font-size:var(--text-xs);line-height:var(--tw-leading,var(--text-xs--line-height))}.leading-relaxed{--tw-leading:var(--leading-relaxed);line-height:var(--leading-relaxed)}.font-medium{--tw-font-weight:var(--font-weight-medium);font-weight:var(--font-weight-medium)}.font-semibold{--tw-font-weight:var(--font-weight-semibold);font-weight:var(--font-weight-semibold)}.tracking-wider{--tw-tracking:var(--tracking-wider);letter-spacing:var(--tracking-wider)}.break-words{overflow-wrap:break-word}.whitespace-nowrap{white-space:nowrap}.whitespace-pre-wrap{white-space:pre-wrap}.text-black{color:var(--color-black)}.text-blue-400{color:var(--color-blue-400)}.text-gray-200{color:var(--color-gray-200)}.text-gray-300{color:var(--color-gray-300)}.text-gray-400{color:var(--color-gray-400)}.text-gray-500{color:var(--color-gray-500)}.text-gray-600{color:var(--color-gray-600)}.text-gray-700{color:var(--color-gray-700)}.text-green-200{color:var(--color-green-200)}.text-green-400{color:var(--color-green-400)}.text-honey-400{color:var(--color-honey-400)}.text-purple-400{color:var(--color-purple-400)}.text-red-200{color:var(--color-red-200)}.text-red-400{color:var(--color-red-400)}.text-white{color:var(--color-white)}.uppercase{text-transform:uppercase}.opacity-0{opacity:0}.outline{outline-style:var(--tw-outline-style);outline-width:1px}.filter{filter:var(--tw-blur,) var(--tw-brightness,) var(--tw-contrast,) var(--tw-grayscale,) var(--tw-hue-rotate,) var(--tw-invert,) var(--tw-saturate,) var(--tw-sepia,) var(--tw-drop-shadow,)}.transition{transition-property:color,background-color,border-color,outline-color,text-decoration-color,fill,stroke,--tw-gradient-from,--tw-gradient-via,--tw-gradient-to,opacity,box-shadow,transform,translate,scale,rotate,filter,-webkit-backdrop-filter,backdrop-filter,display,content-visibility,overlay,pointer-events;transition-timing-function:var(--tw-ease,var(--default-transition-timing-function));transition-duration:var(--tw-duration,var(--default-transition-duration))}@media (hover:hover){.group-hover\:opacity-100:is(:where(.group):hover *){opacity:1}.hover\:bg-bee-750:hover{background-color:var(--color-bee-750)}.hover\:bg-honey-500:hover{background-color:var(--color-honey-500)}.hover\:text-white:hover{color:var(--color-white)}}@media (min-width:40rem){.sm\:block{display:block}.sm\:w-48{width:calc(var(--spacing) * 48)}.sm\:w-auto{width:auto}.sm\:flex-row{flex-direction:row}.sm\:items-center{align-items:center}}}@property --tw-rotate-x{syntax:"*";inherits:false}@property --tw-rotate-y{syntax:"*";inherits:false}@property --tw-rotate-z{syntax:"*";inherits:false}@property --tw-skew-x{syntax:"*";inherits:false}@property --tw-skew-y{syntax:"*";inherits:false}@property --tw-space-y-reverse{syntax:"*";inherits:false;initial-value:0}@property --tw-border-style{syntax:"*";inherits:false;initial-value:solid}@property --tw-leading{syntax:"*";inherits:false}@property --tw-font-weight{syntax:"*";inherits:false}@property --tw-tracking{syntax:"*";inherits:false}@property --tw-outline-style{syntax:"*";inherits:false;initial-value:solid}@property --tw-blur{syntax:"*";inherits:false}@property --tw-brightness{syntax:"*";inherits:false}@property --tw-contrast{syntax:"*";inherits:false}@property --tw-grayscale{syntax:"*";inherits:false}@property --tw-hue-rotate{syntax:"*";inherits:false}@property --tw-invert{syntax:"*";inherits:false}@property --tw-opacity{syntax:"*";inherits:false}@property --tw-saturate{syntax:"*";inherits:false}@property --tw-sepia{syntax:"*";inherits:false}@property --tw-drop-shadow{syntax:"*";inherits:false}@property --tw-drop-shadow-color{syntax:"*";inherits:false}@property --tw-drop-shadow-alpha{syntax:"<percentage>";inherits:false;initial-value:100%}@property --tw-drop-shadow-size{syntax:"*";inherits:false}

    :root {
      --sidebar-width: 280px;
      --header-height: 52px;
      --input-height: 64px;
    }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 0; overflow: hidden; }
    .msg-user { background: #252525; border-left: 3px solid #facc15; }
    .msg-assistant { background: #1a1a1a; border-left: 3px solid #555; }
    .tab-item { transition: background 0.15s; }
    .tab-item:hover { background: #2e2e2e; }
    .tab-item.active { background: rgba(250,204,21,0.08); border-left: 3px solid #facc15; }
    .tab-item:not(.active) { border-left: 3px solid transparent; }
    .cost-bar { background: linear-gradient(to top, #facc15, #eab308); border-radius: 2px 2px 0 0; }
    .panel-card { background: #1e1e1e; border: 1px solid #2e2e2e; border-radius: 8px; }
    .btn-primary { background: #eab308; color: #111; font-weight: 600; border: none; border-radius: 6px; cursor: pointer; transition: background 0.15s; }
    .btn-primary:hover { background: #facc15; }
    .btn-danger { background: #7f1d1d; color: #fca5a5; font-weight: 500; border: none; border-radius: 6px; cursor: pointer; transition: background 0.15s; }
    .btn-danger:hover { background: #991b1b; }
    .btn-ghost { background: transparent; color: #9ca3af; border: 1px solid #3a3a3a; border-radius: 6px; cursor: pointer; transition: all 0.15s; }
    .btn-ghost:hover { background: #2e2e2e; color: #e5e7eb; }
    .input-field { background: #111; border: 1px solid #3a3a3a; border-radius: 6px; color: #e5e7eb; outline: none; transition: border-color 0.15s; }
    .input-field:focus { border-color: #eab308; }
    .input-field::placeholder { color: #555; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
    .status-running { background: #22c55e; box-shadow: 0 0 6px rgba(34,197,94,0.4); }
    .status-idle { background: #6b7280; }
    .status-error { background: #ef4444; }
    .status-stopped { background: #4b5563; }
    .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 50; display: flex; align-items: center; justify-content: center; }
    .modal-content { background: #1e1e1e; border: 1px solid #3a3a3a; border-radius: 12px; padding: 24px; min-width: 400px; max-width: 500px; }
    .sse-indicator { width: 6px; height: 6px; border-radius: 50%; }
    .sse-connected { background: #22c55e; animation: pulse-green 2s infinite; }
    .sse-disconnected { background: #ef4444; }
    @keyframes pulse-green { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
    ::-webkit-scrollbar { width: 6px; }
    ::-webkit-scrollbar-track { background: #111; }
    ::-webkit-scrollbar-thumb { background: #3a3a3a; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: #555; }

    @media (max-width: 768px) {
      :root { --sidebar-width: 100%; }
      .layout { flex-direction: column; }
      .sidebar { width: 100% !important; max-height: 40vh; border-right: none !important; border-bottom: 1px solid #2e2e2e; }
      .main-area { width: 100% !important; }
    }
  </style>
</head>
<body class="bg-bee-900 text-gray-200">

  <!-- Header -->
  <header class="h-[var(--header-height)] bg-bee-800 border-b border-bee-700 px-4 flex items-center justify-between shrink-0" style="height:var(--header-height)">
    <div class="flex items-center gap-3">
      <span class="text-xl">&#x1F41D;</span>
      <h1 class="text-base font-semibold text-white">Beecork</h1>
      <span id="version" class="text-xs text-gray-500 font-mono"></span>
    </div>
    <div class="flex items-center gap-4">
      <div class="flex items-center gap-2">
        <span id="sse-dot" class="sse-indicator sse-disconnected"></span>
        <span id="sse-label" class="text-xs text-gray-500">connecting</span>
      </div>
      <div class="flex items-center gap-2">
        <span id="daemon-dot" class="status-dot status-idle"></span>
        <span id="daemon-status" class="text-xs text-gray-400">checking...</span>
      </div>
      <div class="text-xs text-gray-500 font-mono hidden sm:block" id="stats"></div>
    </div>
  </header>

  <!-- Navigation -->
  <nav class="bg-bee-800 border-b border-bee-700 px-4 shrink-0">
    <div class="flex gap-1">
      <button onclick="showPanel('tabs')" data-panel="tabs" class="nav-btn px-4 py-2 text-sm border-b-2 border-honey-500 text-white">Tabs</button>
      <button onclick="showPanel('memories')" data-panel="memories" class="nav-btn px-4 py-2 text-sm border-b-2 border-transparent text-gray-400 hover:text-white">Memories</button>
      <button onclick="showPanel('crons')" data-panel="crons" class="nav-btn px-4 py-2 text-sm border-b-2 border-transparent text-gray-400 hover:text-white">Tasks</button>
      <button onclick="showPanel('watchers')" data-panel="watchers" class="nav-btn px-4 py-2 text-sm border-b-2 border-transparent text-gray-400 hover:text-white">Watchers</button>
      <button onclick="showPanel('costs')" data-panel="costs" class="nav-btn px-4 py-2 text-sm border-b-2 border-transparent text-gray-400 hover:text-white">Costs</button>
      <button onclick="showPanel('update')" data-panel="update" class="nav-btn px-4 py-2 text-sm border-b-2 border-transparent text-gray-400 hover:text-white">Update</button>
    </div>
  </nav>

  <!-- Main content area -->
  <div id="app" style="height: calc(100vh - var(--header-height) - 41px); overflow: hidden;">

    <!-- Tabs Panel -->
    <div id="panel-tabs" class="panel h-full">
      <div class="layout flex h-full">
        <!-- Sidebar: tab list -->
        <div class="sidebar bg-bee-850 border-r border-bee-700 flex flex-col" style="width: var(--sidebar-width); min-width: var(--sidebar-width);">
          <div class="px-3 py-2 border-b border-bee-700 flex items-center justify-between shrink-0">
            <div class="flex items-center gap-2">
              <span class="text-xs font-semibold text-gray-400 uppercase tracking-wider">Tabs</span>
              <span id="tab-count" class="text-xs text-gray-600"></span>
            </div>
            <button onclick="showCreateTabModal()" class="btn-ghost px-2 py-1 text-xs">+ New</button>
          </div>
          <div id="tab-list" class="flex-1 overflow-y-auto"></div>
        </div>
        <!-- Main: messages + input -->
        <div class="main-area flex flex-col flex-1 min-w-0">
          <div class="px-4 py-2 border-b border-bee-700 flex items-center justify-between shrink-0 bg-bee-800">
            <div class="flex items-center gap-2">
              <h2 class="text-sm font-semibold text-gray-300" id="msg-title">Select a tab</h2>
              <span id="msg-tab-status" class="text-xs text-gray-500"></span>
            </div>
            <div class="flex items-center gap-3">
              <span id="msg-count" class="text-xs text-gray-500"></span>
              <button id="btn-delete-tab" class="btn-danger px-2 py-1 text-xs hidden" onclick="deleteSelectedTab()">Delete</button>
            </div>
          </div>
          <div id="msg-list" class="flex-1 overflow-y-auto p-4 space-y-3 bg-bee-900">
            <p class="text-gray-500 text-sm text-center py-16">Select a tab to view messages</p>
          </div>
          <!-- Message input -->
          <div id="msg-input-area" class="hidden shrink-0 border-t border-bee-700 bg-bee-800 p-3">
            <form id="send-form" onsubmit="sendMessage(event)" class="flex gap-2">
              <input id="msg-input" type="text" placeholder="Send a message to this tab..."
                class="input-field flex-1 px-3 py-2 text-sm" autocomplete="off">
              <button type="submit" class="btn-primary px-4 py-2 text-sm">Send</button>
            </form>
          </div>
        </div>
      </div>
    </div>

    <!-- Memories Panel -->
    <div id="panel-memories" class="panel hidden h-full overflow-y-auto p-4">
      <div class="panel-card overflow-hidden">
        <div class="px-4 py-3 border-b border-bee-700 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <h2 class="text-sm font-semibold text-gray-300">Memories</h2>
          <div class="flex items-center gap-3 w-full sm:w-auto">
            <input id="memory-search" type="text" placeholder="Search..."
              class="input-field px-3 py-1.5 text-sm flex-1 sm:w-48" oninput="debounceMemorySearch()">
            <button onclick="showCreateMemoryModal()" class="btn-ghost px-2 py-1 text-xs whitespace-nowrap">+ Add</button>
            <span id="memory-count" class="text-xs text-gray-500 whitespace-nowrap"></span>
          </div>
        </div>
        <div id="memory-list" class="max-h-[calc(100vh-240px)] overflow-y-auto"></div>
      </div>
    </div>

    <!-- Tasks Panel -->
    <div id="panel-crons" class="panel hidden h-full overflow-y-auto p-4">
      <div class="panel-card overflow-hidden">
        <div class="px-4 py-3 border-b border-bee-700 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-gray-300">Tasks</h2>
          <button onclick="showCreateCronModal()" class="btn-ghost px-2 py-1 text-xs">+ Create</button>
        </div>
        <div id="cron-list" class="max-h-[calc(100vh-240px)] overflow-y-auto"></div>
      </div>
    </div>

    <!-- Watchers Panel -->
    <div id="panel-watchers" class="panel hidden h-full overflow-y-auto p-4">
      <div class="panel-card overflow-hidden">
        <div class="px-4 py-3 border-b border-bee-700 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-gray-300">Watchers</h2>
        </div>
        <div id="watcher-list" class="max-h-[calc(100vh-240px)] overflow-y-auto"></div>
      </div>
    </div>

    <!-- Costs Panel -->
    <div id="panel-costs" class="panel hidden h-full overflow-y-auto p-4">
      <div class="panel-card overflow-hidden">
        <div class="px-4 py-3 border-b border-bee-700 flex items-center justify-between">
          <h2 class="text-sm font-semibold text-gray-300">API Costs (Last 30 Days)</h2>
          <span id="total-cost" class="text-sm font-mono text-honey-400"></span>
        </div>
        <div id="cost-chart" class="p-6"></div>
      </div>
    </div>
  </div>

    <!-- Update Panel -->
    <div id="panel-update" class="panel hidden h-full overflow-y-auto p-4">
      <div class="max-w-lg space-y-3">
        <div id="update-packages" class="space-y-3 text-sm text-gray-400">Checking for updates...</div>
        <div id="update-log" class="hidden bg-bee-900 border border-bee-700 rounded p-3 text-xs font-mono text-gray-300 whitespace-pre-wrap max-h-48 overflow-y-auto"></div>
      </div>
    </div>
  </div>

  <!-- Modal container -->
  <div id="modal" class="hidden"></div>

<script>
  const API_TOKEN = ${JSON.stringify(token)};

  // State
  let selectedTab = null;
  let memorySearchTimer = null;
  let tabsData = [];

  // Toast notifications
  function showToast(msg, isError) {
    const toast = document.createElement('div');
    toast.className = 'fixed bottom-4 right-4 px-4 py-2 rounded-lg text-sm z-50 ' + (isError ? 'bg-red-900/90 text-red-200' : 'bg-green-900/90 text-green-200');
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 4000);
  }

  // API helpers
  async function api(path, opts) {
    const headers = { 'Authorization': 'Bearer ' + API_TOKEN };
    if (opts && opts.body) headers['Content-Type'] = 'application/json';
    try {
      const res = await fetch(path, { headers, ...opts });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(err.error || 'Request failed');
      }
      return res.json();
    } catch (err) {
      showToast('API error: ' + err.message, true);
      throw err;
    }
  }

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

  function esc(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  // --- SSE ---
  function connectSSE() {
    const es = new EventSource('/api/events');
    es.onopen = () => {
      document.getElementById('sse-dot').className = 'sse-indicator sse-connected';
      document.getElementById('sse-label').textContent = 'live';
    };
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'update') {
          updateTabStatuses(data.tabs);
        }
      } catch {}
    };
    es.onerror = () => {
      document.getElementById('sse-dot').className = 'sse-indicator sse-disconnected';
      document.getElementById('sse-label').textContent = 'reconnecting';
    };
  }

  function updateTabStatuses(sseTabs) {
    // Update status indicators in the sidebar without full reload
    if (!sseTabs) return;
    sseTabs.forEach(st => {
      const el = document.querySelector('[data-tab-name="' + CSS.escape(st.name) + '"] .tab-status-dot');
      if (el) {
        el.className = 'status-dot tab-status-dot status-' + st.status;
      }
      const label = document.querySelector('[data-tab-name="' + CSS.escape(st.name) + '"] .tab-status-label');
      if (label) {
        label.textContent = st.status;
      }
    });
  }

  // --- Panel switching ---
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
    if (name === 'watchers') loadWatchers();
    if (name === 'costs') loadCosts();
    if (name === 'update') loadUpdateStatus();
  }

  // --- Status ---
  async function loadStatus() {
    try {
      const s = await api('/api/status');
      document.getElementById('version').textContent = 'v' + s.version;
      const dot = document.getElementById('daemon-dot');
      const status = document.getElementById('daemon-status');
      if (s.daemonPid) {
        dot.className = 'status-dot status-running';
        status.textContent = 'PID ' + s.daemonPid;
      } else {
        dot.className = 'status-dot status-error';
        status.textContent = 'stopped';
      }
      document.getElementById('stats').textContent =
        s.tabs + ' tabs | ' + s.cronJobs + ' crons | ' + s.memories + ' mem';
    } catch {}
  }

  // --- Tabs ---
  async function loadTabs() {
    try { tabsData = await api('/api/tabs'); } catch { return; }
    const list = document.getElementById('tab-list');
    document.getElementById('tab-count').textContent = tabsData.length.toString();

    if (tabsData.length === 0) {
      list.innerHTML = '<p class="text-gray-600 text-xs text-center py-8">No tabs yet</p>';
      return;
    }

    list.innerHTML = tabsData.map(t => {
      const isActive = selectedTab === t.name ? ' active' : '';
      const cost = t.total_cost > 0 ? '$' + t.total_cost.toFixed(4) : '';
      return '<div class="tab-item px-3 py-2.5 cursor-pointer' + isActive + '" data-tab-name="' + esc(t.name) + '" role="button" tabindex="0" onclick="selectTab(\\'' + esc(t.name).replace(/'/g, "\\\\'") + '\\')" onkeydown="if(event.key===\\'Enter\\')selectTab(\\'' + esc(t.name).replace(/'/g, "\\\\'") + '\\')">' +
        '<div class="flex items-center justify-between">' +
          '<div class="flex items-center gap-2 min-w-0">' +
            '<span class="status-dot tab-status-dot status-' + esc(t.status) + '"></span>' +
            '<span class="text-sm font-medium text-gray-200 truncate">' + esc(t.name) + '</span>' +
          '</div>' +
          '<span class="text-xs tab-status-label text-gray-500 shrink-0">' + esc(t.status) + '</span>' +
        '</div>' +
        '<div class="flex items-center justify-between mt-0.5 pl-5">' +
          '<span class="text-xs text-gray-600">' + t.message_count + ' msgs' + (cost ? ' &middot; ' + cost : '') + '</span>' +
          '<span class="text-xs text-gray-700">' + timeAgo(t.last_activity_at) + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  async function selectTab(name) {
    selectedTab = name;
    document.getElementById('msg-title').textContent = name;
    document.getElementById('btn-delete-tab').classList.remove('hidden');
    document.getElementById('msg-input-area').classList.remove('hidden');

    // Update active tab highlight
    document.querySelectorAll('.tab-item').forEach(el => {
      el.classList.toggle('active', el.getAttribute('data-tab-name') === name);
    });

    const tab = tabsData.find(t => t.name === name);
    if (tab) {
      document.getElementById('msg-tab-status').textContent = tab.status;
    }

    let data; try { data = await api('/api/tabs/' + encodeURIComponent(name) + '/messages?limit=100'); } catch { return; }
    const list = document.getElementById('msg-list');
    document.getElementById('msg-count').textContent = data.total + ' messages';

    if (data.messages.length === 0) {
      list.innerHTML = '<p class="text-gray-600 text-sm text-center py-16">No messages in this tab</p>';
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
      const content = m.content.length > 2000 ? m.content.slice(0, 2000) + '\\n\\n... (' + m.content.length.toLocaleString() + ' chars total)' : m.content;

      return '<div class="' + cls + ' rounded-lg p-3">' +
        '<div class="flex items-center justify-between mb-1">' +
          '<span class="text-xs font-semibold ' + (m.role === 'user' ? 'text-honey-400' : 'text-gray-400') + '">' + label + metaStr + '</span>' +
          '<span class="text-xs text-gray-600">' + timeAgo(m.created_at) + '</span>' +
        '</div>' +
        '<pre class="text-sm text-gray-300 whitespace-pre-wrap break-words font-sans leading-relaxed">' + esc(content) + '</pre>' +
      '</div>';
    }).join('');

    list.scrollTop = list.scrollHeight;
    document.getElementById('msg-input').focus();
  }

  // --- Send message ---
  async function sendMessage(e) {
    e.preventDefault();
    const input = document.getElementById('msg-input');
    const message = input.value.trim();
    if (!message || !selectedTab) return;

    input.value = '';
    input.disabled = true;

    try {
      await api('/api/tabs/' + encodeURIComponent(selectedTab) + '/send', {
        method: 'POST',
        body: JSON.stringify({ message })
      });
      // Append optimistic message to UI
      const list = document.getElementById('msg-list');
      list.innerHTML += '<div class="msg-user rounded-lg p-3">' +
        '<div class="flex items-center justify-between mb-1">' +
          '<span class="text-xs font-semibold text-honey-400">You (queued)</span>' +
          '<span class="text-xs text-gray-600">just now</span>' +
        '</div>' +
        '<pre class="text-sm text-gray-300 whitespace-pre-wrap break-words font-sans leading-relaxed">' + esc(message) + '</pre>' +
      '</div>';
      list.scrollTop = list.scrollHeight;
    } catch (err) {
      alert('Failed to send: ' + err.message);
    }
    input.disabled = false;
    input.focus();
  }

  // --- Delete tab ---
  async function deleteSelectedTab() {
    if (!selectedTab) return;
    if (!confirm('Delete tab "' + selectedTab + '" and all its messages?')) return;
    try { await api('/api/tabs/' + encodeURIComponent(selectedTab), { method: 'DELETE' }); } catch { return; }
    selectedTab = null;
    document.getElementById('msg-title').textContent = 'Select a tab';
    document.getElementById('msg-tab-status').textContent = '';
    document.getElementById('msg-count').textContent = '';
    document.getElementById('msg-list').innerHTML = '<p class="text-gray-600 text-sm text-center py-16">Select a tab to view messages</p>';
    document.getElementById('btn-delete-tab').classList.add('hidden');
    document.getElementById('msg-input-area').classList.add('hidden');
    loadTabs();
  }

  // --- Create tab modal ---
  function showCreateTabModal() {
    document.getElementById('modal').innerHTML = '<div class="modal-overlay" onclick="closeModal(event)">' +
      '<div class="modal-content" onclick="event.stopPropagation()">' +
        '<h3 class="text-base font-semibold text-white mb-4">Create Tab</h3>' +
        '<div class="space-y-3">' +
          '<div><label class="text-xs text-gray-400 mb-1 block">Name *</label>' +
            '<input id="modal-tab-name" class="input-field w-full px-3 py-2 text-sm" placeholder="my-tab"></div>' +
          '<div><label class="text-xs text-gray-400 mb-1 block">Working Directory</label>' +
            '<input id="modal-tab-dir" class="input-field w-full px-3 py-2 text-sm" placeholder="~"></div>' +
          '<div><label class="text-xs text-gray-400 mb-1 block">System Prompt</label>' +
            '<textarea id="modal-tab-prompt" class="input-field w-full px-3 py-2 text-sm h-20 resize-none" placeholder="Optional"></textarea></div>' +
        '</div>' +
        '<div class="flex justify-end gap-2 mt-5">' +
          '<button class="btn-ghost px-4 py-2 text-sm" onclick="closeModal()">Cancel</button>' +
          '<button class="btn-primary px-4 py-2 text-sm" onclick="createTab()">Create</button>' +
        '</div>' +
      '</div>' +
    '</div>';
    document.getElementById('modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('modal-tab-name').focus(), 100);
  }

  async function createTab() {
    const name = document.getElementById('modal-tab-name').value.trim();
    if (!name) return;
    const workingDir = document.getElementById('modal-tab-dir').value.trim() || undefined;
    const systemPrompt = document.getElementById('modal-tab-prompt').value.trim() || undefined;
    try { await api('/api/tabs', { method: 'POST', body: JSON.stringify({ name, workingDir, systemPrompt }) }); } catch { return; }
    closeModal();
    loadTabs();
  }

  // --- Memories ---
  async function loadMemories(query) {
    const q = query || document.getElementById('memory-search').value || '';
    let data; try { data = await api('/api/memories?limit=100&q=' + encodeURIComponent(q)); } catch { return; }
    const list = document.getElementById('memory-list');
    document.getElementById('memory-count').textContent = data.total + ' total';

    if (data.memories.length === 0) {
      list.innerHTML = '<p class="text-gray-600 text-sm text-center py-8">No memories' + (q ? ' matching "' + esc(q) + '"' : '') + '</p>';
      return;
    }

    list.innerHTML = data.memories.map(m => {
      const scope = m.tab_name ? 'tab:' + esc(m.tab_name) : 'global';
      return '<div class="px-4 py-3 border-b border-bee-700 group hover:bg-bee-750">' +
        '<div class="flex items-center justify-between mb-1">' +
          '<div class="flex items-center gap-2">' +
            '<span class="text-xs px-1.5 py-0.5 rounded ' + (m.source === 'auto' ? 'bg-blue-900/50 text-blue-400' : 'bg-purple-900/50 text-purple-400') + '">' + m.source + '</span>' +
            '<span class="text-xs text-gray-600">' + scope + '</span>' +
          '</div>' +
          '<div class="flex items-center gap-2">' +
            '<span class="text-xs text-gray-700">' + timeAgo(m.created_at) + '</span>' +
            '<button class="btn-danger px-1.5 py-0.5 text-xs opacity-0 group-hover:opacity-100" aria-label="Delete memory" onclick="deleteMemory(' + m.id + ')">x</button>' +
          '</div>' +
        '</div>' +
        '<p class="text-sm text-gray-300 leading-relaxed">' + esc(m.content) + '</p>' +
      '</div>';
    }).join('');
  }

  function debounceMemorySearch() {
    clearTimeout(memorySearchTimer);
    memorySearchTimer = setTimeout(() => loadMemories(), 300);
  }

  async function deleteMemory(id) {
    try { await api('/api/memories/' + id, { method: 'DELETE' }); } catch { return; }
    loadMemories();
  }

  function showCreateMemoryModal() {
    document.getElementById('modal').innerHTML = '<div class="modal-overlay" onclick="closeModal(event)">' +
      '<div class="modal-content" onclick="event.stopPropagation()">' +
        '<h3 class="text-base font-semibold text-white mb-4">Add Memory</h3>' +
        '<div class="space-y-3">' +
          '<div><label class="text-xs text-gray-400 mb-1 block">Content *</label>' +
            '<textarea id="modal-mem-content" class="input-field w-full px-3 py-2 text-sm h-24 resize-none" placeholder="What to remember..."></textarea></div>' +
          '<div><label class="text-xs text-gray-400 mb-1 block">Tab (optional)</label>' +
            '<input id="modal-mem-tab" class="input-field w-full px-3 py-2 text-sm" placeholder="global"></div>' +
        '</div>' +
        '<div class="flex justify-end gap-2 mt-5">' +
          '<button class="btn-ghost px-4 py-2 text-sm" onclick="closeModal()">Cancel</button>' +
          '<button class="btn-primary px-4 py-2 text-sm" onclick="createMemory()">Save</button>' +
        '</div>' +
      '</div>' +
    '</div>';
    document.getElementById('modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('modal-mem-content').focus(), 100);
  }

  async function createMemory() {
    const content = document.getElementById('modal-mem-content').value.trim();
    if (!content) return;
    const tabName = document.getElementById('modal-mem-tab').value.trim() || undefined;
    try { await api('/api/memories', { method: 'POST', body: JSON.stringify({ content, tabName }) }); } catch { return; }
    closeModal();
    loadMemories();
  }

  // --- Tasks (formerly Crons) ---
  async function loadCrons() {
    let crons; try { crons = await api('/api/tasks'); } catch { return; }
    const list = document.getElementById('cron-list');

    if (crons.length === 0) {
      list.innerHTML = '<p class="text-gray-600 text-sm text-center py-8">No tasks</p>';
      return;
    }

    list.innerHTML = crons.map(c => {
      const enabled = c.enabled === 1;
      return '<div class="px-4 py-3 border-b border-bee-700 group hover:bg-bee-750">' +
        '<div class="flex items-center justify-between">' +
          '<div class="flex items-center gap-2">' +
            '<span class="status-dot ' + (enabled ? 'status-running' : 'status-idle') + '"></span>' +
            '<span class="text-sm font-medium text-white">' + esc(c.name) + '</span>' +
          '</div>' +
          '<div class="flex items-center gap-2">' +
            '<span class="text-xs font-mono text-gray-400">' + c.schedule_type + ': ' + esc(c.schedule) + '</span>' +
            '<button class="btn-danger px-1.5 py-0.5 text-xs opacity-0 group-hover:opacity-100" aria-label="Delete task" onclick="deleteCron(\\'' + esc(c.id) + '\\')">x</button>' +
          '</div>' +
        '</div>' +
        '<div class="flex items-center justify-between mt-1 pl-5">' +
          '<span class="text-xs text-gray-500">tab: ' + esc(c.tab_name) + ' &middot; ' + esc((c.message || '').slice(0, 80)) + '</span>' +
          '<span class="text-xs text-gray-700">last: ' + timeAgo(c.last_run_at) + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  async function deleteCron(id) {
    if (!confirm('Delete this task?')) return;
    try { await api('/api/tasks/' + encodeURIComponent(id), { method: 'DELETE' }); } catch { return; }
    loadCrons();
  }

  function showCreateCronModal() {
    document.getElementById('modal').innerHTML = '<div class="modal-overlay" onclick="closeModal(event)">' +
      '<div class="modal-content" onclick="event.stopPropagation()">' +
        '<h3 class="text-base font-semibold text-white mb-4">Create Task</h3>' +
        '<div class="space-y-3">' +
          '<div><label class="text-xs text-gray-400 mb-1 block">Name *</label>' +
            '<input id="modal-cron-name" class="input-field w-full px-3 py-2 text-sm" placeholder="daily-report"></div>' +
          '<div class="grid grid-cols-2 gap-3">' +
            '<div><label class="text-xs text-gray-400 mb-1 block">Schedule Type</label>' +
              '<select id="modal-cron-type" class="input-field w-full px-3 py-2 text-sm"><option value="every">every</option><option value="cron">cron</option></select></div>' +
            '<div><label class="text-xs text-gray-400 mb-1 block">Schedule *</label>' +
              '<input id="modal-cron-schedule" class="input-field w-full px-3 py-2 text-sm" placeholder="30m or */5 * * * *"></div>' +
          '</div>' +
          '<div><label class="text-xs text-gray-400 mb-1 block">Tab Name</label>' +
            '<input id="modal-cron-tab" class="input-field w-full px-3 py-2 text-sm" placeholder="default"></div>' +
          '<div><label class="text-xs text-gray-400 mb-1 block">Message *</label>' +
            '<textarea id="modal-cron-msg" class="input-field w-full px-3 py-2 text-sm h-20 resize-none" placeholder="What to tell the tab..."></textarea></div>' +
        '</div>' +
        '<div class="flex justify-end gap-2 mt-5">' +
          '<button class="btn-ghost px-4 py-2 text-sm" onclick="closeModal()">Cancel</button>' +
          '<button class="btn-primary px-4 py-2 text-sm" onclick="createCron()">Create</button>' +
        '</div>' +
      '</div>' +
    '</div>';
    document.getElementById('modal').classList.remove('hidden');
    setTimeout(() => document.getElementById('modal-cron-name').focus(), 100);
  }

  async function createCron() {
    const name = document.getElementById('modal-cron-name').value.trim();
    const scheduleType = document.getElementById('modal-cron-type').value;
    const schedule = document.getElementById('modal-cron-schedule').value.trim();
    const tabName = document.getElementById('modal-cron-tab').value.trim() || 'default';
    const message = document.getElementById('modal-cron-msg').value.trim();
    if (!name || !schedule || !message) return;
    try { await api('/api/tasks', { method: 'POST', body: JSON.stringify({ name, scheduleType, schedule, tabName, message }) }); } catch { return; }
    closeModal();
    loadCrons();
  }

  // --- Watchers ---
  async function loadWatchers() {
    let watchers; try { watchers = await api('/api/watchers'); } catch { return; }
    const list = document.getElementById('watcher-list');

    if (watchers.length === 0) {
      list.innerHTML = '<p class="text-gray-600 text-sm text-center py-8">No watchers configured</p>';
      return;
    }

    list.innerHTML = watchers.map(w => {
      const enabled = w.enabled === 1;
      return '<div class="px-4 py-3 border-b border-bee-700 group hover:bg-bee-750">' +
        '<div class="flex items-center justify-between">' +
          '<div class="flex items-center gap-2">' +
            '<span class="status-dot ' + (enabled ? 'status-running' : 'status-idle') + '"></span>' +
            '<span class="text-sm font-medium text-white">' + esc(w.name) + '</span>' +
          '</div>' +
          '<div class="flex items-center gap-2">' +
            '<span class="text-xs font-mono text-gray-400">' + esc(w.schedule) + '</span>' +
            '<span class="text-xs text-gray-500">action: ' + esc(w.action) + '</span>' +
            '<button class="btn-danger px-1.5 py-0.5 text-xs opacity-0 group-hover:opacity-100" aria-label="Delete watcher" onclick="deleteWatcher(\\'' + esc(w.id) + '\\')">x</button>' +
          '</div>' +
        '</div>' +
        '<div class="flex items-center justify-between mt-1 pl-5">' +
          '<span class="text-xs text-gray-500">' + esc(w.condition) + ' &middot; triggers: ' + w.trigger_count + '</span>' +
          '<span class="text-xs text-gray-700">last check: ' + timeAgo(w.last_check_at) + '</span>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  async function deleteWatcher(id) {
    if (!confirm('Delete this watcher?')) return;
    try { await api('/api/watchers/' + encodeURIComponent(id), { method: 'DELETE' }); } catch { return; }
    loadWatchers();
  }

  // --- Costs ---
  async function loadCosts() {
    let costs; try { costs = await api('/api/costs'); } catch { return; }
    const chart = document.getElementById('cost-chart');

    if (costs.length === 0) {
      chart.innerHTML = '<p class="text-gray-600 text-sm text-center py-8">No cost data yet</p>';
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
          const day = c.day.slice(5);
          return '<div class="flex-1 flex flex-col items-center gap-1">' +
            '<span class="text-xs text-gray-500 font-mono">$' + c.total_cost.toFixed(3) + '</span>' +
            '<div class="w-full cost-bar" style="height:' + Math.max(pct, 2) + '%" title="' + c.day + ': $' + c.total_cost.toFixed(4) + ' (' + c.message_count + ' msgs)"></div>' +
            '<span class="text-xs text-gray-600 font-mono">' + day + '</span>' +
          '</div>';
        }).join('') +
      '</div>';
  }

  // --- Update ---
  const PACKAGE_LABELS = {
    'beecork': 'Beecork',
    '@anthropic-ai/claude-code': 'Claude Code',
  };

  async function loadUpdateStatus() {
    const el = document.getElementById('update-packages');
    try {
      const data = await api('/api/update/status');
      el.innerHTML = data.packages.map(function(p) {
        const label = PACKAGE_LABELS[p.name] || p.name;
        const installed = p.installed || 'not installed';
        const latest = p.latest || '?';
        const badge = p.updateAvailable
          ? '<span class="text-honey-400 text-xs ml-2">update available</span>'
          : '<span class="text-green-400 text-xs ml-2">up to date</span>';
        const btn = p.updateAvailable
          ? ' <button onclick="doUpdate(\\''+esc(p.name)+'\\')" class="update-pkg-btn bg-honey-600 hover:bg-honey-500 text-black font-semibold px-3 py-1 rounded text-xs ml-2">Update</button>'
          : '';
        return '<div class="panel-card p-3 flex items-center justify-between">' +
          '<div>' +
            '<div class="text-white font-medium">' + esc(label) + badge + '</div>' +
            '<div class="text-xs text-gray-500 font-mono mt-1">' + esc(installed) + (p.updateAvailable ? ' → ' + esc(latest) : '') + '</div>' +
          '</div>' +
          '<div>' + btn + '</div>' +
        '</div>';
      }).join('');
    } catch {
      el.innerHTML = '<span class="text-red-400">Failed to check for updates</span>';
    }
  }

  async function doUpdate(pkgName) {
    const log = document.getElementById('update-log');
    const btns = document.querySelectorAll('.update-pkg-btn');
    btns.forEach(function(b) { b.disabled = true; b.textContent = 'Updating...'; });
    log.classList.remove('hidden');
    log.textContent = 'Updating ' + pkgName + '...\\n';

    try {
      const result = await api('/api/update/' + encodeURIComponent(pkgName), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (result.success) {
        log.textContent += 'Done!\\n\\nRestart daemon to use the new version:\\n  beecork stop && beecork start';
        loadUpdateStatus();
      } else {
        log.textContent += 'Error: ' + (result.error || 'Unknown error');
        btns.forEach(function(b) { b.disabled = false; b.textContent = 'Update'; });
      }
    } catch (err) {
      log.textContent += 'Failed: ' + err.message;
      btns.forEach(function(b) { b.disabled = false; b.textContent = 'Update'; });
    }
  }

  // --- Modal helpers ---
  function closeModal(e) {
    if (e && e.target !== e.currentTarget) return;
    document.getElementById('modal').classList.add('hidden');
    document.getElementById('modal').innerHTML = '';
  }

  // --- Init ---
  connectSSE();
  loadStatus();
  loadTabs();
  setInterval(loadStatus, 10000);
  // Periodically reload messages for selected tab
  setInterval(() => { if (selectedTab) selectTab(selectedTab); }, 8000);
</script>
</body>
</html>`;
}
