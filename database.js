/**
 * A.T.A Database Module
 * IndexedDB wrapper for knowledge graph storage
 * Complexity: All CRUD operations O(1) for single record, O(n) for getAll
 */

class ATADatabase {
  constructor() {
    this.DB_NAME = 'ata_knowledge_base';
    this.DB_VERSION = 2; // Increment when schema changes
    this.db = null;
    this._initPromise = null;
  }

  /**
   * Initialize database connection
   * Uses singleton pattern to prevent multiple connections
   */
  async init() {
    if (this.db) return this.db;
    if (this._initPromise) return this._initPromise;

    this._initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        console.log('[DB] Upgrading schema to version', this.DB_VERSION);

        // Create 'nodes' object store
        if (!db.objectStoreNames.contains('nodes')) {
          const nodesStore = db.createObjectStore('nodes', {
            keyPath: 'id',
            autoIncrement: true
          });
          nodesStore.createIndex('title', 'title', { unique: false });
          nodesStore.createIndex('weight', 'weight', { unique: false });
          nodesStore.createIndex('updatedAt', 'updatedAt', { unique: false });
          nodesStore.createIndex('createdAt', 'createdAt', { unique: false });
          console.log('[DB] Created nodes store');
        }

        // Create 'edges' object store
        if (!db.objectStoreNames.contains('edges')) {
          const edgesStore = db.createObjectStore('edges', {
            keyPath: 'id',
            autoIncrement: true
          });
          edgesStore.createIndex('sourceId', 'sourceId', { unique: false });
          edgesStore.createIndex('targetId', 'targetId', { unique: false });
          edgesStore.createIndex('strength', 'strength', { unique: false });
          console.log('[DB] Created edges store');
        }

        // Create 'settings' object store (key-value)
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings', { keyPath: 'key' });
          console.log('[DB] Created settings store');
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        
        // Handle database close (e.g., disk full)
        this.db.onclose = () => {
          console.warn('[DB] Database closed unexpectedly');
          this.db = null;
          this._initPromise = null;
        };

        console.log('[DB] Initialized successfully');
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error('[DB] Initialization failed:', event.target.error);
        reject(event.target.error);
      };

