/**
 * A.T.A Main Application
 * Coordinates all modules and manages UI
 */

class ATAApp {
  constructor() {
    this.db = db;
    this.graph = null;
    this.currentTab = 'home';
    this.selectedNodeId = null;
    
    this._cacheDomElements();
    this._init();
  }

  // ==================== INITIALIZATION ====================

  async _init() {
    try {
      // Initialize database
      await this.db.init();
      console.log('[App] Database ready');
      
      // Initialize graph renderer
      const canvas = document.getElementById('knowledge-graph');
      if (canvas) {
        this.graph = new KnowledgeGraph(canvas);
        this.graph.onNodeClick = (node) => this._showNodeDetail(node.id);
      }
      
      // Load initial data
      await this._refreshAllViews();
      
      // Setup event listeners
      this._setupEventListeners();
      
      // Schedule maintenance
      UpdateEngine.scheduleMaintenance(24);
      
      // Run initial junk detection (if enabled)
      const autoDetect = await this.db.getSetting('autoDetectJunk');
      if (autoDetect !== false) {
        setTimeout(() => this._autoDetectJunk(), 5000);
      }
      
      console.log('[App] Initialized successfully');
      this._showToast('ระบบพร้อมทำงาน', 'success');
      
    } catch (error) {
      console.error('[App] Initialization failed:', error);
      this._showToast('เกิดข้อผิดพลาดในการเริ่มต้นระบบ', 'error');
    }
  }

  _cacheDomElements() {
    this.els = {
      // Tabs
      tabButtons: document.querySelectorAll('.tab-btn'),
      tabContents: document.querySelectorAll('.tab-content'),
      
      // Home
      nodeCount: document.getElementById('node-count'),
      edgeCount: document.getElementById('edge-count'),
      statTotalNodes: document.getElementById('stat-total-nodes'),
      statHotNodes: document.getElementById('stat-hot-nodes'),
      statTotalEdges: document.getElementById('stat-total-edges'),
      recentList: document.getElementById('recent-list'),
      
      // Add form
      addForm: document.getElementById('add-form'),
      inputTitle: document.getElementById('input-title'),
      inputContent: document.getElementById('input-content'),
      inputTags: document.getElementById('input-tags'),
      inputLinks: document.getElementById('input-links'),
      contentCharCount: document.getElementById('content-char-count'),
      addMessage: document.getElementById('add-message'),
      
      // Search
      searchInput: document.getElementById('search-input'),
      searchClear: document.getElementById('search-clear'),
      searchResults: document.getElementById('search-results'),
      filterTitleOnly: document.getElementById('filter-title-only'),
      sortBy: document.getElementById('sort-by'),
      
      // Graph
      graphInfo: document.getElementById('graph-info'),
      
      // Modal
      nodeModal: document.getElementById('node-modal'),
      modalTitle: document.getElementById('modal-title'),
      modalBody: document.getElementById('modal-body'),
      modalClose: document.getElementById('modal-close'),
      modalEdit: document.getElementById('modal-edit'),
      modalDelete: document.getElementById('modal-delete'),
      
      // Settings
      settingAutoDetect: document.getElementById('setting-auto-detect'),
      settingJunkThreshold: document.getElementById('setting-junk-threshold'),
      thresholdValue: document.getElementById('threshold-value'),
      settingsMessage: document.getElementById('settings-message'),
      systemStats: document.getElementById('system-stats'),
      
      // Toast
      toast: document.getElementById('toast')
    };
  }

