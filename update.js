/**
 * A.T.A Update Module
 * Handles weight adjustments, access tracking,
 * and periodic data maintenance
 */

const UpdateEngine = {
  DECAY_RATE: 0.01,        // Weight decay per day
  MAX_WEIGHT: 100,
  MIN_WEIGHT: 0,
  BOOST_ON_ACCESS: 1,      // Weight increment per access
  BOOST_ON_LINK: 2,        // Weight increment when linked

  /**
   * Record an access to a node and boost its weight
   * @param {number} nodeId
   */
  async recordAccess(nodeId) {
    const node = await db.getNode(nodeId);
    if (!node) return null;

    const newWeight = Math.min(
      (node.weight || 0) + this.BOOST_ON_ACCESS,
      this.MAX_WEIGHT
    );
    
    const newAccessCount = (node.accessCount || 0) + 1;
    
    return db.updateNode(nodeId, {
      weight: newWeight,
      accessCount: newAccessCount,
      lastAccessedAt: new Date().toISOString()
    });
  },

  /**
   * Boost weight when a connection is created
   * @param {number} nodeId
   */
  async boostFromLink(nodeId) {
    const node = await db.getNode(nodeId);
    if (!node) return null;

    const newWeight = Math.min(
      (node.weight || 0) + this.BOOST_ON_LINK,
      this.MAX_WEIGHT
    );
    
    return db.updateNode(nodeId, { weight: newWeight });
  },

  /**
   * Apply time-based decay to all nodes
   * Older nodes with no recent access lose weight gradually
   * Complexity: O(n) - should be called periodically, not on every request
   */
  async applyDecay() {
    const nodes = await db.getAllNodes();
    const now = new Date();
    const updates = [];

    for (const node of nodes) {
      const lastAccess = node.lastAccessedAt 
        ? new Date(node.lastAccessedAt) 
        : new Date(node.updatedAt);
      
      const daysSinceAccess = (now - lastAccess) / (1000 * 60 * 60 * 24);
      
      if (daysSinceAccess > 7) { // Start decay after 7 days
        const decayAmount = Math.floor(daysSinceAccess * this.DECAY_RATE);
        const newWeight = Math.max(
          (node.weight || 0) - decayAmount,
          this.MIN_WEIGHT
        );
        
        if (newWeight !== node.weight) {
          updates.push(
            db.updateNode(node.id, { weight: newWeight })
          );
        }
      }
    }

    await Promise.all(updates);
    console.log(`[Update] Decay applied to ${updates.length} nodes`);
    return updates.length;
  },

  /**
   * Strengthen edges between nodes with shared tags or content
   * Complexity: O(n²) worst case - use sparingly
   */
  async strengthenSemanticLinks() {
    const nodes = await db.getAllNodes();
    const edges = await db.getAllEdges();
    
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const nodeA = nodes[i];
        const nodeB = nodes[j];
        
        // Calculate tag overlap
        const tagsA = new Set(nodeA.tags || []);
        const tagsB = new Set(nodeB.tags || []);
        const commonTags = [...tagsA].filter(t => tagsB.has(t));
        
        if (commonTags.length > 0) {
          // Check if edge already exists
          const existingEdge = edges.find(e =>
            (e.sourceId === nodeA.id && e.targetId === nodeB.id) ||
            (e.sourceId === nodeB.id && e.targetId === nodeA.id)
          );
          
          if (existingEdge) {
            // Strengthen existing
            await db.updateEdge(existingEdge.id, {
              strength: Math.min((existingEdge.strength || 0) + commonTags.length, 100)
            });
          } else {
            // Create new semantic link
            await db.addEdge(nodeA.id, nodeB.id, commonTags.length * 10);
          }
        }
      }
    }
    
    console.log('[Update] Semantic links strengthened');
  },

  /**
   * Recalculate all edge strengths based on current node data
   * Useful after major data changes
   */
  async recalculateAllStrengths() {
    const edges = await db.getAllEdges();
    
    for (const edge of edges) {
      const source = await db.getNode(edge.sourceId);
      const target = await db.getNode(edge.targetId);
      
      if (!source || !target) {
        // Orphaned edge - mark for deletion
        await db.deleteEdge(edge.id);
        continue;
      }
      
      // Strength based on shared tags
      const sourceTags = new Set(source.tags || []);
      const targetTags = new Set(target.tags || []);
      const sharedTags = [...sourceTags].filter(t => targetTags.has(t));
      
      const newStrength = Math.min(
        sharedTags.length * 15 + (edge.strength || 0) * 0.5,
        100
      );
      
      await db.updateEdge(edge.id, { strength: newStrength });
    }
  },

  /**
   * Periodic maintenance task
   * Combines decay + recalculation
   */
  async performMaintenance() {
    console.log('[Update] Starting maintenance...');
    
    const decayCount = await this.applyDecay();
    await this.strengthenSemanticLinks();
    
    console.log(`[Update] Maintenance complete. ${decayCount} nodes decayed.`);
    
    return {
      decayedNodes: decayCount,
      timestamp: new Date().toISOString()
    };
  },

  /**
   * Schedule periodic maintenance
   * @param {number} intervalHours
   */
  scheduleMaintenance(intervalHours = 24) {
    const intervalMs = intervalHours * 60 * 60 * 1000;
    
    // Check if maintenance is needed on app start
    this._checkAndRunMaintenance();
    
    // Schedule periodic check
    setInterval(() => {
      this._checkAndRunMaintenance();
    }, intervalMs);
  },

  async _checkAndRunMaintenance() {
    const lastMaintenance = await db.getSetting('lastMaintenance');
    const now = new Date().toISOString();
    
    if (!lastMaintenance) {
      await this.performMaintenance();
      await db.setSetting('lastMaintenance', now);
      return;
    }
    
    const hoursSince = (new Date(now) - new Date(lastMaintenance)) / (1000 * 60 * 60);
    if (hoursSince >= 24) {
      await this.performMaintenance();
      await db.setSetting('lastMaintenance', now);
    }
  }
};
