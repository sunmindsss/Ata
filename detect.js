/**
 * A.T.A Junk Detection Module
 * Identifies and removes low-quality, duplicate,
 * or abandoned data nodes
 */

const JunkDetector = {
  // Thresholds (configurable)
  MIN_CONTENT_LENGTH: 10,        // Minimum meaningful content length
  MAX_DUPLICATE_SIMILARITY: 0.9, // Similarity threshold for duplicates
  MIN_WEIGHT_THRESHOLD: 2,       // Nodes below this weight are candidates
  MAX_AGE_WITHOUT_ACCESS: 30,    // Days without access before considered stale
  MIN_TITLE_LENGTH: 2,           // Minimum title length

  /**
   * Run comprehensive junk detection
   * @returns {Object} Detection report
   */
  async detectAll() {
    const nodes = await db.getAllNodes();
    const junkIds = new Set();
    const reasons = {};

    // Run all detectors
    await this._detectEmptyContent(nodes, junkIds, reasons);
    await this._detectDuplicates(nodes, junkIds, reasons);
    await this._detectLowWeightStale(nodes, junkIds, reasons);
    await this._detectInvalidTitles(nodes, junkIds, reasons);
    await this._detectOrphanedNodes(nodes, junkIds, reasons);

    return {
      totalNodes: nodes.length,
      junkCount: junkIds.size,
      junkIds: [...junkIds],
      reasons,
      safeNodes: nodes.filter(n => !junkIds.has(n.id))
    };
  },

  /**
   * Auto-clean: Detect and remove all junk
   * @param {boolean} dryRun - If true, only report without deleting
   */
  async autoClean(dryRun = false) {
    const report = await this.detectAll();
    
    if (!dryRun && report.junkCount > 0) {
      for (const id of report.junkIds) {
        await db.deleteNode(id);
      }
    }
    
    return {
      ...report,
      deleted: dryRun ? 0 : report.junkCount,
      dryRun
    };
  },

  /**
   * Detect nodes with empty or near-empty content
   * @private
   */
  async _detectEmptyContent(nodes, junkIds, reasons) {
    for (const node of nodes) {
      const content = (node.content || '').trim();
      const title = (node.title || '').trim();
      
      if (!title && !content) {
        junkIds.add(node.id);
        reasons[node.id] = 'Empty title and content';
      } else if (content.length < this.MIN_CONTENT_LENGTH && !title) {
        junkIds.add(node.id);
        reasons[node.id] = `Content too short (${content.length} chars) with no title`;
      }
    }
  },

  /**
   * Detect duplicate nodes using content similarity
   * @private
   * Complexity: O(n²) worst case
   */
  async _detectDuplicates(nodes, junkIds, reasons) {
    const checked = new Set();

    for (let i = 0; i < nodes.length; i++) {
      if (junkIds.has(nodes[i].id) || checked.has(nodes[i].id)) continue;
      
      for (let j = i + 1; j < nodes.length; j++) {
        if (junkIds.has(nodes[j].id) || checked.has(nodes[j].id)) continue;
        
        const similarity = this._calculateTextSimilarity(
          nodes[i].title + ' ' + nodes[i].content,
          nodes[j].title + ' ' + nodes[j].content
        );
        
        if (similarity >= this.MAX_DUPLICATE_SIMILARITY) {
          // Keep the one with higher weight/access count
          const keep = nodes[i].weight >= nodes[j].weight ? nodes[i] : nodes[j];
          const remove = keep.id === nodes[i].id ? nodes[j] : nodes[i];
          
          junkIds.add(remove.id);
          reasons[remove.id] = `Duplicate of node #${keep.id} (similarity: ${(similarity * 100).toFixed(1)}%)`;
          checked.add(keep.id);
        }
      }
    }
  },

  /**
   * Detect nodes with very low weight and no recent access
   * @private
   */
  async _detectLowWeightStale(nodes, junkIds, reasons) {
    const now = new Date();
    
    for (const node of nodes) {
      if (junkIds.has(node.id)) continue;
      
      const weight = node.weight || 0;
      if (weight > this.MIN_WEIGHT_THRESHOLD) continue;
      
      const lastAccess = node.lastAccessedAt 
        ? new Date(node.lastAccessedAt) 
        : new Date(node.createdAt);
      
      const daysSinceAccess = (now - lastAccess) / (1000 * 60 * 60 * 24);
      
      if (daysSinceAccess > this.MAX_AGE_WITHOUT_ACCESS) {
        junkIds.add(node.id);
        reasons[node.id] = `Low weight (${weight}) and stale (${Math.floor(daysSinceAccess)} days without access)`;
      }
    }
  },

  /**
   * Detect nodes with invalid or gibberish titles
   * @private
   */
  async _detectInvalidTitles(nodes, junkIds, reasons) {
    for (const node of nodes) {
      if (junkIds.has(node.id)) continue;
      
      const title = (node.title || '').trim();
      
      // Too short
      if (title.length < this.MIN_TITLE_LENGTH && title.length > 0) {
        junkIds.add(node.id);
        reasons[node.id] = `Title too short: "${title}"`;
        continue;
      }
      
      // Gibberish detection: high ratio of non-alphanumeric characters
      if (title.length > 0) {
        const alphaNum = title.replace(/[^a-zA-Z0-9\u0E00-\u0E7F\s]/g, '').length;
        const ratio = alphaNum / title.length;
        
        if (ratio < 0.4) {
          junkIds.add(node.id);
          reasons[node.id] = `Suspected gibberish title (valid char ratio: ${(ratio * 100).toFixed(1)}%)`;
        }
      }
    }
  },

  /**
   * Detect orphaned nodes (no connections, very low weight)
   * @private
   */
  async _detectOrphanedNodes(nodes, junkIds, reasons) {
    const edges = await db.getAllEdges();
    const connectedIds = new Set();
    
    for (const edge of edges) {
      connectedIds.add(edge.sourceId);
      connectedIds.add(edge.targetId);
    }
    
    for (const node of nodes) {
      if (junkIds.has(node.id)) continue;
      
      const isOrphaned = !connectedIds.has(node.id);
      const isLowWeight = (node.weight || 0) <= 1;
      const isOld = (new Date() - new Date(node.createdAt)) > (7 * 24 * 60 * 60 * 1000);
      
      if (isOrphaned && isLowWeight && isOld) {
        junkIds.add(node.id);
        reasons[node.id] = 'Orphaned node with no connections and very low weight';
      }
    }
  },

  /**
   * Calculate Jaccard similarity between two texts
   * @private
   */
  _calculateTextSimilarity(textA, textB) {
    const wordsA = new Set(textA.toLowerCase().split(/\s+/).filter(w => w.length > 1));
    const wordsB = new Set(textB.toLowerCase().split(/\s+/).filter(w => w.length > 1));
    
    if (wordsA.size === 0 && wordsB.size === 0) return 1;
    if (wordsA.size === 0 || wordsB.size === 0) return 0;
    
    const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
    const union = new Set([...wordsA, ...wordsB]);
    
    return intersection.size / union.size;
  },

  /**
   * Get junk detection statistics without deleting
   */
  async getJunkStats() {
    const report = await this.detectAll();
    return {
      totalNodes: report.totalNodes,
      junkCount: report.junkCount,
      healthyCount: report.totalNodes - report.junkCount,
      junkPercentage: report.totalNodes > 0 
        ? Math.round((report.junkCount / report.totalNodes) * 100) 
        : 0,
      reasons: report.reasons
    };
  }
};