  _setupEventListeners() {
    // Tab navigation
    this.els.tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        this._switchTab(tab);
      });
    });
    
    // Add form
    this.els.addForm.addEventListener('submit', (e) => {
      e.preventDefault();
      this._handleAddNode();
    });
    
    this.els.inputContent.addEventListener('input', () => {
      const len = this.els.inputContent.value.length;
      this.els.contentCharCount.textContent = `${len}/5000`;
    });
    
    // Search
    this.els.searchInput.addEventListener('input', () => {
      this._handleSearch();
    });
    
    this.els.searchClear.addEventListener('click', () => {
      this.els.searchInput.value = '';
      this.els.searchResults.innerHTML = '<p class="no-results">พิมพ์เพื่อเริ่มค้นหา...</p>';
    });
    
    this.els.filterTitleOnly.addEventListener('change', () => this._handleSearch());
    this.els.sortBy.addEventListener('change', () => this._handleSearch());
    
    // Graph controls
    document.getElementById('graph-zoom-in')?.addEventListener('click', () => this.graph?.zoomIn());
    document.getElementById('graph-zoom-out')?.addEventListener('click', () => this.graph?.zoomOut());
    document.getElementById('graph-reset')?.addEventListener('click', () => this.graph?.resetView());
    
    // Modal
    this.els.modalClose.addEventListener('click', () => this._hideModal());
    this.els.modalDelete.addEventListener('click', () => this._handleDeleteNode());
    this.els.modalEdit.addEventListener('click', () => this._handleEditNode());
    
    // Close modal on backdrop click
    this.els.nodeModal.addEventListener('click', (e) => {
      if (e.target === this.els.nodeModal) this._hideModal();
    });
    
    // Settings
    this.els.settingAutoDetect.addEventListener('change', async () => {
      await this.db.setSetting('autoDetectJunk', this.els.settingAutoDetect.checked);
    });
    
    this.els.settingJunkThreshold.addEventListener('input', () => {
      this.els.thresholdValue.textContent = this.els.settingJunkThreshold.value;
      JunkDetector.MIN_WEIGHT_THRESHOLD = parseInt(this.els.settingJunkThreshold.value);
      this.db.setSetting('junkThreshold', this.els.settingJunkThreshold.value);
    });
    
    document.getElementById('btn-run-detect')?.addEventListener('click', () => this._runJunkDetection());
    document.getElementById('btn-export-data')?.addEventListener('click', () => this._exportData());
    document.getElementById('btn-import-data')?.addEventListener('click', () => this._importData());
    document.getElementById('btn-clear-all')?.addEventListener('click', () => this._handleClearAll());
    
    // Keyboard shortcut for search
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        this._switchTab('search');
        this.els.searchInput.focus();
      }
    });
  }

  // ==================== TAB MANAGEMENT ====================

  _switchTab(tabName) {
    this.currentTab = tabName;
    
    // Update tab buttons
    this.els.tabButtons.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    
    // Update tab contents
    this.els.tabContents.forEach(content => {
      content.classList.toggle('active', content.id === `tab-${tabName}`);
    });
    
    // Tab-specific refresh
    if (tabName === 'graph') {
      this._refreshGraph();
    } else if (tabName === 'home') {
      this._refreshHomeStats();
    } else if (tabName === 'settings') {
      this._refreshSystemStats();
    }
  }

  // ==================== DATA OPERATIONS ====================

  async _handleAddNode() {
    const title = this.els.inputTitle.value.trim();
    const content = this.els.inputContent.value.trim();
    const tagsString = this.els.inputTags.value.trim();
    const linksString = this.els.inputLinks.value.trim();
    
    if (!title && !content) {
      this._showMessage('add-message', 'กรุณาป้อนหัวข้อหรือเนื้อหา', 'error');
      return;
    }
    
    try {
      const tags = tagsString ? tagsString.split(',').map(t => t.trim()).filter(Boolean) : [];
      const linkIds = linksString ? linksString.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id)) : [];
      
      // Add the node
      const nodeId = await this.db.addNode({
        title: title || 'Untitled',
        content: content,
        tags: tags
      });
      
      // Create edges for linked nodes
      for (const targetId of linkIds) {
        const target = await this.db.getNode(targetId);
        if (target) {
          await this.db.addEdge(nodeId, targetId, 5);
          await UpdateEngine.boostFromLink(targetId);
        }
      }
      
      // Clear form
      this.els.addForm.reset();
      this.els.contentCharCount.textContent = '0/5000';
      
      this._showMessage('add-message', `บันทึกข้อมูลสำเร็จ (ID: ${nodeId})`, 'success');
      this._showToast('บันทึกข้อมูลสำเร็จ ✅', 'success');
      
      await this._refreshAllViews();
      
    } catch (error) {
      console.error('[App] Add node failed:', error);
      this._showMessage('add-message', 'เกิดข้อผิดพลาดในการบันทึกข้อมูล', 'error');
    }
  }

  async _handleSearch() {
    const query = this.els.searchInput.value.trim();
    
    if (!query) {
      this.els.searchResults.innerHTML = '<p class="no-results">พิมพ์เพื่อเริ่มค้นหา...</p>';
      return;
    }
    
    try {
      const results = await SearchEngine.search(query, {
        titleOnly: this.els.filterTitleOnly.checked,
        sortBy: this.els.sortBy.value
      });
      
      if (results.length === 0) {
        this.els.searchResults.innerHTML = `<p class="no-results">ไม่พบผลลัพธ์สำหรับ "${this._escapeHtml(query)}"</p>`;
        return;
      }
      
      this.els.searchResults.innerHTML = results.map(node => `
        <div class="search-result-item" onclick="app._showNodeDetail(${node.id})">
          <div class="search-result-title">${this._escapeHtml(node.title || 'Untitled')}</div>
          <div class="search-result-snippet">${node.snippet || ''}</div>
          <div class="search-result-score">
            ⚖️ Score: ${node.searchScore} | 🔥 Weight: ${node.weight || 0}
          </div>
        </div>
      `).join('');
      
    } catch (error) {
      console.error('[App] Search failed:', error);
      this.els.searchResults.innerHTML = '<p class="no-results">เกิดข้อผิดพลาดในการค้นหา</p>';
    }
  }

  async _showNodeDetail(nodeId) {
    try {
      const node = await this.db.getNode(nodeId);
      if (!node) {
        this._showToast('ไม่พบข้อมูลที่ระบุ', 'error');
        return;
      }
      
      // Record access
      await UpdateEngine.recordAccess(nodeId);
      
      // Get related nodes
      const related = await SearchEngine.findRelated(nodeId, 5);
      
      // Get connections
      const edges = await this.db.getEdgesForNode(nodeId);
      const connectedNodeIds = edges.map(e => e.sourceId === nodeId ? e.targetId : e.sourceId);
      const connectedNodes = [];
      for (const cid of connectedNodeIds) {
        const cn = await this.db.getNode(cid);
        if (cn) connectedNodes.push(cn);
      }
      
      this.selectedNodeId = nodeId;
      
      this.els.modalTitle.textContent = node.title || 'Untitled';
      this.els.modalBody.innerHTML = `
        <div class="node-detail">
          <div class="detail-meta">
            <span class="badge weight-badge">🔥 Weight: ${node.weight || 0}</span>
            <span class="badge access-badge">👁️ Accessed: ${node.accessCount || 0}x</span>
            <span class="badge date-badge">📅 ${new Date(node.updatedAt).toLocaleDateString('th-TH')}</span>
          </div>
          
          ${node.tags && node.tags.length > 0 ? `
            <div class="detail-tags">
              ${node.tags.map(t => `<span class="tag">#${this._escapeHtml(t)}</span>`).join(' ')}
            </div>
          ` : ''}
          
          <div class="detail-content">
            ${this._escapeHtml(node.content || 'ไม่มีเนื้อหา').replace(/\n/g, '<br>')}
          </div>
          
          ${connectedNodes.length > 0 ? `
            <div class="detail-connections">
              <h4>🔗 เชื่อมโยงกับ</h4>
              <div class="connection-list">
                ${connectedNodes.map(cn => `
                  <span class="connection-chip" onclick="app._showNodeDetail(${cn.id}); event.stopPropagation();">
                    ${this._escapeHtml(cn.title || '?')} (🔥${cn.weight || 0})
                  </span>
                `).join('')}
              </div>
            </div>
          ` : ''}
          
          ${related.length > 0 ? `
            <div class="detail-related">
              <h4>💡 ข้อมูลที่เกี่ยวข้อง</h4>
              <div class="connection-list">
                ${related.slice(0, 3).map(rn => `
                  <span class="connection-chip related" onclick="app._showNodeDetail(${rn.id}); event.stopPropagation();">
                    ${this._escapeHtml(rn.title || '?')}
                  </span>
                `).join('')}
              </div>
            </div>
          ` : ''}
        </div>
      `;
      
      this.els.nodeModal.classList.remove('hidden');
      
    } catch (error) {
      console.error('[App] Show detail failed:', error);
      this._showToast('เกิดข้อผิดพลาดในการแสดงข้อมูล', 'error');
    }
  }

  _hideModal() {
    this.els.nodeModal.classList.add('hidden');
    this.selectedNodeId = null;
  }

  async _handleDeleteNode() {
    if (!this.selectedNodeId) return;
    
    if (!confirm('คุณแน่ใจที่จะลบข้อมูลนี้? การกระทำนี้ไม่สามารถย้อนกลับได้')) return;
    
    try {
      await this.db.deleteNode(this.selectedNodeId);
      this._hideModal();
      this._showToast('ลบข้อมูลสำเร็จ 🗑️', 'success');
      await this._refreshAllViews();
    } catch (error) {
      console.error('[App] Delete failed:', error);
      this._showToast('เกิดข้อผิดพลาดในการลบข้อมูล', 'error');
    }
  }

  async _handleEditNode() {
    if (!this.selectedNodeId) return;
    
    const node = await this.db.getNode(this.selectedNodeId);
    if (!node) return;
    
    const newTitle = prompt('แก้ไขหัวข้อ:', node.title);
    if (newTitle === null) return; // Cancelled
    
    const newContent = prompt('แก้ไขเนื้อหา:', node.content);
    if (newContent === null) return;
    
    const newTags = prompt('แก้ไขแท็ก (คั่นด้วยคอมม่า):', (node.tags || []).join(', '));
    if (newTags === null) return;
    
    try {
      await this.db.updateNode(this.selectedNodeId, {
        title: newTitle.trim() || node.title,
        content: newContent.trim(),
        tags: newTags.split(',').map(t => t.trim()).filter(Boolean)
      });
      
      this._hideModal();
      this._showToast('อัปเดตข้อมูลสำเร็จ ✏️', 'success');
      await this._refreshAllViews();
    } catch (error) {
      this._showToast('เกิดข้อผิดพลาดในการแก้ไข', 'error');
    }
  }

  // ==================== VIEW REFRESHES ====================

  async _refreshAllViews() {
    await Promise.all([
      this._refreshHomeStats(),
      this._refreshGraph()
    ]);
  }

  async _refreshHomeStats() {
    try {
      const stats = await this.db.getStats();
      
      this.els.nodeCount.textContent = `${stats.totalNodes} nodes`;
      this.els.edgeCount.textContent = `${stats.totalEdges} links`;
      this.els.statTotalNodes.textContent = stats.totalNodes;
      this.els.statHotNodes.textContent = stats.hotNodes;
      this.els.statTotalEdges.textContent = stats.totalEdges;
      
      // Recent nodes
      const nodes = await this.db.getAllNodes();
      const recent = nodes
        .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
        .slice(0, 10);
      
      if (recent.length === 0) {
        this.els.recentList.innerHTML = '<p style="color: #5c6bc0; text-align: center; padding: 20px;">ยังไม่มีข้อมูล เริ่มเพิ่มข้อมูลแรกของคุณ!</p>';
      } else {
        this.els.recentList.innerHTML = recent.map(node => `
          <div class="node-item" onclick="app._showNodeDetail(${node.id})">
            <span class="node-item-title">${this._escapeHtml(node.title || 'Untitled')}</span>
            <span class="node-item-meta">
              <span class="node-weight-badge">🔥 ${node.weight || 0}</span>
              <span class="node-date">${new Date(node.updatedAt).toLocaleDateString('th-TH')}</span>
            </span>
          </div>
        `).join('');
      }
    } catch (error) {
      console.error('[App] Refresh stats failed:', error);
    }
  }

  async _refreshGraph() {
    try {
      const nodes = await this.db.getAllNodes();
      const edges = await this.db.getAllEdges();
      
      if (this.graph) {
        this.graph.setData(nodes, edges);
      }
      
      if (this.els.graphInfo) {
        this.els.graphInfo.textContent = `${nodes.length} nodes · ${edges.length} edges`;
      }
    } catch (error) {
      console.error('[App] Refresh graph failed:', error);
    }
  }

  async _refreshSystemStats() {
    try {
      const stats = await this.db.getStats();
      const junkStats = await JunkDetector.getJunkStats();
      
      this.els.systemStats.innerHTML = `
        <p>📊 <strong>ข้อมูลทั้งหมด:</strong> ${stats.totalNodes} nodes</p>
        <p>🔗 <strong>ความเชื่อมโยง:</strong> ${stats.totalEdges} edges</p>
        <p>📈 <strong>น้ำหนักเฉลี่ย:</strong> ${stats.avgWeight}</p>
        <p>🔥 <strong>ข้อมูลยอดนิยม:</strong> ${stats.hotNodes} nodes</p>
        <p>👁️ <strong>การเข้าถึงทั้งหมด:</strong> ${stats.totalAccesses} ครั้ง</p>
        <p>🗑️ <strong>ข้อมูลขยะที่พบ:</strong> ${junkStats.junkCount} nodes (${junkStats.junkPercentage}%)</p>
        <p>💾 <strong>ขนาดฐานข้อมูล:</strong> ${(stats.dbSize / 1024).toFixed(1)} KB</p>
      `;
    } catch (error) {
      this.els.systemStats.innerHTML = '<p>ไม่สามารถโหลดสถิติได้</p>';
    }
  }

  // ==================== JUNK DETECTION ====================

  async _autoDetectJunk() {
    try {
      const report = await JunkDetector.autoClean(false);
      if (report.deleted > 0) {
        console.log(`[App] Auto-cleaned ${report.deleted} junk nodes`);
        await this._refreshAllViews();
      }
    } catch (error) {
      console.error('[App] Auto junk detection failed:', error);
    }
  }

  async _runJunkDetection() {
    this._showMessage('settings-message', 'กำลังตรวจหาข้อมูลขยะ...', '');
    
    try {
      const report = await JunkDetector.autoClean(false);
      
      if (report.deleted > 0) {
        this._showMessage('settings-message', `ลบข้อมูลขยะแล้ว ${report.deleted} รายการ ✅`, 'success');
        this._showToast(`ลบขยะ ${report.deleted} รายการ`, 'success');
        await this._refreshAllViews();
      } else {
        this._showMessage('settings-message', 'ไม่พบข้อมูลขยะ ฐานข้อมูลสะอาดดี 🎉', 'success');
      }
    } catch (error) {
      this._showMessage('settings-message', 'เกิดข้อผิดพลาดในการตรวจจับ', 'error');
    }
  }

  // ==================== IMPORT/EXPORT ====================

  async _exportData() {
    try {
      const json = await this.db.exportData();
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const a = document.createElement('a');
      a.href = url;
      a.download = `ata-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      
      URL.revokeObjectURL(url);
      this._showToast('ส่งออกข้อมูลสำเร็จ 📤', 'success');
    } catch (error) {
      this._showToast('ส่งออกข้อมูลล้มเหลว', 'error');
    }
  }

  async _importData() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      try {
        const text = await file.text();
        await this.db.importData(text);
        this._showToast('นำเข้าข้อมูลสำเร็จ 📥', 'success');
        await this._refreshAllViews();
      } catch (error) {
        this._showToast('ไฟล์ไม่ถูกต้องหรือรูปแบบไม่รองรับ', 'error');
      }
    };
    
    input.click();
  }

  async _handleClearAll() {
    if (!confirm('⚠️ คำเตือน: การกระทำนี้จะลบข้อมูลทั้งหมดอย่างถาวร!\n\nคุณ
