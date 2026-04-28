/**
 * A.T.A Knowledge Graph Renderer
 * Force-directed layout with Canvas2D rendering
 * Supports touch interaction, zoom, and pan
 */

class KnowledgeGraph {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = canvasElement.getContext('2d');
    
    // Data
    this.nodes = [];
    this.edges = [];
    
    // Layout state
    this.simulationRunning = false;
    this.simulationIterations = 0;
    this.maxIterations = 300;
    
    // View transform
    this.offsetX = 0;
    this.offsetY = 0;
    this.scale = 1;
    this.minScale = 0.3;
    this.maxScale = 3;
    
    // Interaction state
    this.draggedNode = null;
    this.dragOffsetX = 0;
    this.dragOffsetY = 0;
    this.isPanning = false;
    this.panStartX = 0;
    this.panStartY = 0;
    this.hoveredNode = null;
    
    // Physics constants
    this.repulsionForce = 5000;
    this.attractionForce = 0.01;
    this.damping = 0.9;
    this.minDistance = 30;
    this.maxVelocity = 10;
    
    // Animation
    this.animationId = null;
    this.lastFrameTime = 0;
    this.targetFPS = 30;
    this.frameInterval = 1000 / this.targetFPS;
    
    // Visual settings
    this.nodeRadiusBase = 12;
    this.nodeRadiusWeightScale = 0.4;
    this.edgeBaseWidth = 1;
    this.edgeStrengthScale = 0.08;
    this.glowIntensity = 15;
    
    // Colors
    this.colors = {
      nodeDefault: '#4488ff',
      nodeHot: '#ff6644',
      nodeHover: '#ffffff',
      edgeDefault: 'rgba(100, 150, 255, 0.4)',
      edgeStrong: 'rgba(100, 150, 255, 0.8)',
      background: '#111640',
      text: '#e8eaf6',
      textGlow: '#4488ff'
    };
    
