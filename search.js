/**
 * A.T.A Search Module
 * Implements TF-IDF inspired ranking with weight boost
 * Complexity: O(n * m) where n = nodes, m = query terms
 */

const SearchEngine = {
  /**
   * Search nodes by query string
   * @param {string} query - Search query
   * @param {Object} options - { titleOnly, sortBy }
   * @returns {Array} Scored and sorted results
   */
  async search(query, options = {}) {
    if (!query || query.trim().length === 0) return [];
    
    const nodes = await db.getAllNodes();
    if (nodes.length === 0) return [];

    const keywords = query.toLowerCase().trim().split(/\s+/);
    const titleOnly = options.titleOnly || false;
    const sortBy = options.sortBy || 'relevance';

    // Score each node
    const scored = nodes.map(node => ({
      ...node,
      searchScore: this._calculateScore(node, keywords, titleOnly)
    }));

    // Filter zero-score results
    let results = scored.filter(n => n.searchScore > 0);

    // Sort based on option
    switch (sortBy) {
      case 'weight':
        results.sort((a, b) => (b.weight || 0) - (a.weight || 0));
        break;
      case 'date':
        results.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        break;
      case 'relevance':
      default:
        results.sort((a, b) => b.searchScore - a.searchScore);
        break;
    }

    return this._highlightResults(results, keywords);
  },

  /**
   * Calculate relevance score for a single node
   * @private
   */
  _calculateScore(node, keywords, titleOnly) {
    let score = 0;
    const title = (node.title || '').toLowerCase();
    const content = titleOnly ? '' : (node.content || '').toLowerCase();
    const tags = (node.tags || []).join(' ').toLowerCase();

    for (const kw of keywords) {
      // Title matches: 5x multiplier
      const titleMatches = (title.match(new RegExp(this._escapeRegex(kw), 'g')) || []).length;
      score += titleMatches * 5;

      // Exact title match bonus
      if (title === kw) score += 10;

      // Tag matches: 3x multiplier
      const tagMatches = (tags.match(new RegExp(this._escapeRegex(kw), 'g')) || []).length;
      score += tagMatches * 3;

      // Content matches: 1x multiplier
      if (!titleOnly) {
        const contentMatches = (content.match(new RegExp(this._escapeRegex(kw), 'g')) || []).length;
        score += contentMatches;
      }
    }

    // Weight multiplier: (1 + weight/50) 
    // Node with weight 50 gets 2x boost, weight 100 gets 3x
    const weightMultiplier = 1 + (node.weight || 0) / 50;
    score *= weightMultiplier;

    return Math.round(score * 100) / 100;
  },

  /**
   * Escape special regex characters
   * @private
   */
  _escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  },

  /**
   * Add highlighted snippets to results
   * @private
   */
  _highlightResults(results, keywords) {
    return results.map(node => {
      const content = node.content || '';
      let snippet = '';
      
      // Find first occurrence of any keyword
      let bestIndex = content.length;
      for (const kw of keywords) {
        const idx = content.toLowerCase().indexOf(kw.toLowerCase());
        if (idx >= 0 && idx < bestIndex) {
          bestIndex = idx;
        }
      }
      
      // Extract snippet around the match
      if (bestIndex < content.length) {
        const start = Math.max(0, bestIndex - 40);
        const end = Math.min(content.length, bestIndex + 80);
        snippet = (start > 0 ? '...' : '') + content.substring(start, end) + (end < content.length ? '...' : '');
        
        // Highlight keywords
        for (const kw of keywords) {
          const regex = new RegExp(`(${this._escapeRegex(kw)})`, 'gi');
          snippet = snippet.replace(regex, '<mark>$1</mark>');
        }
      } else {
        snippet = content.substring(0, 120) + (content.length > 120 ? '...' : '');
      }
      
      return { ...node, snippet };
    });
  },

  /**
   * Find related nodes by content similarity
   * @param {number} nodeId 
   * @param {number} limit 
   */
  async findRelated(nodeId, limit = 5) {
    const sourceNode = await db.getNode(nodeId);
    if (!sourceNode) return [];

    const allNodes = await db.getAllNodes();
    const others = allNodes.filter(n => n.id !== nodeId);
    
    // Use title as query to find similar content
    const queryWords = (sourceNode.title || '').split(/\s+/).filter(w => w.length > 2);
    if (queryWords.length === 0) return [];

    const results = others.map(node => ({
      ...node,
      similarityScore: this._calculateSimilarity(sourceNode, node)
    }));

    return results
      .filter(n => n.similarityScore > 0)
      .sort((a, b) => b.similarityScore - a.similarityScore)
      .slice(0, limit);
  },

  /**
   * Calculate similarity between two nodes using Jaccard-like approach
   * @private
   */
  _calculateSimilarity(nodeA, nodeB) {
    const wordsA = new Set([
      ...(nodeA.title || '').toLowerCase().split(/\s+/),
      ...(nodeA.tags || []).map(t => t.toLowerCase())
    ]);
    
    const wordsB = new Set([
      ...(nodeB.title || '').toLowerCase().split(/\s+/),
      ...(nodeB.tags || []).map(t => t.toLowerCase())
    ]);
    
    // Intersection / Union
    const intersection = new Set([...wordsA].filter(x => wordsB.has(x)));
    const union = new Set([...wordsA, ...wordsB]);
    
    if (union.size === 0) return 0;
    return intersection.size / union.size;
  },

  /**
   * Autocomplete suggestions
   * @param {string} prefix 
   * @param {number} limit 
   */
  async autocomplete(prefix, limit = 5) {
    if (!prefix || prefix.length < 2) return [];
    
    const nodes = await db.getAllNodes();
    const lower = prefix.toLowerCase();
    
    const matches = nodes
      .filter(n => (n.title || '').toLowerCase().startsWith(lower))
      .sort((a, b) => (b.weight || 0) - (a.weight || 0))
      .slice(0, limit)
      .map(n => n.title);
    
    return [...new Set(matches)]; // Remove duplicates
  }
};
