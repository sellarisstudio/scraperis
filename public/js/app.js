/**
 * ScrapMap - Frontend Application
 * Handles search, SSE streaming, results rendering, and exports.
 */

(function () {
  'use strict';

  // ========================
  // DOM References
  // ========================
  const searchForm = document.getElementById('search-form');
  const searchQuery = document.getElementById('search-query');
  const searchLocation = document.getElementById('search-location');
  const maxResultsSlider = document.getElementById('max-results');
  const sliderValue = document.getElementById('slider-value');
  const btnScrape = document.getElementById('btn-scrape');
  const btnText = document.getElementById('btn-text');
  const btnSpinner = document.getElementById('btn-spinner');

  const searchModeInput = document.getElementById('search-mode');
  const modeMapsBtn = document.getElementById('mode-maps-btn');
  const modeSearchBtn = document.getElementById('mode-search-btn');
  const searchExtraFields = document.getElementById('search-extra-fields');
  const searchPlatformSelect = document.getElementById('search-platform');
  const searchPlatformCustom = document.getElementById('search-platform-custom');
  const searchContactInput = document.getElementById('search-contact');
  const labelQuery = document.getElementById('label-query');
  const hintQuery = document.getElementById('hint-query');

  const progressSection = document.getElementById('progress-section');
  const progressBar = document.getElementById('progress-bar');
  const progressPercent = document.getElementById('progress-percent');
  const progressStatusText = document.getElementById('progress-status-text');
  const statusDot = document.getElementById('status-dot');
  const progressLogs = document.getElementById('progress-logs');
  const statFound = document.getElementById('stat-found');
  const statQuery = document.getElementById('stat-query');
  const statLocation = document.getElementById('stat-location');

  const resultsSection = document.getElementById('results-section');
  const resultsTbody = document.getElementById('results-tbody');
  const resultsThead = document.getElementById('results-thead');
  const resultsCount = document.getElementById('results-count');
  const emptyState = document.getElementById('empty-state');

  const btnExportCsv = document.getElementById('btn-export-csv');
  const btnExportExcel = document.getElementById('btn-export-excel');
  const btnSaveAllBasket = document.getElementById('btn-save-all-basket');

  const btnBasketExportCsv = document.getElementById('btn-basket-export-csv');
  const btnBasketExportExcel = document.getElementById('btn-basket-export-excel');
  const btnBasketClear = document.getElementById('btn-basket-clear');
  const basketGroupsContainer = document.getElementById('basket-groups-container');
  const basketCount = document.getElementById('basket-count');
  const basketEmptyState = document.getElementById('basket-empty-state');
  const chkBasketSelectAll = document.getElementById('chk-basket-select-all');
  const basketSelectionBar = document.getElementById('basket-selection-bar');

  const toastContainer = document.getElementById('toast-container');

  // ========================
  // State
  // ========================
  let currentJobId = null;
  let eventSource = null;
  let results = [];
  let sortColumn = null;
  let sortDirection = 'asc';
  let activeScraperMode = 'maps';
  let savedLeads = [];
  let uncheckedDates = new Set();
  let sequenceActive = false;
  let subJobResults = [];
  let cancelRequested = false;

  try {
    savedLeads = JSON.parse(localStorage.getItem('scraperis_basket') || localStorage.getItem('scrapmap_basket')) || [];
  } catch (err) {
    savedLeads = [];
  }

  // ========================
  // Sidebar View Switcher
  // ========================
  const navScraperBtn = document.getElementById('nav-scraper-btn');
  const navBasketBtn = document.getElementById('nav-basket-btn');
  const navConfigBtn = document.getElementById('nav-config-btn');
  const viewScraper = document.getElementById('view-scraper');
  const viewBasket = document.getElementById('view-basket');
  const viewConfig = document.getElementById('view-config');

  navScraperBtn.addEventListener('click', () => {
    navScraperBtn.classList.add('active');
    navBasketBtn.classList.remove('active');
    navConfigBtn.classList.remove('active');
    viewScraper.classList.add('active');
    viewBasket.classList.remove('active');
    viewConfig.classList.remove('active');
  });

  navBasketBtn.addEventListener('click', () => {
    navBasketBtn.classList.add('active');
    navScraperBtn.classList.remove('active');
    navConfigBtn.classList.remove('active');
    viewBasket.classList.add('active');
    viewScraper.classList.remove('active');
    viewConfig.classList.remove('active');
  });

  navConfigBtn.addEventListener('click', () => {
    navConfigBtn.classList.add('active');
    navScraperBtn.classList.remove('active');
    navBasketBtn.classList.remove('active');
    viewConfig.classList.add('active');
    viewScraper.classList.remove('active');
    viewBasket.classList.remove('active');
  });

  // ========================
  // Configuration State
  // ========================
  function saveConfig() {
    const mapsCols = [];
    document.querySelectorAll('#config-maps-columns .a-checkbox-input').forEach(cb => {
      if (cb.checked) mapsCols.push(cb.value);
    });
    const searchCols = [];
    document.querySelectorAll('#config-search-columns .a-checkbox-input').forEach(cb => {
      if (cb.checked) searchCols.push(cb.value);
    });
    const basketCols = [];
    document.querySelectorAll('#config-basket-columns .a-checkbox-input').forEach(cb => {
      if (cb.checked) basketCols.push(cb.value);
    });

    localStorage.setItem('scraperis_config_maps', JSON.stringify(mapsCols));
    localStorage.setItem('scraperis_config_search', JSON.stringify(searchCols));
    localStorage.setItem('scraperis_config_basket', JSON.stringify(basketCols));
  }

  function loadConfig() {
    try {
      const mapsSaved = localStorage.getItem('scraperis_config_maps') || localStorage.getItem('scrapmap_config_maps');
      if (mapsSaved) {
        const mapsCols = JSON.parse(mapsSaved);
        document.querySelectorAll('#config-maps-columns .a-checkbox-input').forEach(cb => {
          cb.checked = mapsCols.includes(cb.value);
        });
      }

      const searchSaved = localStorage.getItem('scraperis_config_search') || localStorage.getItem('scrapmap_config_search');
      if (searchSaved) {
        const searchCols = JSON.parse(searchSaved);
        document.querySelectorAll('#config-search-columns .a-checkbox-input').forEach(cb => {
          cb.checked = searchCols.includes(cb.value);
        });
      }

      const basketSaved = localStorage.getItem('scraperis_config_basket') || localStorage.getItem('scrapmap_config_basket');
      if (basketSaved) {
        const basketCols = JSON.parse(basketSaved);
        document.querySelectorAll('#config-basket-columns .a-checkbox-input').forEach(cb => {
          cb.checked = basketCols.includes(cb.value);
        });
      }
    } catch (err) {
      console.error('Error loading config:', err);
    }
  }

  function getCheckedColumns(mode) {
    let selector = '#config-maps-columns';
    if (mode === 'search') {
      selector = '#config-search-columns';
    } else if (mode === 'basket') {
      selector = '#config-basket-columns';
    }
    const cols = [];
    document.querySelectorAll(`${selector} .a-checkbox-input`).forEach(cb => {
      if (cb.checked) cols.push(cb.value);
    });
    return cols;
  }

  // Bind checkbox changes
  document.querySelectorAll('.a-checkbox-input').forEach(cb => {
    cb.addEventListener('change', saveConfig);
  });

  // Load config on startup
  loadConfig();

  // ========================
  // Mode Selector Toggle
  // ========================
  modeMapsBtn.addEventListener('click', () => {
    switchMode('maps');
  });

  modeSearchBtn.addEventListener('click', () => {
    switchMode('search');
  });

  function switchMode(mode) {
    if (sequenceActive) return; // Prevent switching mode while scraping
    if (mode === activeScraperMode) return;
    activeScraperMode = mode;
    searchModeInput.value = mode;

    if (mode === 'maps') {
      modeMapsBtn.classList.add('active');
      modeSearchBtn.classList.remove('active');
      searchExtraFields.style.display = 'none';

      labelQuery.textContent = '🔍 Business Keyword';
      hintQuery.textContent = 'What type of business are you looking for? (One keyword per line)';
      searchQuery.placeholder = 'e.g. Kedai kopi\nCoffee shop\nCafe';
    } else {
      modeMapsBtn.classList.remove('active');
      modeSearchBtn.classList.add('active');
      searchExtraFields.style.display = 'grid';

      labelQuery.textContent = '🔍 Search Keyword (Category)';
      hintQuery.textContent = 'What business category/niche to look for? (One keyword per line)';
      searchQuery.placeholder = 'e.g. Coffee\nEsteh\nToko';
    }
  }

  // Handle custom platform option
  searchPlatformSelect.addEventListener('change', () => {
    if (searchPlatformSelect.value === 'custom') {
      searchPlatformCustom.style.display = 'block';
      searchPlatformCustom.required = true;
    } else {
      searchPlatformCustom.style.display = 'none';
      searchPlatformCustom.required = false;
    }
  });

  // ========================
  // Slider
  // ========================
  maxResultsSlider.addEventListener('input', () => {
    sliderValue.textContent = maxResultsSlider.value;
  });

  // ========================
  // Search Form
  // ========================
  searchForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    if (sequenceActive) {
      // Handle stop request
      cancelRequested = true;
      showToast('Stopping scrape sequence...', 'info');

      if (currentJobId) {
        try {
          await fetch(`/api/scrape/${currentJobId}`, { method: 'DELETE' });
        } catch (err) {
          console.error('Error canceling current job:', err);
        }
      }

      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }

      sequenceActive = false;
      setFormLoading(false);

      progressStatusText.textContent = 'Scraping stopped by user.';
      statusDot.className = 'status-dot error';
      return;
    }

    const queries = searchQuery.value.split('\n').map(q => q.trim()).filter(Boolean);
    const locations = searchLocation.value.split('\n').map(l => l.trim()).filter(Boolean);
    const maxResults = parseInt(maxResultsSlider.value);
    const mode = searchModeInput.value;
    const autoSaveBasket = document.getElementById('chk-auto-save-basket')?.checked || false;

    let platform = '';
    let contactPrefix = '';

    if (mode === 'search') {
      platform = searchPlatformSelect.value === 'custom'
        ? searchPlatformCustom.value.trim()
        : searchPlatformSelect.value;
      contactPrefix = searchContactInput.value.trim();

      if (!platform) {
        showToast('Please specify a platform.', 'error');
        return;
      }
    }

    if (queries.length === 0 || locations.length === 0) {
      showToast('Please fill in both keywords and locations.', 'error');
      return;
    }

    // Set state
    sequenceActive = true;
    cancelRequested = false;
    setFormLoading(true);

    // Reset global results and UI
    results = [];
    resultsTbody.innerHTML = '';
    progressLogs.innerHTML = '';
    progressBar.style.width = '0%';
    progressBar.classList.remove('done');
    progressPercent.textContent = '0%';
    statusDot.className = 'status-dot';
    progressStatusText.textContent = 'Starting sequence...';
    statFound.textContent = '0';
    statQuery.textContent = mode === 'search' ? `${platform} -> ${queries[0]}` : queries[0];
    statLocation.textContent = locations[0];
    emptyState.style.display = 'none';

    // Render appropriate table header
    renderTableHeader(mode);

    // Show sections
    progressSection.classList.add('active');
    resultsSection.classList.add('active');

    // Disable export
    btnExportCsv.disabled = true;
    btnExportExcel.disabled = true;
    btnSaveAllBasket.disabled = true;

    // Scroll to progress
    progressSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

    try {
      const totalSteps = queries.length * locations.length;
      let currentStep = 0;

      for (let qIdx = 0; qIdx < queries.length; qIdx++) {
        const query = queries[qIdx];

        for (let lIdx = 0; lIdx < locations.length; lIdx++) {
          const location = locations[lIdx];

          if (cancelRequested) {
            break;
          }

          currentStep++;

          // Update status stats
          statQuery.textContent = mode === 'search' ? `${platform} -> ${query}` : query;
          statLocation.textContent = location;
          progressStatusText.textContent = `Scraping [${currentStep}/${totalSteps}]: ${query} in ${location}...`;

          addLogEntry(`--------------------------------------------------`);
          addLogEntry(`🚀 [${currentStep}/${totalSteps}] Scraping: "${query}" in "${location}"`);
          addLogEntry(`--------------------------------------------------`);

          // Start current sub-job and wait for it
          subJobResults = [];

          const success = await runSubJob(query, location, maxResults, mode, platform, contactPrefix, currentStep, totalSteps);

          if (cancelRequested) {
            break;
          }

          if (success) {
            addLogEntry(`✅ Finished scraping "${query}" in "${location}". Found ${subJobResults.length} leads.`);

            // Auto save to basket if enabled
            if (autoSaveBasket && subJobResults.length > 0) {
              addLogEntry(`📥 Auto-saving ${subJobResults.length} leads to Leads Basket...`);
              saveSubJobLeadsToBasket(subJobResults);
            }
          } else {
            addLogEntry(`⚠️ Sub-job failed or ended with warning for "${query}" in "${location}".`);
          }
        }
        if (cancelRequested) {
          break;
        }
      }

      // Sequence completed or stopped
      sequenceActive = false;
      setFormLoading(false);

      if (cancelRequested) {
        progressStatusText.textContent = 'Scraping sequence stopped.';
        statusDot.className = 'status-dot error';
        showToast('Scraping sequence stopped.', 'warning');
      } else {
        progressBar.classList.add('done');
        statusDot.classList.add('done');
        progressStatusText.textContent = `Scraping complete! Found ${results.length} total businesses.`;
        updateProgress(100);
        showToast(`All jobs completed! Found ${results.length} total leads.`, 'success');
      }

      if (results.length > 0) {
        btnExportCsv.disabled = false;
        btnExportExcel.disabled = false;
        btnSaveAllBasket.disabled = false;
      }

    } catch (err) {
      sequenceActive = false;
      setFormLoading(false);
      showToast(err.message, 'error');
      progressStatusText.textContent = 'Error: ' + err.message;
      statusDot.className = 'status-dot error';
    }
  });

  function runSubJob(query, location, maxResults, mode, platform, contactPrefix, currentStep, totalSteps) {
    return new Promise(async (resolve) => {
      try {
        const response = await fetch('/api/scrape', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query,
            location,
            maxResults,
            mode,
            platform,
            contactPrefix,
          }),
        });

        if (!response.ok) {
          const err = await response.json();
          addLogEntry(`❌ Server error: ${err.error}`);
          resolve(false);
          return;
        }

        const data = await response.json();
        currentJobId = data.id;

        // Connect SSE with resolver
        connectSubJobSSE(currentJobId, resolve, currentStep, totalSteps);
      } catch (err) {
        addLogEntry(`❌ Connection error: ${err.message}`);
        resolve(false);
      }
    });
  }

  function connectSubJobSSE(jobId, resolve, currentStep, totalSteps) {
    if (eventSource) {
      eventSource.close();
    }

    eventSource = new EventSource(`/api/scrape/${jobId}/stream`);

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        handleSubJobSSEEvent(payload, resolve, currentStep, totalSteps);
      } catch (err) {
        console.error('SSE parse error:', err);
      }
    };

    eventSource.onerror = () => {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      resolve(false);
    };
  }

  function handleSubJobSSEEvent(payload, resolve, currentStep, totalSteps) {
    const { event, data } = payload;

    switch (event) {
      case 'init':
        if (data.progress) {
          updateSubJobProgress(data.progress, currentStep, totalSteps);
        }
        if (data.results && data.results.length > 0) {
          data.results.forEach((r) => {
            const isDuplicate = results.some(item => 
              (activeScraperMode === 'search' && item.url === r.url && item.title === r.title) ||
              (activeScraperMode === 'maps' && item.name === r.name && item.address === r.address)
            );
            if (!isDuplicate) {
              addResultRow(r);
              subJobResults.push(r);
            }
          });
        }
        if (data.logs) {
          data.logs.forEach((log) => addLogEntry(log.message));
        }
        break;

      case 'progress':
        updateSubJobProgress(data.progress, currentStep, totalSteps);
        if (data.message) addLogEntry(data.message);
        break;

      case 'result':
        const r = data.result;
        const isDuplicate = results.some(item => 
          (activeScraperMode === 'search' && item.url === r.url && item.title === r.title) ||
          (activeScraperMode === 'maps' && item.name === r.name && item.address === r.address)
        );
        if (!isDuplicate) {
          addResultRow(r);
          subJobResults.push(r);
          statFound.textContent = results.length;
        }
        break;

      case 'status':
        if (data.status === 'completed') {
          if (eventSource) {
            eventSource.close();
            eventSource = null;
          }
          resolve(true);
        } else if (data.status === 'failed') {
          if (eventSource) {
            eventSource.close();
            eventSource = null;
          }
          resolve(false);
        }
        break;

      case 'error':
        addLogEntry(`❌ Scraper error: ${data.error}`);
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
        resolve(false);
        break;

      case 'done':
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
        resolve(true);
        break;
    }
  }

  function updateSubJobProgress(subPercent, currentStep, totalSteps) {
    const overallPercent = (((currentStep - 1) + (subPercent / 100)) / totalSteps) * 100;
    const p = Math.min(Math.round(overallPercent), 100);
    progressBar.style.width = p + '%';
    progressPercent.textContent = p + '%';
  }

  function saveSubJobLeadsToBasket(subResults) {
    if (!subResults || subResults.length === 0) return;

    let addedCount = 0;
    const now = new Date().toISOString();
    subResults.forEach((lead) => {
      if (!lead.phone) return;

      const basketItem = {
        name: lead.name || lead.title || '—',
        category: lead.category || lead.platform || '—',
        phone: lead.phone,
        address: lead.address || lead.snippet || '—',
        source: lead.mapsUrl ? 'Maps' : 'Search',
        url: lead.mapsUrl || lead.website || lead.url || '',
        savedAt: now
      };

      const exists = savedLeads.some((item) => item.phone === basketItem.phone);
      if (!exists) {
        savedLeads.push(basketItem);
        addedCount++;
      }
    });

    if (addedCount > 0) {
      saveBasket();
      renderBasketTable();
      showToast(`Auto-saved ${addedCount} new leads to basket!`, 'success');
    }
  }

  // ========================
  // SSE Connection
  // ========================
  function connectSSE(jobId) {
    if (eventSource) {
      eventSource.close();
    }

    eventSource = new EventSource(`/api/scrape/${jobId}/stream`);

    eventSource.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        handleSSEEvent(payload);
      } catch (err) {
        console.error('SSE parse error:', err);
      }
    };

    eventSource.onerror = () => {
      // SSE connection closed (normal on completion)
      eventSource.close();
      eventSource = null;
    };
  }

  function handleSSEEvent(payload) {
    const { event, data } = payload;

    switch (event) {
      case 'init':
        // Initial state sync
        if (data.mode) {
          activeScraperMode = data.mode;
          renderTableHeader(data.mode);
        }
        if (data.progress) updateProgress(data.progress);
        if (data.results && data.results.length > 0) {
          data.results.forEach((r) => addResultRow(r));
        }
        if (data.logs) {
          data.logs.forEach((log) => addLogEntry(log.message));
        }
        break;

      case 'progress':
        updateProgress(data.progress);
        if (data.message) addLogEntry(data.message);
        break;

      case 'result':
        addResultRow(data.result);
        statFound.textContent = data.totalFound;
        break;

      case 'status':
        if (data.status === 'completed') {
          onScrapeComplete();
        } else if (data.status === 'failed') {
          onScrapeFailed();
        }
        break;

      case 'error':
        onScrapeFailed(data.error);
        break;

      case 'done':
        if (eventSource) {
          eventSource.close();
          eventSource = null;
        }
        break;
    }
  }

  // ========================
  // Progress Updates
  // ========================
  function updateProgress(percent) {
    const p = Math.min(Math.round(percent), 100);
    progressBar.style.width = p + '%';
    progressPercent.textContent = p + '%';
  }

  function addLogEntry(message) {
    const entry = document.createElement('div');
    entry.className = 'log-entry';

    const now = new Date();
    const time = now.toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    entry.innerHTML = `
      <span class="log-time">${time}</span>
      <span>${escapeHtml(message)}</span>
    `;

    progressLogs.appendChild(entry);
    progressLogs.scrollTop = progressLogs.scrollHeight;
  }

  function onScrapeComplete() {
    setFormLoading(false);
    progressBar.classList.add('done');
    statusDot.classList.add('done');
    progressStatusText.textContent = `Scraping complete! Found ${results.length} businesses.`;
    updateProgress(100);

    if (results.length > 0) {
      btnExportCsv.disabled = false;
      btnExportExcel.disabled = false;
      btnSaveAllBasket.disabled = false;
    }

    showToast(`Done! ${results.length} businesses extracted.`, 'success');
  }

  function onScrapeFailed(error) {
    setFormLoading(false);
    statusDot.classList.add('error');
    progressStatusText.textContent = 'Scraping failed' + (error ? ': ' + error : '');
    showToast('Scraping failed. Please try again.', 'error');

    // Still enable export if we got some results
    if (results.length > 0) {
      btnExportCsv.disabled = false;
      btnExportExcel.disabled = false;
      btnSaveAllBasket.disabled = false;
    }
  }

  // ========================
  // Table Header Switcher
  // ========================
  function renderTableHeader(mode) {
    if (mode === 'search') {
      resultsThead.innerHTML = `
        <tr>
          <th data-sort="index">No <span class="sort-icon">↕</span></th>
          <th data-sort="title">Page Title <span class="sort-icon">↕</span></th>
          <th data-sort="platform">Platform <span class="sort-icon">↕</span></th>
          <th data-sort="phone">Phone <span class="sort-icon">↕</span></th>
          <th data-sort="url">Link <span class="sort-icon">↕</span></th>
          <th data-sort="snippet">Snippet Preview <span class="sort-icon">↕</span></th>
          <th>Action</th>
        </tr>
      `;
    } else {
      resultsThead.innerHTML = `
        <tr>
          <th data-sort="index">No <span class="sort-icon">↕</span></th>
          <th data-sort="name">Business Name <span class="sort-icon">↕</span></th>
          <th data-sort="category">Category <span class="sort-icon">↕</span></th>
          <th data-sort="rating">Rating <span class="sort-icon">↕</span></th>
          <th data-sort="reviewCount">Reviews <span class="sort-icon">↕</span></th>
          <th data-sort="address">Address <span class="sort-icon">↕</span></th>
          <th data-sort="phone">Phone <span class="sort-icon">↕</span></th>
          <th>Website</th>
          <th>Maps</th>
          <th>Action</th>
        </tr>
      `;
    }

    // Rebind sort listeners to new headers
    bindSortHeaders();
  }

  // ========================
  // Results Table Row Insertion
  // ========================
  function addResultRow(result) {
    results.push(result);
    emptyState.style.display = 'none';
    resultsCount.textContent = `(${results.length})`;

    const tr = document.createElement('tr');
    
    if (activeScraperMode === 'search') {
      tr.innerHTML = `
        <td>${result.index || results.length}</td>
        <td class="cell-name" title="${escapeAttr(result.title)}">${escapeHtml(result.title)}</td>
        <td><span class="cell-category">${escapeHtml(result.platform)}</span></td>
        <td class="cell-phone">${result.phone ? escapeHtml(result.phone) : ''}</td>
        <td class="cell-link">${result.url ? `<a href="${escapeAttr(result.url)}" target="_blank" rel="noopener">Open ↗</a>` : '—'}</td>
        <td class="cell-address" title="${escapeAttr(result.snippet)}">${escapeHtml(result.snippet || '—')}</td>
        <td><button type="button" class="a-btn a-btn-accent save-lead-btn" style="padding: 2px 8px; font-size: var(--font-size-xs);"><i data-lucide="plus" class="icon-sm"></i> Basket</button></td>
      `;
    } else {
      tr.innerHTML = `
        <td>${result.index || results.length}</td>
        <td class="cell-name" title="${escapeAttr(result.name)}">${escapeHtml(result.name)}</td>
        <td><span class="cell-category" title="${escapeAttr(result.category)}">${escapeHtml(result.category || '—')}</span></td>
        <td class="cell-rating">${result.rating ? `<span class="star">★</span> ${result.rating}` : '—'}</td>
        <td class="cell-reviews">${result.reviewCount != null ? formatNumber(result.reviewCount) : '—'}</td>
        <td class="cell-address" title="${escapeAttr(result.address)}">${escapeHtml(result.address || '—')}</td>
        <td class="cell-phone">${result.phone ? escapeHtml(result.phone) : ''}</td>
        <td class="cell-link">${result.website ? `<a href="${escapeAttr(result.website)}" target="_blank" rel="noopener">Visit ↗</a>` : '—'}</td>
        <td class="cell-link">${result.mapsUrl ? `<a href="${escapeAttr(result.mapsUrl)}" target="_blank" rel="noopener">Open ↗</a>` : '—'}</td>
        <td><button type="button" class="a-btn a-btn-accent save-lead-btn" style="padding: 2px 8px; font-size: var(--font-size-xs);"><i data-lucide="plus" class="icon-sm"></i> Basket</button></td>
      `;
    }

    const btn = tr.querySelector('.save-lead-btn');
    if (btn) {
      btn.addEventListener('click', () => {
        saveLeadToBasket(result);
      });
    }

    resultsTbody.appendChild(tr);

    // Dynamic rendering of Lucide icons in the row
    if (window.lucide) {
      window.lucide.createIcons({
        nameAttr: 'data-lucide',
        root: tr
      });
    }

    // Scroll table into view if many results
    if (results.length > 3) {
      const tableContainer = document.querySelector('.table-container');
      tableContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // ========================
  // Sorting
  // ========================
  function bindSortHeaders() {
    document.querySelectorAll('.results-table th[data-sort]').forEach((th) => {
      // Avoid duplicate binding
      th.replaceWith(th.cloneNode(true));
    });

    document.querySelectorAll('.results-table th[data-sort]').forEach((th) => {
      th.addEventListener('click', () => {
        const col = th.dataset.sort;

        if (sortColumn === col) {
          sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
          sortColumn = col;
          sortDirection = 'asc';
        }

        // Update UI
        document.querySelectorAll('.results-table th').forEach((h) => h.classList.remove('sorted'));
        th.classList.add('sorted');
        th.querySelector('.sort-icon').textContent = sortDirection === 'asc' ? '↑' : '↓';

        // Sort results
        const sorted = [...results].sort((a, b) => {
          let aVal = a[col];
          let bVal = b[col];

          // Handle nulls
          if (aVal == null) aVal = '';
          if (bVal == null) bVal = '';

          // Numeric sort
          if (typeof aVal === 'number' && typeof bVal === 'number') {
            return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
          }

          // String sort
          aVal = String(aVal).toLowerCase();
          bVal = String(bVal).toLowerCase();
          if (sortDirection === 'asc') {
            return aVal.localeCompare(bVal);
          }
          return bVal.localeCompare(aVal);
        });

        // Re-render
        resultsTbody.innerHTML = '';
        sorted.forEach((r) => {
          const tr = document.createElement('tr');
          if (activeScraperMode === 'search') {
            tr.innerHTML = `
              <td>${r.index || ''}</td>
              <td class="cell-name" title="${escapeAttr(r.title)}">${escapeHtml(r.title)}</td>
              <td><span class="cell-category">${escapeHtml(r.platform)}</span></td>
              <td class="cell-phone">${r.phone ? escapeHtml(r.phone) : ''}</td>
              <td class="cell-link">${r.url ? `<a href="${escapeAttr(r.url)}" target="_blank" rel="noopener">Open ↗</a>` : '—'}</td>
              <td class="cell-address" title="${escapeAttr(r.snippet)}">${escapeHtml(r.snippet || '—')}</td>
              <td><button type="button" class="btn-delete save-lead-btn" style="color: var(--color-accent); border-color: var(--color-accent-light);">➕ Basket</button></td>
            `;
          } else {
            tr.innerHTML = `
              <td>${r.index || ''}</td>
              <td class="cell-name" title="${escapeAttr(r.name)}">${escapeHtml(r.name)}</td>
              <td><span class="cell-category" title="${escapeAttr(r.category)}">${escapeHtml(r.category || '—')}</span></td>
              <td class="cell-rating">${r.rating ? `<span class="star">★</span> ${r.rating}` : '—'}</td>
              <td class="cell-reviews">${r.reviewCount != null ? formatNumber(r.reviewCount) : '—'}</td>
              <td class="cell-address" title="${escapeAttr(r.address)}">${escapeHtml(r.address || '—')}</td>
              <td class="cell-phone">${r.phone ? escapeHtml(r.phone) : ''}</td>
              <td class="cell-link">${r.website ? `<a href="${escapeAttr(r.website)}" target="_blank" rel="noopener">Visit ↗</a>` : '—'}</td>
              <td class="cell-link">${r.mapsUrl ? `<a href="${escapeAttr(r.mapsUrl)}" target="_blank" rel="noopener">Open ↗</a>` : '—'}</td>
              <td><button type="button" class="btn-delete save-lead-btn" style="color: var(--color-accent); border-color: var(--color-accent-light);">➕ Basket</button></td>
            `;
          }

          const btn = tr.querySelector('.save-lead-btn');
          if (btn) {
            btn.addEventListener('click', () => {
              saveLeadToBasket(r);
            });
          }

          resultsTbody.appendChild(tr);
        });
      });
    });
  }

  // Initialize sorting binding on startup
  bindSortHeaders();

  // ========================
  // Export
  // ========================
  btnExportCsv.addEventListener('click', () => {
    if (!currentJobId) return;
    const cols = getCheckedColumns(activeScraperMode).join(',');
    window.open(`/api/export/${currentJobId}/csv?columns=${encodeURIComponent(cols)}`, '_blank');
    showToast('CSV download started!', 'success');
  });

  btnExportExcel.addEventListener('click', () => {
    if (!currentJobId) return;
    const cols = getCheckedColumns(activeScraperMode).join(',');
    window.open(`/api/export/${currentJobId}/xlsx?columns=${encodeURIComponent(cols)}`, '_blank');
    showToast('Excel download started!', 'success');
  });

  // ========================
  // Form UI Helpers
  // ========================
  function setFormLoading(loading) {
    searchQuery.disabled = loading;
    searchLocation.disabled = loading;
    maxResultsSlider.disabled = loading;
    modeMapsBtn.disabled = loading;
    modeSearchBtn.disabled = loading;
    searchPlatformSelect.disabled = loading;
    searchPlatformCustom.disabled = loading;
    searchContactInput.disabled = loading;

    if (loading) {
      btnScrape.classList.remove('a-btn-primary');
      btnScrape.classList.add('a-btn-danger');
      btnText.innerHTML = '<i data-lucide="square" class="icon-sm"></i> Stop Scraping';
      btnSpinner.style.display = 'none';
    } else {
      btnScrape.classList.add('a-btn-primary');
      btnScrape.classList.remove('a-btn-danger');
      btnText.innerHTML = '<i data-lucide="play" class="icon-sm"></i> Start Scraping';
      btnSpinner.style.display = 'none';
    }

    if (window.lucide) {
      window.lucide.createIcons({
        nameAttr: 'data-lucide',
        root: btnScrape
      });
    }
  }

  // ========================
  // Toast Notifications
  // ========================
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `m-toast m-toast-${type}`;

    const iconName =
      type === 'success' ? 'check-circle' : type === 'error' ? 'alert-triangle' : 'info';
    
    toast.innerHTML = `
      <i data-lucide="${iconName}"></i>
      <span>${escapeHtml(message)}</span>
    `;

    toastContainer.appendChild(toast);

    if (window.lucide) {
      window.lucide.createIcons({
        nameAttr: 'data-lucide',
        root: toast
      });
    }

    // Auto-remove after 4 seconds
    setTimeout(() => {
      toast.classList.add('toast-exit');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // ========================
  // Utility Functions
  // ========================
  function escapeHtml(str) {
    if (!str) return '';
    const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return str.replace(/[&<>"']/g, (c) => map[c]);
  }

  function escapeAttr(str) {
    if (!str) return '';
    return str.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatNumber(num) {
    if (num == null) return '—';
    return num.toLocaleString('id-ID');
  }

  // ========================
  // Keyboard Shortcut
  // ========================
  document.addEventListener('keydown', (e) => {
    // Ctrl+Enter to submit
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      if (!btnScrape.disabled) {
        searchForm.dispatchEvent(new Event('submit'));
      }
    }
  });

  // ========================
  // Basket Operations & UI
  // ========================
  function saveLeadToBasket(lead) {
    if (!lead || !lead.phone) return;

    const basketItem = {
      name: lead.name || lead.title || '—',
      category: lead.category || lead.platform || '—',
      phone: lead.phone,
      address: lead.address || lead.snippet || '—',
      source: lead.mapsUrl ? 'Maps' : 'Search',
      url: lead.mapsUrl || lead.website || lead.url || '',
      savedAt: new Date().toISOString()
    };

    const exists = savedLeads.some((item) => item.phone === basketItem.phone);
    if (exists) {
      showToast(`Lead dengan nomor ${basketItem.phone} sudah ada di basket!`, 'info');
      return;
    }

    savedLeads.push(basketItem);
    saveBasket();
    renderBasketTable();
    showToast(`Saved to basket: ${basketItem.name}`, 'success');
  }

  function saveAllLeadsToBasket() {
    if (results.length === 0) return;

    let addedCount = 0;
    const now = new Date().toISOString();
    results.forEach((lead) => {
      if (!lead.phone) return;

      const basketItem = {
        name: lead.name || lead.title || '—',
        category: lead.category || lead.platform || '—',
        phone: lead.phone,
        address: lead.address || lead.snippet || '—',
        source: lead.mapsUrl ? 'Maps' : 'Search',
        url: lead.mapsUrl || lead.website || lead.url || '',
        savedAt: now
      };

      const exists = savedLeads.some((item) => item.phone === basketItem.phone);
      if (!exists) {
        savedLeads.push(basketItem);
        addedCount++;
      }
    });

    if (addedCount > 0) {
      saveBasket();
      renderBasketTable();
      showToast(`Berhasil menambahkan ${addedCount} lead baru ke basket!`, 'success');
    } else {
      showToast('Semua lead sudah ada di basket (duplikat di-skip).', 'info');
    }
  }

  function formatDateGroup(dateString) {
    if (!dateString || dateString === 'Sebelumnya') return 'Sebelumnya';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('id-ID', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch (e) {
      return dateString;
    }
  }

  function deleteGroupLeads(dateKey, dateLabel) {
    if (confirm(`Yakin ingin menghapus semua lead dari grup "${dateLabel}"?`)) {
      savedLeads = savedLeads.filter((item) => {
        const itemKey = item.savedAt ? item.savedAt.substring(0, 10) : 'Sebelumnya';
        return itemKey !== dateKey;
      });
      saveBasket();
      renderBasketTable();
      showToast(`Grup "${dateLabel}" berhasil dihapus.`, 'info');
    }
  }

  function renderBasketTable() {
    basketGroupsContainer.innerHTML = '';
    basketCount.textContent = `(${savedLeads.length})`;

    const sidebarBadge = document.getElementById('sidebar-basket-badge');
    if (sidebarBadge) {
      sidebarBadge.textContent = savedLeads.length;
      sidebarBadge.style.display = savedLeads.length > 0 ? 'inline-block' : 'none';
    }

    if (savedLeads.length === 0) {
      basketEmptyState.style.display = 'block';
      if (basketSelectionBar) basketSelectionBar.style.display = 'none';
      btnBasketExportCsv.disabled = true;
      btnBasketExportExcel.disabled = true;
      btnBasketClear.disabled = true;
      return;
    }

    basketEmptyState.style.display = 'none';
    if (basketSelectionBar) basketSelectionBar.style.display = 'flex';
    btnBasketExportCsv.disabled = false;
    btnBasketExportExcel.disabled = false;
    btnBasketClear.disabled = false;

    // Group leads by savedAt date part (YYYY-MM-DD)
    const groups = {};
    savedLeads.forEach((item) => {
      const dateKey = item.savedAt ? item.savedAt.substring(0, 10) : 'Sebelumnya';
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(item);
    });

    // Sort date keys descending (newest first)
    const sortedKeys = Object.keys(groups).sort((a, b) => {
      if (a === 'Sebelumnya') return 1;
      if (b === 'Sebelumnya') return -1;
      return b.localeCompare(a);
    });

    sortedKeys.forEach((dateKey) => {
      const groupLeads = groups[dateKey];
      const dateLabel = dateKey === 'Sebelumnya' ? 'Sebelumnya' : formatDateGroup(dateKey);

      const groupDiv = document.createElement('div');
      groupDiv.className = 'o-basket-group';
      groupDiv.style.marginBottom = 'var(--space-6)';

      const isChecked = !uncheckedDates.has(dateKey);
      groupDiv.innerHTML = `
        <div class="m-basket-group-header" style="display: flex; justify-content: space-between; align-items: center; padding: var(--space-3) var(--space-4); background: var(--color-background); border: 1px solid var(--color-border); border-bottom: none; border-top-left-radius: var(--radius-md); border-top-right-radius: var(--radius-md); font-weight: 600; cursor: pointer; user-select: none;">
          <span style="display: flex; align-items: center; gap: var(--space-2); color: var(--color-text-primary);">
            <input type="checkbox" class="a-checkbox-input basket-group-checkbox" data-date="${dateKey}" ${isChecked ? 'checked' : ''} style="margin-right: 8px;" onclick="event.stopPropagation();" />
            <i data-lucide="chevron-down" class="group-collapse-icon icon-sm" style="transition: transform var(--transition-fast);"></i>
            <i data-lucide="calendar" class="icon-accent icon-sm"></i>
            <span>${escapeHtml(dateLabel)}</span>
            <span class="a-badge" style="background: var(--color-accent-light); color: var(--color-accent); font-weight:600;">${groupLeads.length} Leads</span>
          </span>
          <div style="display: flex; align-items: center;" onclick="event.stopPropagation();">
            <button type="button" class="a-btn a-btn-danger remove-group-btn" style="padding: 2px 8px; font-size: var(--font-size-xs);"><i data-lucide="trash-2" class="icon-sm"></i> Hapus Grup</button>
          </div>
        </div>
        <div class="o-table-scroll" style="border-top-left-radius: 0; border-top-right-radius: 0;">
          <table class="o-table">
            <thead>
              <tr>
                <th style="width: 50px;">No</th>
                <th>Nama / Judul</th>
                <th>Kategori / Platform</th>
                <th>Telepon</th>
                <th>Alamat / Snippet</th>
                <th>Sumber</th>
                <th>Link</th>
                <th style="width: 80px; text-align: center;">Aksi</th>
              </tr>
            </thead>
            <tbody class="basket-group-tbody"></tbody>
          </table>
        </div>
      `;

      const headerDiv = groupDiv.querySelector('.m-basket-group-header');
      headerDiv.addEventListener('click', () => {
        groupDiv.classList.toggle('collapsed');
        const icon = headerDiv.querySelector('.group-collapse-icon');
        if (groupDiv.classList.contains('collapsed')) {
          icon.style.transform = 'rotate(-90deg)';
        } else {
          icon.style.transform = 'rotate(0deg)';
        }
      });

      groupDiv.querySelector('.remove-group-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        deleteGroupLeads(dateKey, dateLabel);
      });

      const cb = groupDiv.querySelector('.basket-group-checkbox');
      if (cb) {
        cb.addEventListener('change', (e) => {
          if (e.target.checked) {
            uncheckedDates.delete(dateKey);
          } else {
            uncheckedDates.add(dateKey);
          }
          updateSelectAllCheckboxState();
        });
      }

      const actualTbody = groupDiv.querySelector('.basket-group-tbody');

      groupLeads.forEach((item, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
          <td>${index + 1}</td>
          <td class="cell-name" title="${escapeAttr(item.name)}">${escapeHtml(item.name)}</td>
          <td><span class="cell-category">${escapeHtml(item.category)}</span></td>
          <td class="cell-phone">${escapeHtml(item.phone)}</td>
          <td class="cell-address" title="${escapeAttr(item.address)}">${escapeHtml(item.address)}</td>
          <td><span class="cell-category" style="background: var(--color-accent-light); color: var(--color-accent); font-weight:600;">${escapeHtml(item.source)}</span></td>
          <td class="cell-link">${item.url ? `<a href="${escapeAttr(item.url)}" target="_blank" rel="noopener">Open ↗</a>` : '—'}</td>
          <td style="text-align: center;"><button type="button" class="btn-delete remove-basket-btn" style="padding: 2px 8px;"><i data-lucide="trash-2" class="icon-sm"></i> Hapus</button></td>
        `;

        tr.querySelector('.remove-basket-btn').addEventListener('click', () => {
          deleteBasketLead(item.phone);
        });

        actualTbody.appendChild(tr);
      });

      basketGroupsContainer.appendChild(groupDiv);

      if (window.lucide) {
        window.lucide.createIcons({
          nameAttr: 'data-lucide',
          root: groupDiv
        });
      }
    });

    updateSelectAllCheckboxState();
  }

  function updateSelectAllCheckboxState() {
    if (!chkBasketSelectAll) return;
    const checkboxes = document.querySelectorAll('.basket-group-checkbox');
    const checkedCheckboxes = document.querySelectorAll('.basket-group-checkbox:checked');
    
    chkBasketSelectAll.checked = checkboxes.length > 0 && checkboxes.length === checkedCheckboxes.length;
    chkBasketSelectAll.indeterminate = checkedCheckboxes.length > 0 && checkedCheckboxes.length < checkboxes.length;
  }

  function deleteBasketLead(phone) {
    savedLeads = savedLeads.filter((item) => item.phone !== phone);
    saveBasket();
    renderBasketTable();
    showToast('Lead dihapus dari basket.', 'info');
  }

  function clearBasket() {
    if (confirm('Yakin ingin mengosongkan isi basket?')) {
      savedLeads = [];
      saveBasket();
      renderBasketTable();
      showToast('Basket telah dikosongkan.', 'info');
    }
  }

  function saveBasket() {
    localStorage.setItem('scraperis_basket', JSON.stringify(savedLeads));
  }

  async function exportBasket(format) {
    if (savedLeads.length === 0) return;

    const checkedDates = Array.from(document.querySelectorAll('.basket-group-checkbox:checked')).map(cb => cb.getAttribute('data-date'));
    if (checkedDates.length === 0) {
      showToast('Pilih minimal satu tanggal grup untuk diexport!', 'warning');
      return;
    }

    const leadsToExport = savedLeads.filter(item => {
      const dateKey = item.savedAt ? item.savedAt.substring(0, 10) : 'Sebelumnya';
      return checkedDates.includes(dateKey);
    });

    if (leadsToExport.length === 0) {
      showToast('Tidak ada data untuk diexport dengan tanggal terpilih.', 'warning');
      return;
    }

    showToast('Generating export...', 'info');

    try {
      const basketCols = getCheckedColumns('basket');

      const response = await fetch(`/api/export/basket/${format}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          leads: leadsToExport,
          basketColumns: basketCols
        })
      });

      if (!response.ok) {
        throw new Error('Export failed');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `scrapmap_basket_${Date.now()}.${format === 'xlsx' ? 'xlsx' : 'csv'}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      showToast('Basket export download started!', 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to export basket: ' + err.message, 'error');
    }
  }

  // ========================
  // Event Bindings
  // ========================
  if (chkBasketSelectAll) {
    chkBasketSelectAll.addEventListener('change', (e) => {
      const checked = e.target.checked;
      const checkboxes = document.querySelectorAll('.basket-group-checkbox');
      checkboxes.forEach(cb => {
        cb.checked = checked;
        const dateKey = cb.getAttribute('data-date');
        if (checked) {
          uncheckedDates.delete(dateKey);
        } else {
          uncheckedDates.add(dateKey);
        }
      });
    });
  }

  btnSaveAllBasket.addEventListener('click', saveAllLeadsToBasket);
  btnBasketClear.addEventListener('click', clearBasket);

  btnBasketExportCsv.addEventListener('click', () => {
    exportBasket('csv');
  });

  btnBasketExportExcel.addEventListener('click', () => {
    exportBasket('xlsx');
  });

  // Render basket from localStorage on startup
  renderBasketTable();

  // ========================
  // Smooth header shadow on scroll
  // ========================
  const header = document.getElementById('header');
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (!ticking) {
      requestAnimationFrame(() => {
        if (window.scrollY > 10) {
          header.style.boxShadow = '0 1px 12px rgba(0,0,0,0.06)';
        } else {
          header.style.boxShadow = 'none';
        }
        ticking = false;
      });
      ticking = true;
    }
  });
})();