    this._bindEvents();
    this._resizeCanvas();
    window.addEventListener('resize', () => this._resizeCanvas());
  }

  // ==================== PUBLIC API ====================

  /**
   * Load data and initialize layout
   * @param {Array} nodes 
   * @param {Array} edges 
   */
  setData(nodes, edges) {
    // Initialize node positions randomly in a circle
    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2;
    const radius = Math.min(centerX, centerY) * 0.6;
    
    this.nodes = nodes.map((n, i) => ({
      ...n,
      x: centerX + radius * Math.cos((2 * Math.PI * i) / Math.max(nodes.length, 1)),
      y: centerY + radius * Math.sin((2 * Math.PI * i) / Math.max(nodes.length, 1)),
      vx: 0,
      vy: 0
    }));
    
    this.edges = edges;
    
    // Reset view
    this.offsetX = 0;
    this.offsetY = 0;
    this.scale = 1;
    
    // Start simulation
    this.startSimulation();
  }

  /**
   * Start force simulation
   */
  startSimulation() {
    this.simulationRunning = true;
    this.simulationIterations = 0;
    if (!this.animationId) {
      this._animate();
    }
  }

  /**
   * Stop simulation
   */
  stopSimulation() {
    this.simulationRunning = false;
  }

  /**
   * Zoom in
   */
  zoomIn() {
    this._zoom(1.2);
  }

  /**
   * Zoom out
   */
  zoomOut() {
    this._zoom(0.8333);
  }

  /**
   * Reset view
   */
  resetView() {
    this.offsetX = 0;
    this.offsetY = 0;
    this.scale = 1;
    this.startSimulation();
  }

  /**
   * Get node at screen position
   * @param {number} screenX 
   * @param {number} screenY 
   */
  getNodeAt(screenX, screenY) {
    for (const node of this.nodes) {
      const nx = node.x * this.scale + this.offsetX;
      const ny = node.y * this.scale + this.offsetY;
      const radius = this._getNodeRadius(node) * this.scale;
      
      const dx = screenX - nx;
      const dy = screenY - ny;
      
      if (Math.sqrt(dx * dx + dy * dy) <= radius + 8) {
        return node;
      }
    }
    return null;
  }

  /**
   * Highlight a specific node
   * @param {number} nodeId 
   */
  highlightNode(nodeId) {
    this.highlightedId = nodeId;
  }

  /**
   * Clear highlight
   */
  clearHighlight() {
    this.highlightedId = null;
  }

  /**
   * Clean up resources
   */
  destroy() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }
    window.removeEventListener('resize', this._resizeCanvas);
  }

  // ==================== PRIVATE METHODS ====================

  /**
   * Animation loop
   * @private
   */
  _animate(timestamp = 0) {
    this.animationId = requestAnimationFrame((t) => this._animate(t));
    
    const elapsed = timestamp - this.lastFrameTime;
    if (elapsed < this.frameInterval) return;
    this.lastFrameTime = timestamp - (elapsed % this.frameInterval);
    
    if (this.simulationRunning && this.simulationIterations < this.maxIterations) {
      this._simulate();
      this.simulationIterations++;
      
      // Auto-stop when energy is low
      if (this._totalEnergy() < 0.1) {
        this.simulationRunning = false;
      }
    }
    
    this._render();
  }

  /**
   * Force simulation step
   * @private
   */
  _simulate() {
    if (this.nodes.length === 0) return;
    
    const centerX = this.canvas.width / 2;
    const centerY = this.canvas.height / 2;
    
    // Reset forces
    for (const node of this.nodes) {
      node.fx = 0;
      node.fy = 0;
    }
    
    // Repulsion between all node pairs (O(n²))
    for (let i = 0; i < this.nodes.length; i++) {
      for (let j = i + 1; j < this.nodes.length; j++) {
        this._applyRepulsion(this.nodes[i], this.nodes[j]);
      }
    }
    
    // Attraction along edges
    for (const edge of this.edges) {
      const source = this.nodes.find(n => n.id === edge.sourceId);
      const target = this.nodes.find(n => n.id === edge.targetId);
      if (source && target) {
        this._applyAttraction(source, target, edge.strength || 1);
      }
    }
    
    // Center gravity
    for (const node of this.nodes) {
      node.fx += (centerX - node.x) * 0.001;
      node.fy += (centerY - node.y) * 0.001;
    }
    
    // Apply forces and update positions
    for (const node of this.nodes) {
      if (node === this.draggedNode) continue;
      
      node.vx = (node.vx + node.fx) * this.damping;
      node.vy = (node.vy + node.fy) * this.damping;
      
      // Clamp velocity
      const speed = Math.sqrt(node.vx * node.vx + node.vy * node.vy);
      if (speed > this.maxVelocity) {
        node.vx = (node.vx / speed) * this.maxVelocity;
        node.vy = (node.vy / speed) * this.maxVelocity;
      }
      
      node.x += node.vx;
      node.y += node.vy;
      
      // Clamp to canvas bounds
      node.x = Math.max(50, Math.min(this.canvas.width - 50, node.x));
      node.y = Math.max(50, Math.min(this.canvas.height - 50, node.y));
    }
  }

  /**
   * Apply repulsion force between two nodes
   * @private
   */
  _applyRepulsion(nodeA, nodeB) {
    let dx = nodeB.x - nodeA.x;
    let dy = nodeB.y - nodeA.y;
    let dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist < this.minDistance) dist = this.minDistance;
    
    const force = this.repulsionForce / (dist * dist);
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    
    nodeA.fx -= fx;
    nodeA.fy -= fy;
    nodeB.fx += fx;
    nodeB.fy += fy;
  }

  /**
   * Apply attraction force between connected nodes
   * @private
   */
  _applyAttraction(source, target, strength) {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist === 0) return;
    
    const force = dist * this.attractionForce * (strength / 10);
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    
    source.fx += fx;
    source.fy += fy;
    target.fx -= fx;
    target.fy -= fy;
  }

  /**
   * Calculate total kinetic energy
   * @private
   */
  _totalEnergy() {
    return this.nodes.reduce((sum, n) => {
      return sum + (n.vx * n.vx + n.vy * n.vy);
    }, 0);
  }

  /**
   * Render the graph
   * @private
   */
  _render() {
    const { width, height } = this.canvas;
    const ctx = this.ctx;
    
    // Clear
    ctx.clearRect(0, 0, width, height);
    
    // Background
    ctx.fillStyle = this.colors.background;
    ctx.fillRect(0, 0, width, height);
    
    ctx.save();
    ctx.translate(this.offsetX, this.offsetY);
    ctx.scale(this.scale, this.scale);
    
    // Draw edges
    this._renderEdges(ctx);
    
    // Draw nodes
    this._renderNodes(ctx);
    
    ctx.restore();
    
    // Draw hover tooltip
    if (this.hoveredNode) {
      this._renderTooltip(this.hoveredNode);
    }
  }

  /**
   * Render edges
   * @private
   */
  _renderEdges(ctx) {
    for (const edge of this.edges) {
      const source = this.nodes.find(n => n.id === edge.sourceId);
      const target = this.nodes.find(n => n.id === edge.targetId);
      if (!source || !target) continue;
      
      const strength = edge.strength || 1;
      const isHighlighted = this.highlightedId && 
        (edge.sourceId === this.highlightedId || edge.targetId === this.highlightedId);
      
      ctx.beginPath();
      ctx.moveTo(source.x, source.y);
      ctx.lineTo(target.x, target.y);
      
      const thickness = this.edgeBaseWidth + strength * this.edgeStrengthScale;
      ctx.lineWidth = isHighlighted ? thickness * 2 : thickness;
      
      // Edge color based on strength
      const alpha = 0.2 + (strength / 100) * 0.8;
      ctx.strokeStyle = isHighlighted
        ? 'rgba(255, 255, 255, 0.9)'
        : `rgba(100, 150, 255, ${alpha})`;
      
      // Glow for strong connections
      if (strength > 50) {
        ctx.shadowBlur = this.glowIntensity * (strength / 100);
        ctx.shadowColor = 'rgba(68, 136, 255, 0.8)';
      } else {
        ctx.shadowBlur = 0;
      }
      
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }

  /**
   * Render nodes
   * @private
   */
  _renderNodes(ctx) {
    for (const node of this.nodes) {
      const radius = this._getNodeRadius(node);
      const isHighWeight = (node.weight || 0) > 50;
      const isHighlighted = this.highlightedId === node.id;
      const isHovered = this.hoveredNode?.id === node.id;
      const isDragged = this.draggedNode?.id === node.id;
      
      // Glow effect
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius + (isHighlighted ? 8 : 4), 0, Math.PI * 2);
      const gradient = ctx.createRadialGradient(node.x, node.y, radius * 0.5, node.x, node.y, radius + 8);
      
      if (isHighWeight) {
        gradient.addColorStop(0, 'rgba(255, 102, 68, 0.6)');
        gradient.addColorStop(1, 'rgba(255, 102, 68, 0)');
      } else {
        gradient.addColorStop(0, 'rgba(68, 136, 255, 0.4)');
        gradient.addColorStop(1, 'rgba(68, 136, 255, 0)');
      }
      ctx.fillStyle = gradient;
      ctx.fill();
      
      // Node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
      
      if (isHighWeight) {
        const nodeGradient = ctx.createRadialGradient(node.x - 2, node.y - 2, 0, node.x, node.y, radius);
        nodeGradient.addColorStop(0, '#ff8866');
        nodeGradient.addColorStop(1, this.colors.nodeHot);
        ctx.fillStyle = nodeGradient;
      } else {
        const nodeGradient = ctx.createRadialGradient(node.x - 2, node.y - 2, 0, node.x, node.y, radius);
        nodeGradient.addColorStop(0, '#6699ff');
        nodeGradient.addColorStop(1, this.colors.nodeDefault);
        ctx.fillStyle = nodeGradient;
      }
      
      ctx.fill();
      
      // Highlight ring
      if (isHighlighted || isHovered || isDragged) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, radius + 3, 0, Math.PI * 2);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      
      // Node label
      const label = (node.title || '?').substring(0, 15);
      ctx.fillStyle = this.colors.text;
      ctx.font = `${11 + (node.weight || 0) * 0.02}px -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      
      // Text shadow for readability
      ctx.shadowBlur = 3;
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.fillText(label, node.x, node.y + radius + 14);
      
      // Weight badge for high-weight nodes
      if (isHighWeight) {
        ctx.beginPath();
        ctx.arc(node.x, node.y - radius - 2, 8, 0, Math.PI * 2);
        ctx.fillStyle = this.colors.nodeHot;
        ctx.fill();
        
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 9px -apple-system, sans-serif';
        ctx.shadowBlur = 0;
        ctx.fillText('🔥', node.x, node.y - radius + 1);
      }
      
      ctx.shadowBlur = 0;
    }
  }

  /**
   * Render tooltip for hovered node
   * @private
   */
  _renderTooltip(node) {
    const ctx = this.ctx;
    const screenX = node.x * this.scale + this.offsetX;
    const screenY = node.y * this.scale + this.offsetY;
    const radius = this._getNodeRadius(node) * this.scale;
    
    const tooltipX = screenX;
    const tooltipY = screenY - radius - 40;
    
    const lines = [
      node.title || 'Untitled',
      `Weight: ${node.weight || 0} | Access: ${node.accessCount || 0}`,
      (node.content || '').substring(0, 50) + '...'
    ];
    
    const fontHeight = 13;
    const padding = 10;
    const boxWidth = Math.min(250, ctx.measureText(lines[0]).width + padding * 2 + 40);
    const boxHeight = lines.length * fontHeight + padding * 2;
    
    let bx = tooltipX - boxWidth / 2;
    let by = tooltipY - boxHeight;
    
    // Clamp to canvas
    bx = Math.max(5, Math.min(this.canvas.width - boxWidth - 5, bx));
    by = Math.max(5, by);
    
    // Background
    ctx.fillStyle = 'rgba(10, 14, 39, 0.95)';
    ctx.beginPath();
    ctx.roundRect(bx, by, boxWidth, boxHeight, 8);
    ctx.fill();
    
    ctx.strokeStyle = 'rgba(68, 136, 255, 0.5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    
    // Text
    ctx.fillStyle = '#e8eaf6';
    ctx.font = '12px -apple-system, sans-serif';
    ctx.textAlign = 'left';
    
    lines.forEach((line, i) => {
      ctx.fillText(line, bx + padding, by + padding + fontHeight * (i + 1) - 3);
    });
  }

  /**
   * Get node display radius based on weight
   * @private
   */
  _getNodeRadius(node) {
    return this.nodeRadiusBase + (node.weight || 0) * this.nodeRadiusWeightScale;
  }

  /**
   * Apply zoom
   * @private
   */
  _zoom(factor) {
    const newScale = Math.max(this.minScale, Math.min(this.maxScale, this.scale * factor));
    if (newScale === this.scale) return;
    
    // Zoom toward center of canvas
    const cx = this.canvas.width / 2;
    const cy = this.canvas.height / 2;
    
    this.offsetX = cx - (cx - this.offsetX) * (newScale / this.scale);
    this.offsetY = cy - (cy - this.offsetY) * (newScale / this.scale);
    this.scale = newScale;
  }

  /**
   * Resize canvas to container
   * @private
   */
  _resizeCanvas() {
    const container = this.canvas.parentElement;
    if (!container) return;
    
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
    
    this.ctx.scale(dpr, dpr);
  }

  /**
   * Bind touch/mouse events
   * @private
   */
  _bindEvents() {
    // Touch events for mobile
    this.canvas.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
    this.canvas.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
    this.canvas.addEventListener('touchend', (e) => this._onTouchEnd(e));
    
    // Mouse events for desktop
    this.canvas.addEventListener('mousedown', (e) => this._onMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this._onMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this._onMouseUp(e));
    this.canvas.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    
    // Prevent context menu on long press
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _getEventPos(e) {
    const rect = this.canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  _onTouchStart(e) {
    if (e.touches.length === 1) {
      const pos = this._getEventPos(e);
      const node = this.getNodeAt(pos.x, pos.y);
      
      if (node) {
        this.draggedNode = node;
        this.dragOffsetX = pos.x - (node.x * this.scale + this.offsetX);
        this.dragOffsetY = pos.y - (node.y * this.scale + this.offsetY);
        e.preventDefault();
      } else {
        this.isPanning = true;
        this.panStartX = pos.x - this.offsetX;
        this.panStartY = pos.y - this.offsetY;
      }
    } else if (e.touches.length === 2) {
      // Pinch zoom
      this._handlePinch(e);
    }
  }

  _onTouchMove(e) {
    if (this.draggedNode) {
      e.preventDefault();
      const pos = this._getEventPos(e);
      this.draggedNode.x = (pos.x - this.dragOffsetX - this.offsetX) / this.scale;
      this.draggedNode.y = (pos.y - this.dragOffsetY - this.offsetY) / this.scale;
      this.draggedNode.vx = 0;
      this.draggedNode.vy = 0;
    } else if (this.isPanning) {
      const pos = this._getEventPos(e);
      this.offsetX = pos.x - this.panStartX;
      this.offsetY = pos.y - this.panStartY;
    } else {
      // Hover detection
      const pos = this._getEventPos(e);
      this.hoveredNode = this.getNodeAt(pos.x, pos.y);
    }
  }

  _onTouchEnd(e) {
    if (this.draggedNode) {
      // Trigger node click callback
      if (this.onNodeClick && this.draggedNode) {
        this.onNodeClick(this.draggedNode);
      }
    }
    this.draggedNode = null;
    this.isPanning = false;
  }

  _onMouseDown(e) {
    const pos = this._getEventPos(e);
    const node = this.getNodeAt(pos.x, pos.y);
    
    if (node) {
      this.draggedNode = node;
      this.dragOffsetX = pos.x - (node.x * this.scale + this.offsetX);
      this.dragOffsetY = pos.y - (node.y * this.scale + this.offsetY);
    } else {
      this.isPanning = true;
      this.panStartX = pos.x - this.offsetX;
      this.panStartY = pos.y - this.offsetY;
    }
  }

  _onMouseMove(e) {
    const pos = this._getEventPos(e);
    
    if (this.draggedNode) {
      this.draggedNode.x = (pos.x - this.dragOffsetX - this.offsetX) / this.scale;
      this.draggedNode.y = (pos.y - this.dragOffsetY - this.offsetY) / this.scale;
      this.draggedNode.vx = 0;
      this.draggedNode.vy = 0;
    } else if (this.isPanning) {
      this.offsetX = pos.x - this.panStartX;
      this.offsetY = pos.y - this.panStartY;
    } else {
      this.hoveredNode = this.getNodeAt(pos.x, pos.y);
      this.canvas.style.cursor = this.hoveredNode ? 'pointer' : 'grab';
    }
  }

  _onMouseUp(e) {
    if (this.draggedNode && this.onNodeClick) {
      // Only trigger click if didn't drag far
      this.onNodeClick(this.draggedNode);
    }
    this.draggedNode = null;
    this.isPanning = false;
    this.canvas.style.cursor = 'grab';
  }

  _onWheel(e) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    this._zoom(factor);
  }

  _lastPinchDist = 0;
  _handlePinch(e) {
    if (e.touches.length < 2) return;
    const dx = e.touches[0].clientX - e.touches[1].clientX;
    const dy = e.touches[0].clientY - e.touches[1].clientY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (this._lastPinchDist > 0) {
      const factor = dist / this._lastPinchDist;
      this._zoom(factor);
    }
    this._lastPinchDist = dist;
  }
      }