      request.onblocked = () => {
        console.warn('[DB] Database blocked - close other tabs');
        reject(new Error('Database blocked by another connection'));
      };
    });

    return this._initPromise;
  }

  /**
   * Get transaction helper
   * @param {string|string[]} storeNames
   * @param {IDBTransactionMode} mode
   */
  async getStore(storeName, mode = 'readonly') {
    if (!this.db) await this.init();
    const tx = this.db.transaction(storeName, mode);
    return tx.objectStore(storeName);
  }

  // ==================== NODE CRUD ====================

  /**
   * Add a new knowledge node
   * O(1)
   */
  async addNode(nodeData) {
    const store = await this.getStore('nodes', 'readwrite');
    const now = new Date().toISOString();
    
    const node = {
      title: nodeData.title || 'Untitled',
      content: nodeData.content || '',
      tags: nodeData.tags || [],
      weight: 0, // Initial weight
      accessCount: 0,
      createdAt: now,
      updatedAt: now
    };

    return new Promise((resolve, reject) => {
      const request = store.add(node);
      request.onsuccess = () => resolve(request.result); // Returns new ID
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get node by ID
   * O(1)
   */
  async getNode(id) {
    const store = await this.getStore('nodes');
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all nodes
   * O(n) where n = number of nodes
   */
  async getAllNodes() {
    const store = await this.getStore('nodes');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Update node
   * O(1)
   */
  async updateNode(id, updates) {
    const store = await this.getStore('nodes', 'readwrite');
    
    return new Promise((resolve, reject) => {
      const getRequest = store.get(id);
      
      getRequest.onsuccess = () => {
        const node = getRequest.result;
        if (!node) {
          reject(new Error(`Node ${id} not found`));
          return;
        }
        
        Object.assign(node, updates, {
          updatedAt: new Date().toISOString()
        });
        
        const putRequest = store.put(node);
        putRequest.onsuccess = () => resolve(node);
        putRequest.onerror = () => reject(putRequest.error);
      };
      
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Delete node and its associated edges
   * O(n) where n = number of edges (due to edge cleanup)
   */
  async deleteNode(id) {
    const nodeStore = await this.getStore('nodes', 'readwrite');
    const edgeStore = await this.getStore('edges', 'readwrite');
    
    return new Promise((resolve, reject) => {
      const deleteNodeRequest = nodeStore.delete(id);
      
      deleteNodeRequest.onsuccess = async () => {
        // Clean up orphaned edges
        try {
          await this._deleteEdgesForNode(id);
          resolve(true);
        } catch (err) {
          reject(err);
        }
      };
      
      deleteNodeRequest.onerror = () => reject(deleteNodeRequest.error);
    });
  }

  /**
   * Record access to a node (increment weight)
   * O(1)
   */
  async accessNode(id) {
    const node = await this.getNode(id);
    if (!node) return null;
    
    const newWeight = Math.min(node.weight + 1, 100);
    const newAccessCount = (node.accessCount || 0) + 1;
    
    return this.updateNode(id, {
      weight: newWeight,
      accessCount: newAccessCount
    });
  }

  // ==================== EDGE CRUD ====================

  /**
   * Add a connection between two nodes
   * O(1)
   */
  async addEdge(sourceId, targetId, strength = 1) {
    const store = await this.getStore('edges', 'readwrite');
    
    // Check for existing edge
    const existing = await this._findEdge(sourceId, targetId);
    if (existing) {
      // Strengthen existing connection
      return this.updateEdge(existing.id, {
        strength: Math.min(existing.strength + strength, 100)
      });
    }
    
    const edge = {
      sourceId,
      targetId,
      strength,
      createdAt: new Date().toISOString()
    };
    
    return new Promise((resolve, reject) => {
      const request = store.add(edge);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get all edges
   * O(n)
   */
  async getAllEdges() {
    const store = await this.getStore('edges');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Get edges connected to a specific node
   * O(n) where n = total edges (full scan)
   */
  async getEdgesForNode(nodeId) {
    const allEdges = await this.getAllEdges();
    return allEdges.filter(e => e.sourceId === nodeId || e.targetId === nodeId);
  }

  /**
   * Update edge
   * O(1)
   */
  async updateEdge(id, updates) {
    const store = await this.getStore('edges', 'readwrite');
    
    return new Promise((resolve, reject) => {
      const getRequest = store.get(id);
      
      getRequest.onsuccess = () => {
        const edge = getRequest.result;
        if (!edge) {
          reject(new Error(`Edge ${id} not found`));
          return;
        }
        
        Object.assign(edge, updates);
        const putRequest = store.put(edge);
        putRequest.onsuccess = () => resolve(edge);
        putRequest.onerror = () => reject(putRequest.error);
      };
      
      getRequest.onerror = () => reject(getRequest.error);
    });
  }

  /**
   * Delete edge
   * O(1)
   */
  async deleteEdge(id) {
    const store = await this.getStore('edges', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Find edge between two nodes (undirected)
   * O(n) - could be optimized with compound index
   */
  async _findEdge(sourceId, targetId) {
    const allEdges = await this.getAllEdges();
    return allEdges.find(
      e => (e.sourceId === sourceId && e.targetId === targetId) ||
           (e.sourceId === targetId && e.targetId === sourceId)
    ) || null;
  }

  /**
   * Delete all edges for a given node
   * @private
   */
  async _deleteEdgesForNode(nodeId) {
    const allEdges = await this.getAllEdges();
    const toDelete = allEdges.filter(
      e => e.sourceId === nodeId || e.targetId === nodeId
    );
    
    for (const edge of toDelete) {
      await this.deleteEdge(edge.id);
    }
    
    return toDelete.length;
  }

  // ==================== SETTINGS ====================

  async getSetting(key) {
    const store = await this.getStore('settings');
    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result?.value ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  async setSetting(key, value) {
    const store = await this.getStore('settings', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.put({ key, value });
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error);
    });
  }

  // ==================== STATISTICS ====================

  async getStats() {
    const nodes = await this.getAllNodes();
    const edges = await this.getAllEdges();
    
    return {
      totalNodes: nodes.length,
      totalEdges: edges.length,
      avgWeight: nodes.length > 0
        ? Math.round(nodes.reduce((s, n) => s + (n.weight || 0), 0) / nodes.length)
        : 0,
      hotNodes: nodes.filter(n => (n.weight || 0) > 50).length,
      totalAccesses: nodes.reduce((s, n) => s + (n.accessCount || 0), 0),
      dbSize: JSON.stringify({ nodes, edges }).length
    };
  }

  /**
   * WARNING: Deletes ALL data. Cannot be undone.
   */
  async clearAll() {
    const nodeStore = await this.getStore('nodes', 'readwrite');
    const edgeStore = await this.getStore('edges', 'readwrite');
    
    await new Promise((resolve, reject) => {
      const req1 = nodeStore.clear();
      req1.onsuccess = resolve;
      req1.onerror = reject;
    });
    
    await new Promise((resolve, reject) => {
      const req2 = edgeStore.clear();
      req2.onsuccess = resolve;
      req2.onerror = reject;
    });
    
    console.log('[DB] All data cleared');
    return true;
  }

  /**
   * Export all data as JSON
   */
  async exportData() {
    const nodes = await this.getAllNodes();
    const edges = await this.getAllEdges();
    return JSON.stringify({ nodes, edges, exportDate: new Date().toISOString() }, null, 2);
  }

  /**
   * Import data from JSON
   */
  async importData(jsonString) {
    const data = JSON.parse(jsonString);
    
    if (!data.nodes || !Array.isArray(data.nodes)) {
      throw new Error('Invalid import format: missing nodes array');
    }
    
    for (const node of data.nodes) {
      const { id, ...nodeData } = node; // Strip old ID, let autoIncrement assign new
      await this.addNode(nodeData);
    }
    
    if (data.edges && Array.isArray(data.edges)) {
      for (const edge of data.edges) {
        const { id, ...edgeData } = edge;
        await this.addEdge(edgeData.sourceId, edgeData.targetId, edgeData.strength);
      }
    }
    
    return true;
  }
}

// Singleton instance
const db = new ATADatabase();
